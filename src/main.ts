/**
 * MindDock Obsidian Plugin
 * 
 * Dock notes to MindDock for blockchain-verified proof of authorship.
 * Uses API tokens with IC DelegationChain for direct canister communication.
 * 
 * Flow:
 * 1. User creates API token in MindDock web app (Settings → API Tokens)
 * 2. User pastes mdock_... token in plugin settings
 * 3. Plugin reconstructs DelegationIdentity from token
 * 4. Right-click note → "⚓ Dock to MindDock"
 * 5. Plugin encrypts + writes directly to Juno satellite on IC
 */

import {
  App,
  Editor,
  MarkdownView,
  Notice,
  Plugin,
  TFile,
  TFolder,
  TAbstractFile,
  Menu,
  MenuItem,
} from "obsidian";
import { MindDockSettings, DEFAULT_SETTINGS, MindDockSettingTab } from "./settings";
import { MindDockICClient } from "./api/ic-client";
import { updateFrontmatter, getMindDockFrontmatter } from "./dock/frontmatter";
import { sha256 } from "./crypto/hash";
import { t } from "./i18n";

export default class MindDockPlugin extends Plugin {
  settings: MindDockSettings;
  statusBarItem: HTMLElement;
  icClient: MindDockICClient | null = null;

  async onload() {
    await this.loadSettings();

    // Status bar item
    this.statusBarItem = this.addStatusBarItem();
    this.statusBarItem.setText("⚓ MindDock");
    this.statusBarItem.addClass("minddock-status");

    // Initialize IC client if token is configured
    await this.initializeClient();

    // Ribbon icon for quick dock
    this.addRibbonIcon("anchor", t('cmdDockNote'), async () => {
      if (!this.isConnected()) {
        new Notice(t('noTokenRibbon'));
        this.openSettings();
        return;
      }
      await this.dockCurrentFile();
    });

    // Command: Dock current note
    this.addCommand({
      id: "dock-current-note",
      name: t('cmdDockNote'),
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        if (view.file) {
          await this.dockFile(view.file);
        }
      },
    });

    // Command: Verify current note
    this.addCommand({
      id: "verify-current-note",
      name: t('cmdVerify'),
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        if (view.file) {
          await this.verifyFile(view.file);
        }
      },
    });

    // Command: Copy content hash
    this.addCommand({
      id: "copy-content-hash",
      name: t('cmdCopyHash'),
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        if (view.file) {
          const content = await this.app.vault.read(view.file);
          const hash = sha256(content);
          await navigator.clipboard.writeText(hash);
          new Notice(t('hashCopied'));
        }
      },
    });

    // Command: Open proof URL
    this.addCommand({
      id: "open-proof-url",
      name: t('cmdOpenProof'),
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        if (view.file) {
          const meta = await getMindDockFrontmatter(this.app.vault, view.file);
          if (meta?.proofUrl) {
            window.open(meta.proofUrl);
          } else {
            new Notice(t('notDocked'));
          }
        }
      },
    });

    // Command: Test connection
    this.addCommand({
      id: "test-connection",
      name: t('cmdTestConnection'),
      callback: async () => {
        await this.testConnection();
      },
    });

    // Command: Open settings
    this.addCommand({
      id: "open-settings",
      name: t('cmdOpenSettings'),
      callback: () => {
        this.openSettings();
      },
    });

    // Context menu for files and folders
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
        if (file instanceof TFolder) {
          menu.addSeparator();
          menu.addItem((item: MenuItem) => {
            item
              .setTitle(t('ctxDockFolder'))
              .setIcon("anchor")
              .onClick(async () => {
                await this.dockFolder(file);
              });
          });
        }

        if (file instanceof TFile && file.extension === "md") {
          menu.addSeparator();

          menu.addItem((item: MenuItem) => {
            item
              .setTitle(t('ctxDock'))
              .setIcon("anchor")
              .onClick(async () => {
                await this.dockFile(file);
              });
          });

          menu.addItem((item: MenuItem) => {
            item
              .setTitle(t('ctxVerify'))
              .setIcon("check-circle")
              .onClick(async () => {
                await this.verifyFile(file);
              });
          });

          menu.addItem((item: MenuItem) => {
            item
              .setTitle(t('ctxOpenProof'))
              .setIcon("external-link")
              .onClick(async () => {
                const meta = await getMindDockFrontmatter(this.app.vault, file);
                if (meta?.proofUrl) {
                  window.open(meta.proofUrl);
                } else {
                  new Notice(t('notDocked'));
                }
              });
          });
        }
      })
    );

    // Settings tab
    this.addSettingTab(new MindDockSettingTab(this.app, this));

    console.log("MindDock plugin loaded");
  }

  onunload() {
    this.icClient?.destroy();
    this.icClient = null;
    console.log("MindDock plugin unloaded");
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    // Re-initialize client when settings change
    await this.initializeClient();
  }

  /**
   * Initialize the IC client from the API token
   */
  async initializeClient(): Promise<void> {
    // Cleanup old client
    this.icClient?.destroy();
    this.icClient = null;

    const token = this.settings.apiToken;
    if (!token || !token.startsWith('mdock_')) {
      this.updateStatusBar();
      return;
    }

    try {
      this.icClient = new MindDockICClient(token);
      await this.icClient.initialize();
      
      const info = this.icClient.getTokenInfo();
      console.log('[MindDock] Connected:', {
        tokenVersion: info.version,
        principal: info.principalId.slice(0, 20) + '...',
        scopes: info.scopes,
        expires: new Date(info.expiresAt).toLocaleDateString(),
      });

      this.updateStatusBar();
    } catch (error) {
      console.error('[MindDock] Failed to initialize client:', error);
      this.icClient = null;
      this.updateStatusBar();
      
      new Notice(`⚓ MindDock: ${(error as Error).message}`); // technische fout, geen i18n sleutel
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.icClient !== null;
  }

  /**
   * Update status bar
   */
  updateStatusBar() {
    if (this.icClient) {
      const info = this.icClient.getTokenInfo();
      const shortPrincipal = info.principalId.slice(0, 8);
      this.statusBarItem.setText(t('statusBarConnected', shortPrincipal));
    } else if (this.settings.apiToken) {
      this.statusBarItem.setText(t('statusBarInvalid'));
    } else {
      this.statusBarItem.setText(t('statusBarNoToken'));
    }
  }

  openSettings() {
    // @ts-ignore - accessing private API
    this.app.setting.open();
    // @ts-ignore
    this.app.setting.openTabById("minddock");
  }

  /**
   * Test the connection
   */
  async testConnection() {
    if (!this.icClient) {
      new Notice(t('noClient'));
      return;
    }

    new Notice(t('testingConnection'));

    const result = await this.icClient.testConnection();
    if (result.success) {
      new Notice(t('connectedPrincipal', result.principal?.slice(0, 20) ?? ''));
    } else {
      new Notice(t('connectionFailed', result.error ?? ''));
    }
  }

  /**
   * Dock the currently active file
   */
  async dockCurrentFile() {
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile) {
      await this.dockFile(activeFile);
    } else {
      new Notice(t('noActiveFile'));
    }
  }

  /**
   * Dock a folder to MindDock, including subfolders and notes.
   * Preserves the full folder structure via parentId links.
   */
  async dockFolder(folder: TFolder) {
    if (!this.icClient) {
      new Notice(t('noToken'));
      this.openSettings();
      return;
    }

    // Stap 1: Bouw mapstructuur top-down op in MindDock.
    // Map: Obsidian pad → MindDock folderId
    const folderIdMap = new Map<string, string>();

    const createFolderDocs = async (f: TFolder, parentId: string | null) => {
      try {
        const folderId = await this.icClient!.dockFolderDoc(f.name, f.path, parentId);
        folderIdMap.set(f.path, folderId);
        for (const child of f.children) {
          if (child instanceof TFolder) {
            await createFolderDocs(child, folderId);
          }
        }
      } catch (e) {
        console.error(`[MindDock] Map aanmaken mislukt voor "${f.path}":`, e);
      }
    };

    new Notice(t('creatingFolders', folder.name));
    await createFolderDocs(folder, null);

    // Stap 2: Verzamel alle .md bestanden met hun folderId
    const fileEntries: Array<{ file: TFile; folderId: string | null }> = [];
    const collectFiles = (f: TFolder) => {
      for (const child of f.children) {
        if (child instanceof TFile && child.extension === "md") {
          fileEntries.push({ file: child, folderId: folderIdMap.get(f.path) ?? null });
        } else if (child instanceof TFolder) {
          collectFiles(child);
        }
      }
    };
    collectFiles(folder);

    if (fileEntries.length === 0) {
      new Notice(t('noNotesInFolder', folder.name));
      return;
    }

    new Notice(t('dockingNotes', fileEntries.length, folder.name));

    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < fileEntries.length; i++) {
      this.statusBarItem.setText(`⚓ Docking ${i + 1}/${fileEntries.length}...`);
      const { file, folderId: noteFolderId } = fileEntries[i];
      const ok = await this.dockFile(file, true, noteFolderId);
      if (ok) succeeded++;
      else failed++;
    }

    this.updateStatusBar();

    const folders = folderIdMap.size;
    if (failed === 0) {
      new Notice(t('folderSuccess', folders, succeeded, folder.name));
    } else {
      new Notice(t('folderPartial', folders, succeeded, failed, folder.name));
    }
  }

  /**
   * Dock a file to MindDock.
   * @param silent   - onderdruk individuele notices (voor bulk-gebruik)
   * @param folderId - MindDock folderId om de notitie in te plaatsen
   * @returns true bij succes, false bij fout
   */
  async dockFile(file: TFile, silent = false, folderId?: string | null): Promise<boolean> {
    if (!this.icClient) {
      new Notice(t('noToken'));
      this.openSettings();
      return false;
    }

    if (!this.icClient.hasScope('create_note')) {
      new Notice(t('noScope'));
      return false;
    }

    if (!silent) new Notice(t('dockingFile', file.name));

    try {
      const content = await this.app.vault.read(file);
      
      // Check if note already exists (for updates)
      const existingMeta = await getMindDockFrontmatter(this.app.vault, file);
      const existingNoteId = existingMeta?.noteId;
      
      // Dock via IC client (handles encryption + Juno write)
      const result = await this.icClient.dock(
        file.basename,
        content,
        file.path,
        existingNoteId,
        folderId
      );
      
      if (result.success) {
        // Update frontmatter with proof metadata
        if (this.settings.addFrontmatter) {
          await updateFrontmatter(this.app.vault, file, {
            synced: true,
            noteId: result.noteId!,
            contentHash: result.contentHash!,
            proofUrl: result.proofUrl!,
            lastDock: new Date().toISOString(),
            icTimestamp: String(result.icTimestamp),
          });
        }
        
        if (!silent) {
          const action = result.isUpdate ? t('actionUpdated') : t('actionDocked');
          new Notice(t('dockSuccess', action, result.contentHash?.slice(0, 12) ?? ''));
        }
        return true;
      } else {
        if (!silent) new Notice(t('dockError', result.error ?? ''));
        console.error(`[MindDock] Dock failed for ${file.path}:`, result.error);
        return false;
      }
    } catch (error) {
      console.error("Dock error:", error);
      if (!silent) new Notice(t('dockFailed', (error as Error).message));
      return false;
    }
  }

  /**
   * Verify a file's proof
   */
  async verifyFile(file: TFile) {
    try {
      const content = await this.app.vault.read(file);
      const localHash = sha256(content);
      
      // Check frontmatter
      const meta = await getMindDockFrontmatter(this.app.vault, file);
      
      if (!meta?.contentHash) {
        new Notice(t('notDocked'));
        return;
      }

      if (localHash === meta.contentHash) {
        if (this.icClient) {
          const result = await this.icClient.verify(localHash);

          if (result.success && result.verified) {
            new Notice(t('verifySuccess'));
          } else if (result.success && !result.verified) {
            new Notice(t('verifyHashNotFound'));
          } else {
            new Notice(t('verifyError', result.error ?? ''));
          }
        } else {
          new Notice(t('verifyLocalMatch'));
        }
      } else {
        new Notice(t('verifyModified'));
      }
    } catch (error) {
      console.error("Verify error:", error);
      new Notice(t('verifyError', (error as Error).message));
    }
  }
}
