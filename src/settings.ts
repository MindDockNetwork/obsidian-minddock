import { App, Notice, PluginSettingTab, Setting, setIcon } from "obsidian";
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

/** Create a heading element with a Lucide icon prefix */
function iconHeading(container: HTMLElement, tag: keyof HTMLElementTagNameMap, iconName: string, text: string): HTMLElement {
  const el = container.createEl(tag as any);
  const iconSpan = el.createSpan({ cls: 'minddock-heading-icon' });
  setIcon(iconSpan, iconName);
  el.createSpan({ text: ` ${text}` });
  return el;
}

/** Create an info row with a Lucide icon + text */
function iconRow(container: HTMLElement, iconName: string, text: string, cls: string): HTMLElement {
  const row = container.createDiv({ cls });
  const iconSpan = row.createSpan({ cls: 'minddock-row-icon' });
  setIcon(iconSpan, iconName);
  row.createSpan({ text: ` ${text}` });
  return row;
}

export class MindDockSettingTab extends PluginSettingTab {
  plugin: MindDockPlugin;

  constructor(app: App, plugin: MindDockPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    iconHeading(containerEl, 'h1', 'anchor', t('settingsTitle'));

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

      iconRow(statusDiv, 'circle-check', t('statusConnected'), 'minddock-status-connected');
      iconRow(statusDiv, 'user', t('principal', `${info.principalId.slice(0, 15)}...${info.principalId.slice(-10)}`), 'setting-item-description');
      iconRow(statusDiv, 'key', t('scopes', info.scopes.join(', ')), 'setting-item-description');
      iconRow(
        statusDiv,
        isExpired ? 'alert-circle' : 'clock',
        isExpired
          ? t('tokenExpired', expiresDate.toLocaleDateString())
          : t('tokenExpires', daysLeft, expiresDate.toLocaleDateString()),
        isExpired ? 'minddock-expired' : 'setting-item-description'
      );

      const encVersion = this.plugin.icClient!.getEncryptionVersion();
      const tokenMode = this.plugin.icClient!.getTokenEncryptionMode();

      if (tokenMode === 'vetkeys-v1') {
        if (encVersion === 'vetkeys-v1') {
          iconRow(statusDiv, 'shield-check', t('vetkeysActive'), 'setting-item-description');
        } else {
          iconRow(statusDiv, 'alert-triangle', t('vetkeysOffline'), 'minddock-status-warning');
        }
      } else {
        iconRow(statusDiv, 'lock', t('localEncryption'), 'setting-item-description');
      }

      new Setting(containerEl)
        .setName(t('testConnectionName'))
        .setDesc(t('testConnectionDesc'))
        .addButton((btn) =>
          btn
            .setButtonText(t('testButton'))
            .setIcon('link')
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
      iconRow(statusDiv, 'alert-circle', t('statusTokenInvalid'), 'minddock-status-error');
    } else {
      iconRow(statusDiv, 'anchor', t('statusNotConnected'), 'minddock-status-disconnected');
    }
  }

  private displayApiTokenSection(containerEl: HTMLElement): void {
    iconHeading(containerEl, 'h2', 'key', t('sectionApiToken'));

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
            .setIcon('trash-2')
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
    iconRow(encryptionInfo, 'shield', t('encryptionInfo'), 'setting-item-description');
  }

  private displayProofOptions(containerEl: HTMLElement): void {
    iconHeading(containerEl, 'h2', 'file-check', t('sectionProofOptions'));

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
