import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type MindDockPlugin from "./main";
import { t } from "./i18n";

export interface MindDockSettings {
  /** API token for authentication (mdock_...) */
  apiToken: string;
  /** Add proof metadata to frontmatter after docking */
  addFrontmatter: boolean;
  /** Show status in status bar */
  showStatusBar: boolean;
}

export const DEFAULT_SETTINGS: MindDockSettings = {
  apiToken: "",
  addFrontmatter: true,
  showStatusBar: true,
};

export class MindDockSettingTab extends PluginSettingTab {
  plugin: MindDockPlugin;

  constructor(app: App, plugin: MindDockPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h1", { text: t('settingsTitle') });

    this.displayConnectionStatus(containerEl);
    this.displayApiTokenSection(containerEl);
    this.displayProofOptions(containerEl);
  }

  private displayConnectionStatus(containerEl: HTMLElement): void {
    const statusDiv = containerEl.createDiv({ cls: "minddock-connection-status" });

    if (this.plugin.isConnected()) {
      const info = this.plugin.icClient!.getTokenInfo();
      const expiresDate = new Date(info.expiresAt);
      const isExpired = Date.now() > info.expiresAt;
      const daysLeft = Math.ceil((info.expiresAt - Date.now()) / (1000 * 60 * 60 * 24));

      statusDiv.createEl("div", {
        text: t('statusConnected'),
        cls: "minddock-status-connected"
      });
      statusDiv.createEl("div", {
        text: t('principal', `${info.principalId.slice(0, 15)}...${info.principalId.slice(-10)}`),
        cls: "setting-item-description"
      });
      statusDiv.createEl("div", {
        text: t('scopes', info.scopes.join(', ')),
        cls: "setting-item-description"
      });
      statusDiv.createEl("div", {
        text: isExpired
          ? t('tokenExpired', expiresDate.toLocaleDateString())
          : t('tokenExpires', daysLeft, expiresDate.toLocaleDateString()),
        cls: isExpired ? "minddock-expired" : "setting-item-description"
      });

      const encVersion = this.plugin.icClient!.getEncryptionVersion();
      const tokenMode = this.plugin.icClient!.getTokenEncryptionMode();

      if (tokenMode === 'vetkeys-v1') {
        if (encVersion === 'vetkeys-v1') {
          statusDiv.createEl("div", {
            text: t('vetkeysActive'),
            cls: "setting-item-description"
          });
        } else {
          statusDiv.createEl("div", {
            text: t('vetkeysOffline'),
            cls: "minddock-status-warning"
          });
        }
      } else {
        statusDiv.createEl("div", {
          text: t('localEncryption'),
          cls: "setting-item-description"
        });
      }

      new Setting(containerEl)
        .setName(t('testConnectionName'))
        .setDesc(t('testConnectionDesc'))
        .addButton((btn) =>
          btn
            .setButtonText(t('testButton'))
            .onClick(async () => {
              const result = await this.plugin.icClient!.testConnection();
              if (result.success) {
                new Notice(t('testSuccess', result.principal?.slice(0, 20) ?? ''));
              } else {
                new Notice(t('testFailure', result.error ?? ''), 8000);
              }
            })
        );
    } else if (this.plugin.settings.apiToken) {
      statusDiv.createEl("div", {
        text: t('statusTokenInvalid'),
        cls: "minddock-status-error"
      });
    } else {
      statusDiv.createEl("div", {
        text: t('statusNotConnected'),
        cls: "minddock-status-disconnected"
      });
    }
  }

  private displayApiTokenSection(containerEl: HTMLElement): void {
    containerEl.createEl("h2", { text: t('sectionApiToken') });

    if (!this.plugin.settings.apiToken) {
      const setupDiv = containerEl.createDiv({ cls: "minddock-setup-instructions" });
      setupDiv.createEl("h3", { text: t('setupHowTo') });
      const steps = setupDiv.createEl("ol");
      steps.createEl("li", { text: t('setupStep1') });
      steps.createEl("li", { text: t('setupStep2') });
      steps.createEl("li", { text: t('setupStep3') });
      steps.createEl("li", { text: t('setupStep4') });
    }

    new Setting(containerEl)
      .setName(t('apiTokenName'))
      .setDesc(t('apiTokenDesc'))
      .addText((text) =>
        text
          .setPlaceholder(t('apiTokenPlaceholder'))
          .setValue(this.plugin.settings.apiToken)
          .onChange(async (value) => {
            const trimmed = value.trim();
            if (trimmed === "" || trimmed.startsWith("mdock_")) {
              this.plugin.settings.apiToken = trimmed;
              await this.plugin.saveSettings();
              this.display();
            } else {
              new Notice(t('apiTokenInvalidFormat'));
            }
          })
      );

    if (this.plugin.settings.apiToken) {
      new Setting(containerEl)
        .setName(t('removeTokenName'))
        .setDesc(t('removeTokenDesc'))
        .addButton((btn) =>
          btn
            .setButtonText(t('removeTokenButton'))
            .setWarning()
            .onClick(async () => {
              this.plugin.settings.apiToken = "";
              await this.plugin.saveSettings();
              new Notice(t('removeTokenDone'));
              this.display();
            })
        );
    }

    const encryptionInfo = containerEl.createDiv({ cls: "minddock-encryption-info" });
    encryptionInfo.createEl("p", {
      text: t('encryptionInfo'),
      cls: "setting-item-description"
    });
  }

  private displayProofOptions(containerEl: HTMLElement): void {
    containerEl.createEl("h2", { text: t('sectionProofOptions') });

    new Setting(containerEl)
      .setName(t('frontmatterName'))
      .setDesc(t('frontmatterDesc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.addFrontmatter)
          .onChange(async (value) => {
            this.plugin.settings.addFrontmatter = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(t('showStatusBarName'))
      .setDesc(t('showStatusBarDesc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showStatusBar)
          .onChange(async (value) => {
            this.plugin.settings.showStatusBar = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
