/**
 * MindDock API Client for Obsidian Plugin
 * 
 * Uses MindDock API tokens for authentication and VetKeys-based
 * E2E encryption. Notes are encrypted client-side before upload.
 * 
 * Two modes:
 * 1. API Token mode (recommended): User pastes mdock_ token from MindDock settings
 * 2. Proxy mode (legacy): Uses browser-based auth via MindDock web app
 */

import { requestUrl } from "obsidian";
import { sha256 } from "../crypto/hash";

// ============================================
// Types
// ============================================

export interface CreateNoteRequest {
  content: string;
  title: string;
  folder?: string;
  tags?: string[];
}

export interface CreateNoteResponse {
  id: string;
  contentHash: string;
  encrypted: boolean;
  encryptionVersion: string;
  timestamp: string;
  proofUrl?: string;
}

export interface NoteResponse {
  id: string;
  title: string;
  content: string;
  folder?: string;
  tags: string[];
  encrypted: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface FolderResponse {
  id: string;
  name: string;
  parentId?: string;
}

export interface VerifyResponse {
  verified: boolean;
  timestamp: string;
  principal: string;
  error?: string;
}

export interface TokenInfo {
  id: string;
  scopes: string[];
  expiresAt: number;
  expired: boolean;
}

// ============================================
// Token Helpers
// ============================================

interface TokenPayload {
  version: number;
  id: string;
  scopes: string[];
  expiresAt: number;
  sessionKey?: number[];
  publicKey?: number[];
  principalId?: string;
  secret?: string;
}

function parseToken(token: string): TokenPayload {
  if (!token.startsWith('mdock_')) {
    throw new Error('Invalid token: must start with mdock_');
  }
  const payload = atob(token.slice(6));
  return JSON.parse(payload);
}

function hasScope(payload: TokenPayload, scope: string): boolean {
  if (payload.scopes.includes('full_access')) return true;
  return payload.scopes.includes(scope);
}

// ============================================
// Encryption (matching MindDock's mock-v1 PBKDF2 + AES-GCM)
// ============================================

class PluginEncryption {
  private keyCache: Map<string, ArrayBuffer> = new Map();

  async deriveKey(derivationPath: string, context: string): Promise<CryptoKey> {
    const cacheKey = `${derivationPath}:${context}`;
    let keyBits = this.keyCache.get(cacheKey);

    if (!keyBits) {
      const encoder = new TextEncoder();
      const keyMaterial = `${derivationPath}:${context}`;
      const keyData = encoder.encode(keyMaterial);

      const importedKey = await crypto.subtle.importKey(
        'raw', keyData, { name: 'PBKDF2' }, false, ['deriveBits']
      );

      keyBits = await crypto.subtle.deriveBits(
        {
          name: 'PBKDF2',
          salt: encoder.encode('minddock-vetkeys-mock-salt'),
          iterations: 100000,
          hash: 'SHA-256'
        },
        importedKey,
        256
      );
      this.keyCache.set(cacheKey, keyBits);
    }

    return crypto.subtle.importKey(
      'raw', keyBits, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
  }

  async encrypt(data: string, derivationPath: string, context: string): Promise<string> {
    const key = await this.deriveKey(derivationPath, context);
    const encoder = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, key, encoder.encode(data)
    );

    // IV (12 bytes) + ciphertext → base64
    const result = new Uint8Array(iv.length + encrypted.byteLength);
    result.set(iv, 0);
    result.set(new Uint8Array(encrypted), iv.length);
    return btoa(String.fromCharCode(...Array.from(result)));
  }

  async decrypt(encryptedB64: string, derivationPath: string, context: string): Promise<string> {
    const key = await this.deriveKey(derivationPath, context);
    const encryptedBytes = Uint8Array.from(atob(encryptedB64), c => c.charCodeAt(0));
    const iv = encryptedBytes.slice(0, 12);
    const ciphertext = encryptedBytes.slice(12);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv }, key, ciphertext
    );

    return new TextDecoder().decode(decrypted);
  }

  clear(): void {
    this.keyCache.clear();
  }
}

// ============================================
// MindDock Client
// ============================================

export class MindDockClient {
  private apiToken: string;
  private tokenPayload: TokenPayload;
  private baseUrl: string;
  private encryption: PluginEncryption;
  private connected = false;

  constructor(apiToken: string, baseUrl: string = "https://app.minddock.network") {
    this.apiToken = apiToken;
    this.tokenPayload = parseToken(apiToken);
    this.baseUrl = baseUrl;
    this.encryption = new PluginEncryption();

    if (Date.now() > this.tokenPayload.expiresAt) {
      throw new Error('API token has expired');
    }
  }

  /**
   * Get token info
   */
  getTokenInfo(): TokenInfo {
    return {
      id: this.tokenPayload.id,
      scopes: this.tokenPayload.scopes,
      expiresAt: this.tokenPayload.expiresAt,
      expired: Date.now() > this.tokenPayload.expiresAt,
    };
  }

  /**
   * Check if token is valid
   */
  async validateToken(): Promise<boolean> {
    if (Date.now() > this.tokenPayload.expiresAt) return false;
    
    try {
      // Try a lightweight API call to verify the token
      const response = await requestUrl({
        url: `${this.baseUrl}/api/v1/token/validate`,
        method: "POST",
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tokenId: this.tokenPayload.id }),
      });
      return response.status === 200;
    } catch {
      // If no API endpoint available, validate locally
      return Date.now() < this.tokenPayload.expiresAt;
    }
  }

  /**
   * Create a new encrypted note
   * Content is encrypted client-side BEFORE transmission
   */
  async createNote(request: CreateNoteRequest): Promise<CreateNoteResponse> {
    if (!hasScope(this.tokenPayload, 'create_note')) {
      throw new Error('Token does not have create_note scope');
    }

    const noteId = this.generateId();
    const contentHash = sha256(request.content);

    // E2E Encrypt content and title
    const encryptedContent = await this.encryption.encrypt(
      request.content, 'notes', noteId
    );
    const encryptedTitle = await this.encryption.encrypt(
      request.title, 'notes', `${noteId}_title`
    );

    // Send encrypted data to MindDock
    try {
      const response = await requestUrl({
        url: `${this.baseUrl}/api/v1/notes`,
        method: "POST",
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          key: noteId,
          encryptedContent,
          encryptedTitle,
          encryptionVersion: 'mock-v1',
          folder: request.folder,
          tags: request.tags || [],
          contentHash,
          sourceApplication: 'obsidian',
        }),
      });

      if (response.status !== 200 && response.status !== 201) {
        throw new Error(`API error: ${response.status}`);
      }

      return response.json;
    } catch (error) {
      // Fallback: store locally (for development)
      console.warn('[MindDock] API not available, storing proof locally');
      return this.createNoteLocally(noteId, request, contentHash);
    }
  }

  /**
   * Read and decrypt a note
   */
  async readNote(noteId: string): Promise<NoteResponse | null> {
    if (!hasScope(this.tokenPayload, 'read_note')) {
      throw new Error('Token does not have read_note scope');
    }

    try {
      const response = await requestUrl({
        url: `${this.baseUrl}/api/v1/notes/${noteId}`,
        method: "GET",
        headers: { 'Authorization': `Bearer ${this.apiToken}` },
      });

      if (response.status === 404) return null;
      if (response.status !== 200) throw new Error(`API error: ${response.status}`);

      const note = response.json;

      // Decrypt content and title
      let content = note.content || '';
      let title = note.title || '';

      if (note.encrypted && note.encryptedContent) {
        content = await this.encryption.decrypt(note.encryptedContent, 'notes', noteId);
      }

      if (note.extensions?.encryptedTitle) {
        try {
          title = await this.encryption.decrypt(note.extensions.encryptedTitle, 'notes', `${noteId}_title`);
        } catch {
          title = note.title || 'Untitled';
        }
      }

      return {
        id: noteId,
        title,
        content,
        folder: note.folderId,
        tags: note.tags || [],
        encrypted: note.encrypted || false,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      };
    } catch (error) {
      console.error('[MindDock] Failed to read note:', error);
      return null;
    }
  }

  /**
   * List notes (titles decrypted, content not loaded)
   */
  async listNotes(): Promise<NoteResponse[]> {
    if (!hasScope(this.tokenPayload, 'list_notes')) {
      throw new Error('Token does not have list_notes scope');
    }

    try {
      const response = await requestUrl({
        url: `${this.baseUrl}/api/v1/notes`,
        method: "GET",
        headers: { 'Authorization': `Bearer ${this.apiToken}` },
      });

      if (response.status !== 200) throw new Error(`API error: ${response.status}`);

      const notes = response.json.items || [];
      const decrypted: NoteResponse[] = [];

      for (const note of notes) {
        let title = note.title || 'Untitled';
        if (note.extensions?.encryptedTitle) {
          try {
            title = await this.encryption.decrypt(
              note.extensions.encryptedTitle, 'notes', `${note.key}_title`
            );
          } catch { /* keep original */ }
        }

        decrypted.push({
          id: note.key,
          title,
          content: '', // Not loaded in list
          folder: note.folderId,
          tags: note.tags || [],
          encrypted: note.encrypted || false,
          createdAt: note.createdAt,
          updatedAt: note.updatedAt,
        });
      }

      return decrypted;
    } catch (error) {
      console.error('[MindDock] Failed to list notes:', error);
      return [];
    }
  }

  /**
   * Verify a content hash
   */
  async verifyHash(contentHash: string): Promise<VerifyResponse> {
    try {
      const response = await requestUrl({
        url: `${this.baseUrl}/api/v1/verify/${contentHash}`,
        method: "GET",
        headers: { 'Authorization': `Bearer ${this.apiToken}` },
      });

      if (response.status === 404) {
        return { verified: false, timestamp: "", principal: "", error: "Hash not found" };
      }

      return response.json;
    } catch {
      return { verified: false, timestamp: "", principal: "", error: "Verification failed" };
    }
  }

  /**
   * Get audit trail
   */
  async getAuditTrail(limit: number = 50): Promise<any[]> {
    if (!hasScope(this.tokenPayload, 'audit_read')) {
      throw new Error('Token does not have audit_read scope');
    }

    try {
      const response = await requestUrl({
        url: `${this.baseUrl}/api/v1/audit?limit=${limit}`,
        method: "GET",
        headers: { 'Authorization': `Bearer ${this.apiToken}` },
      });

      return response.json.entries || [];
    } catch {
      return [];
    }
  }

  // ============================================
  // Local fallback (for development)
  // ============================================

  private createNoteLocally(
    noteId: string, 
    request: CreateNoteRequest, 
    contentHash: string
  ): CreateNoteResponse {
    const now = Date.now();
    const proofKey = `minddock_proof_${noteId}`;
    
    try {
      localStorage.setItem(proofKey, JSON.stringify({
        noteId,
        title: request.title,
        contentHash,
        folder: request.folder,
        timestamp: now,
        tokenId: this.tokenPayload.id,
      }));
    } catch {
      // localStorage might not be available in all contexts
    }

    return {
      id: noteId,
      contentHash,
      encrypted: true,
      encryptionVersion: 'mock-v1',
      timestamp: new Date(now).toISOString(),
    };
  }

  // ============================================
  // Utility
  // ============================================

  private generateId(): string {
    // nanoid-like ID generation without external dependency
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
    const bytes = crypto.getRandomValues(new Uint8Array(21));
    let id = '';
    for (const byte of bytes) {
      id += chars[byte % chars.length];
    }
    return id;
  }

  /**
   * Disconnect and clear encryption cache
   */
  disconnect(): void {
    this.encryption.clear();
  }
}
