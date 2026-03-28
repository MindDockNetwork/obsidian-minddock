/**
 * MindDock i18n — meertalige ondersteuning
 *
 * Talen: nl (Nederlands), en (English)
 * Extra talen toevoegen: voeg een nieuw object toe en registreer het in TRANSLATIONS.
 *
 * Gebruik: import { t } from './i18n';
 *          t('statusConnected')
 *          t('dockingFile', file.name)
 *
 * Emojis zijn verwijderd — icons worden gerenderd via Obsidian setIcon API in settings.ts / main.ts
 */

// ============================================================
// Vertalingen
// ============================================================

const nl = {
  // Status
  statusConnected:        'Verbonden met MindDock',
  statusTokenInvalid:     'Token ongeldig of verlopen',
  statusNotConnected:     'Niet verbonden — plak hieronder een API token',
  statusBarConnected:     (p: string) => `MindDock: ${p}... (IC)`,
  statusBarInvalid:       'MindDock: Token ongeldig',
  statusBarNoToken:       'MindDock: Geen token',

  // Token info
  principal:              (p: string) => `Principal: ${p}`,
  scopes:                 (s: string) => `Scopes: ${s}`,
  tokenExpired:           (d: string) => `Token verlopen op ${d}`,
  tokenExpires:           (days: number, d: string) => `Verloopt over ${days} dagen (${d})`,

  // Encryptie
  vetkeysActive:          'VetKeys E2E encryptie actief',
  vetkeysOffline:         'VetKeys tijdelijk offline — notities worden lokaal versleuteld (local-v1). ' +
                          'Voeg cycles toe aan de VetKeys canister om VetKeys te hervatten.',
  localEncryption:        'Lokale encryptie actief (PBKDF2). Upgrade naar een betaald plan voor VetKeys E2E encryptie.',
  encryptionInfo:         'Alle notities worden E2E versleuteld met AES-256-GCM voordat ze Obsidian verlaten. ' +
                          'MindDock servers zien nooit je plaintext content.',

  // Settings — headers
  settingsTitle:          'MindDock Instellingen',
  sectionApiToken:        'API Token',
  sectionProofOptions:    'Proof Opties',

  // Settings — verbinding testen
  testConnectionName:     'Test verbinding',
  testConnectionDesc:     'Controleer de verbinding met Internet Computer',
  testButton:             'Test',
  testSuccess:            (p: string) => `Verbonden met MindDock\nPrincipal: ${p}...`,
  testFailure:            (err: string) => `Verbinding mislukt: ${err}`,

  // Settings — setup instructies
  setupHowTo:             'Hoe krijg je een token:',
  setupStep1:             'Log in op MindDock (app.minddock.network)',
  setupStep2:             'Ga naar Instellingen → API Tokens',
  setupStep3:             "Klik op 'Nieuw Token Aanmaken'",
  setupStep4:             'Kopieer het mdock_... token en plak het hieronder',

  // Settings — token invoer
  apiTokenName:           'API Token',
  apiTokenDesc:           'Plak je MindDock API token (begint met mdock_)',
  apiTokenPlaceholder:    'mdock_...',
  apiTokenInvalidFormat:  'Ongeldig token formaat. Moet beginnen met mdock_',

  // Settings — token verwijderen
  removeTokenName:        'Token verwijderen',
  removeTokenDesc:        'Ontkoppel deze Obsidian vault van MindDock',
  removeTokenButton:      'Verwijder Token',
  removeTokenDone:        'API token verwijderd',

  // Settings — opties
  frontmatterName:        'Voeg proof toe aan frontmatter',
  frontmatterDesc:        'Na het docken, voeg MindDock metadata toe aan de frontmatter van de notitie',
  showStatusBarName:      'Toon status in statusbalk',
  showStatusBarDesc:      'Toon verbinding- en proof-status in de statusbalk',

  // Commandonamen
  cmdDockNote:            'Notitie docken naar MindDock',
  cmdVerify:              'MindDock proof verifiëren',
  cmdCopyHash:            'Content hash kopiëren',
  cmdOpenProof:           'Proof URL openen in browser',
  cmdTestConnection:      'MindDock verbinding testen',
  cmdOpenSettings:        'MindDock instellingen openen',

  // Contextmenu
  ctxDock:                'Docken naar MindDock',
  ctxVerify:              'MindDock Proof verifiëren',
  ctxOpenProof:           'Proof URL openen',
  ctxDockFolder:          'Map docken naar MindDock',

  // Dock notificaties
  noToken:                'Plak eerst een API token in de MindDock instellingen',
  noTokenRibbon:          'MindDock: Plak eerst een API token in de plugin instellingen.',
  noScope:                "API token heeft geen 'create_note' permissie",
  dockingFile:            (name: string) => `Docking ${name}...`,
  dockSuccess:            (action: string, hash: string) => `${action}! Hash: ${hash}...`,
  dockError:              (err: string) => `Fout: ${err}`,
  dockFailed:             (msg: string) => `Dock fout: ${msg}`,
  actionUpdated:          'Bijgewerkt',
  actionDocked:           'Gedockt',

  // Verificatie
  verifySuccess:          'Geverifieerd! Content komt overeen met IC bewijs',
  verifyHashNotFound:     'Hash komt overeen met frontmatter maar niet gevonden in MindDock',
  verifyLocalMatch:       'Lokale hash komt overeen met frontmatter',
  verifyModified:         'Content is gewijzigd sinds laatste dock',
  verifyError:            (err: string) => `Verificatie fout: ${err}`,
  notDocked:              'Deze notitie is nog niet gedockt',

  // Verbinding
  noClient:               'MindDock: Geen API token geconfigureerd',
  testingConnection:      'Verbinding testen...',
  connectedPrincipal:     (p: string) => `Verbonden! Principal: ${p}...`,
  connectionFailed:       (err: string) => `Verbinding mislukt: ${err}`,
  noActiveFile:           'Geen actief bestand',

  // Clipboard
  hashCopied:             'Content hash gekopieerd naar klembord',

  // Map docken
  creatingFolders:        (name: string) => `Mapstructuur aanmaken voor "${name}"...`,
  dockingNotes:           (count: number, name: string) => `${count} notities docken in "${name}"...`,
  noNotesInFolder:        (name: string) => `Mapstructuur aangemaakt, geen notities gevonden in "${name}"`,
  folderSuccess:          (folders: number, notes: number, name: string) =>
                            `${folders} mappen + ${notes} notities gedockt uit "${name}"`,
  folderPartial:          (folders: number, notes: number, failed: number, name: string) =>
                            `${folders} mappen, ${notes} gedockt, ${failed} mislukt in "${name}"`,
};

const en: typeof nl = {
  // Status
  statusConnected:        'Connected to MindDock',
  statusTokenInvalid:     'Token invalid or expired',
  statusNotConnected:     'Not connected — paste an API token below',
  statusBarConnected:     (p: string) => `MindDock: ${p}... (IC)`,
  statusBarInvalid:       'MindDock: Token invalid',
  statusBarNoToken:       'MindDock: No token',

  // Token info
  principal:              (p: string) => `Principal: ${p}`,
  scopes:                 (s: string) => `Scopes: ${s}`,
  tokenExpired:           (d: string) => `Token expired on ${d}`,
  tokenExpires:           (days: number, d: string) => `Expires in ${days} days (${d})`,

  // Encryption
  vetkeysActive:          'VetKeys E2E encryption active',
  vetkeysOffline:         'VetKeys temporarily offline — notes will be encrypted locally (local-v1). ' +
                          'Add cycles to the VetKeys canister to resume VetKeys.',
  localEncryption:        'Local encryption active (PBKDF2). Upgrade to a paid plan for VetKeys E2E encryption.',
  encryptionInfo:         'All notes are E2E encrypted with AES-256-GCM before leaving Obsidian. ' +
                          'MindDock servers never see your plaintext content.',

  // Settings — headers
  settingsTitle:          'MindDock Settings',
  sectionApiToken:        'API Token',
  sectionProofOptions:    'Proof Options',

  // Settings — test connection
  testConnectionName:     'Test connection',
  testConnectionDesc:     'Check the connection to Internet Computer',
  testButton:             'Test',
  testSuccess:            (p: string) => `Connected to MindDock\nPrincipal: ${p}...`,
  testFailure:            (err: string) => `Connection failed: ${err}`,

  // Settings — setup instructions
  setupHowTo:             'How to get a token:',
  setupStep1:             'Log in to MindDock (app.minddock.network)',
  setupStep2:             'Go to Settings → API Tokens',
  setupStep3:             "Click 'Create New Token'",
  setupStep4:             'Copy the mdock_... token and paste it below',

  // Settings — token input
  apiTokenName:           'API Token',
  apiTokenDesc:           'Paste your MindDock API token (starts with mdock_)',
  apiTokenPlaceholder:    'mdock_...',
  apiTokenInvalidFormat:  'Invalid token format. Must start with mdock_',

  // Settings — remove token
  removeTokenName:        'Remove token',
  removeTokenDesc:        'Disconnect this Obsidian vault from MindDock',
  removeTokenButton:      'Remove Token',
  removeTokenDone:        'API token removed',

  // Settings — options
  frontmatterName:        'Add proof to frontmatter',
  frontmatterDesc:        'After docking, add MindDock metadata to the note\'s frontmatter',
  showStatusBarName:      'Show status in status bar',
  showStatusBarDesc:      'Show connection and proof status in the status bar',

  // Command names
  cmdDockNote:            'Dock current note to MindDock',
  cmdVerify:              'Verify MindDock proof',
  cmdCopyHash:            'Copy content hash',
  cmdOpenProof:           'Open proof URL in browser',
  cmdTestConnection:      'Test MindDock connection',
  cmdOpenSettings:        'Open MindDock settings',

  // Context menu
  ctxDock:                'Dock to MindDock',
  ctxVerify:              'Verify MindDock Proof',
  ctxOpenProof:           'Open Proof URL',
  ctxDockFolder:          'Dock folder to MindDock',

  // Dock notifications
  noToken:                'Please paste an API token in MindDock settings first',
  noTokenRibbon:          'MindDock: Please paste an API token in the plugin settings.',
  noScope:                "API token does not have 'create_note' permission",
  dockingFile:            (name: string) => `Docking ${name}...`,
  dockSuccess:            (action: string, hash: string) => `${action}! Hash: ${hash}...`,
  dockError:              (err: string) => `Error: ${err}`,
  dockFailed:             (msg: string) => `Dock error: ${msg}`,
  actionUpdated:          'Updated',
  actionDocked:           'Docked',

  // Verification
  verifySuccess:          'Verified! Content matches IC proof',
  verifyHashNotFound:     'Hash matches frontmatter but not found in MindDock',
  verifyLocalMatch:       'Local hash matches frontmatter',
  verifyModified:         'Content has been modified since last dock',
  verifyError:            (err: string) => `Verification error: ${err}`,
  notDocked:              'This note has not been docked yet',

  // Connection
  noClient:               'MindDock: No API token configured',
  testingConnection:      'Testing connection...',
  connectedPrincipal:     (p: string) => `Connected! Principal: ${p}...`,
  connectionFailed:       (err: string) => `Connection failed: ${err}`,
  noActiveFile:           'No active file',

  // Clipboard
  hashCopied:             'Content hash copied to clipboard',

  // Folder docking
  creatingFolders:        (name: string) => `Creating folder structure for "${name}"...`,
  dockingNotes:           (count: number, name: string) => `Docking ${count} notes in "${name}"...`,
  noNotesInFolder:        (name: string) => `Folder structure created, no notes found in "${name}"`,
  folderSuccess:          (folders: number, notes: number, name: string) =>
                            `${folders} folders + ${notes} notes docked from "${name}"`,
  folderPartial:          (folders: number, notes: number, failed: number, name: string) =>
                            `${folders} folders, ${notes} docked, ${failed} failed in "${name}"`,
};

// ============================================================
// Taaldetectie + t() functie
// ============================================================

type Translations = typeof nl;

const TRANSLATIONS: Record<string, Translations> = { nl, en };

function getLocale(): string {
  const momentLocale: string = (window as any).moment?.locale?.() ?? '';
  if (momentLocale) return momentLocale.split('-')[0];
  return navigator.language.split('-')[0] ?? 'en';
}

export function t<K extends keyof Translations>(
  key: K,
  ...args: Translations[K] extends (...a: infer A) => string ? A : []
): string {
  const locale = getLocale();
  const dict = TRANSLATIONS[locale] ?? en;
  const value = dict[key] ?? en[key];
  if (typeof value === 'function') {
    return (value as (...a: unknown[]) => string)(...args);
  }
  return value as string;
}
