/**
 * MindDock API Client - Fallback version without Juno SDK
 * Uses localStorage for auth state and REST-style API calls
 */

import { sha256 } from "../crypto/hash";

// Environment configuration
// Change DEV_MODE to true when testing with local MindDock
const DEV_MODE = true;

// MindDock Gateway URLs
const GATEWAY_URL = DEV_MODE 
  ? "http://localhost:5173"       // Local development
  : "https://app.minddock.network"; // Production

const SATELLITE_ID = "u5cjm-dyaaa-aaaas-amuxq-cai";

// Storage keys
const AUTH_KEY = "minddock_auth";

export interface NoteData {
  title: string;
  content: string;
  contentHash: string;
  folder?: string;
  tags?: string[];
  encrypted: boolean;
  sourceApplication: string;
  createdAt: number;
  updatedAt: number;
}

export interface DockResult {
  success: boolean;
  noteId?: string;
  contentHash?: string;
  timestamp?: number;
  error?: string;
}

export interface VerifyResult {
  verified: boolean;
  timestamp?: number;
  error?: string;
}

interface AuthState {
  principal: string;
  authenticated: boolean;
  timestamp: number;
}

let authState: AuthState | null = null;
let isInitialized = false;

/**
 * Initialize - load auth state from storage
 */
export async function initializeJuno(): Promise<void> {
  if (isInitialized) return;
  
  try {
    const stored = localStorage.getItem(AUTH_KEY);
    if (stored) {
      authState = JSON.parse(stored);
      console.log("MindDock: Loaded auth state");
    }
  } catch (e) {
    console.warn("MindDock: Could not load auth state", e);
  }
  
  isInitialized = true;
  console.log("MindDock: Initialized (fallback mode)");
}

/**
 * Subscribe to auth changes (no-op in fallback mode)
 */
export function subscribeToAuth(callback: (user: any) => void): () => void {
  // Call with current state
  callback(authState);
  return () => {};
}

// Callback for principal input (set by settings UI)
let principalInputCallback: ((principal: string) => void) | null = null;
let principalInputReject: ((error: Error) => void) | null = null;

/**
 * Set principal from external input (modal)
 */
export function setPrincipalFromInput(principal: string): void {
  if (principal && principal.length > 20) {
    authState = {
      principal,
      authenticated: true,
      timestamp: Date.now()
    };
    localStorage.setItem(AUTH_KEY, JSON.stringify(authState));
    console.log("MindDock: Authenticated as", principal.slice(0, 20) + "...");
    
    if (principalInputCallback) {
      principalInputCallback(principal);
      principalInputCallback = null;
      principalInputReject = null;
    }
  } else if (principalInputReject) {
    principalInputReject(new Error("Invalid principal"));
    principalInputCallback = null;
    principalInputReject = null;
  }
}

/**
 * Cancel pending sign-in
 */
export function cancelSignIn(): void {
  if (principalInputReject) {
    principalInputReject(new Error("Authentication cancelled"));
    principalInputCallback = null;
    principalInputReject = null;
  }
}

/**
 * Sign in - Open MindDock in browser for authentication
 * Returns a promise that resolves when setPrincipalFromInput is called
 */
export async function signInWithII(): Promise<any> {
  // Open MindDock website - user needs to log in there
  const loginUrl = `${GATEWAY_URL}/?source=obsidian`;
  
  // Open in default browser
  window.open(loginUrl);
  
  // Return a promise that will be resolved by setPrincipalFromInput
  return new Promise((resolve, reject) => {
    principalInputCallback = (principal) => {
      resolve({ key: principal });
    };
    principalInputReject = reject;
  });
}

/**
 * Sign out
 */
export async function signOutFromJuno(): Promise<void> {
  authState = null;
  localStorage.removeItem(AUTH_KEY);
  console.log("MindDock: Signed out");
}

/**
 * Get current user
 */
export function getCurrentUser(): { key: string } | null {
  if (authState?.authenticated) {
    return { key: authState.principal };
  }
  return null;
}

/**
 * Check if authenticated
 */
export function isAuthenticated(): boolean {
  return authState?.authenticated === true;
}

/**
 * Dock a note (placeholder - stores locally for now)
 * In production, this would call a backend API or use Juno directly
 */
export async function dockNote(
  noteId: string,
  title: string,
  content: string,
  folder?: string
): Promise<DockResult> {
  if (!isAuthenticated()) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    const contentHash = sha256(content);
    const now = Date.now();

    // Store proof locally
    const proofKey = `minddock_proof_${noteId}`;
    const proof = {
      noteId,
      title,
      contentHash,
      folder,
      timestamp: now,
      principal: authState?.principal
    };
    
    localStorage.setItem(proofKey, JSON.stringify(proof));
    
    console.log("MindDock: Note docked locally", { noteId, contentHash });
    
    return {
      success: true,
      noteId,
      contentHash,
      timestamp: now,
    };
  } catch (error) {
    console.error("Dock error:", error);
    return { success: false, error: String(error) };
  }
}

/**
 * Update a note
 */
export async function updateNote(
  noteId: string,
  title: string,
  content: string,
  folder?: string
): Promise<DockResult> {
  // Same as dock for fallback mode
  return dockNote(noteId, title, content, folder);
}

/**
 * Verify a content hash
 */
export async function verifyContentHash(contentHash: string): Promise<VerifyResult> {
  if (!isAuthenticated()) {
    return { verified: false, error: "Not authenticated" };
  }

  try {
    // Search local proofs
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("minddock_proof_")) {
        const proof = JSON.parse(localStorage.getItem(key) || "{}");
        if (proof.contentHash === contentHash) {
          return {
            verified: true,
            timestamp: proof.timestamp,
          };
        }
      }
    }

    return { verified: false, error: "Hash not found" };
  } catch (error) {
    console.error("Verify error:", error);
    return { verified: false, error: String(error) };
  }
}

/**
 * Generate unique note ID from file path
 */
export function generateNoteId(filePath: string): string {
  return sha256(filePath).slice(0, 16);
}
