import { TFile, Vault } from "obsidian";
import { MindDockClient, CreateNoteResponse } from "../api/client";
import { updateFrontmatter, getMindDockFrontmatter } from "./frontmatter";
import { sha256 } from "../crypto/hash";

export interface DockResult {
  status: "docked" | "unchanged" | "error";
  contentHash?: string;
  proofUrl?: string;
  message?: string;
}

export interface VerifyResult {
  status: "verified" | "modified" | "not_docked";
  localHash?: string;
  storedHash?: string;
  blockchainTimestamp?: string;
  message?: string;
}

export class DockService {
  private vault: Vault;
  private client: MindDockClient;

  constructor(vault: Vault, client: MindDockClient) {
    this.vault = vault;
    this.client = client;
  }

  /**
   * Dock a file to MindDock
   * This creates blockchain proof of the content
   */
  async dockFile(file: TFile): Promise<DockResult> {
    try {
      // Read file content
      const content = await this.vault.read(file);
      const contentHash = sha256(content);

      // Check if content is unchanged since last dock
      const existingMeta = await getMindDockFrontmatter(this.vault, file);
      if (existingMeta?.contentHash === contentHash) {
        return {
          status: "unchanged",
          contentHash,
          message: "Content identical to last docked version",
        };
      }

      // Send to MindDock API
      const result: CreateNoteResponse = await this.client.createNote({
        content,
        title: file.basename,
        folder: file.parent?.path,
      });

      // Update frontmatter with proof metadata
      await updateFrontmatter(this.vault, file, {
        synced: true,
        contentHash: result.contentHash,
        proofUrl: result.proofUrl,
        lastDock: new Date().toISOString(),
        icTimestamp: result.timestamp,
      });

      return {
        status: "docked",
        contentHash: result.contentHash,
        proofUrl: result.proofUrl,
      };
    } catch (error) {
      console.error("Dock error:", error);
      return {
        status: "error",
        message: String(error),
      };
    }
  }

  /**
   * Verify if local content matches the blockchain proof
   */
  async verifyFile(file: TFile): Promise<VerifyResult> {
    try {
      // Get stored metadata
      const existingMeta = await getMindDockFrontmatter(this.vault, file);
      if (!existingMeta?.contentHash) {
        return { status: "not_docked" };
      }

      // Calculate current content hash
      const content = await this.vault.read(file);
      const localHash = sha256(content);

      // Compare hashes
      if (localHash === existingMeta.contentHash) {
        // Optionally verify on blockchain too
        const blockchainVerify = await this.client.verifyHash(localHash);
        
        return {
          status: "verified",
          localHash,
          storedHash: existingMeta.contentHash,
          blockchainTimestamp: blockchainVerify.timestamp,
        };
      }

      return {
        status: "modified",
        localHash,
        storedHash: existingMeta.contentHash,
        message: "Content has been modified since last dock",
      };
    } catch (error) {
      console.error("Verify error:", error);
      return {
        status: "modified",
        message: String(error),
      };
    }
  }

  /**
   * Get the SHA-256 hash of a file's content
   */
  async getContentHash(file: TFile): Promise<string> {
    const content = await this.vault.read(file);
    return sha256(content);
  }

  /**
   * Check if a file is docked (has MindDock frontmatter)
   */
  async isDocked(file: TFile): Promise<boolean> {
    const meta = await getMindDockFrontmatter(this.vault, file);
    return !!meta?.synced;
  }
}
