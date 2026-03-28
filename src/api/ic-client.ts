/**
 * MindDock IC Direct Client
 * 
 * Communicates directly with IC canisters using a DelegationIdentity
 * reconstructed from an API token. No REST API needed.
 * 
 * VetKeys Encryption Pattern (volgt src/lib/services/vetkeys.ts):
 * 1. TransportSecretKey.random()   -- ephemeral sleutelpaar
 * 2. encrypted_symmetric_key_for_context(context, tsk.publicKeyBytes())
 * 3. symmetric_key_verification_key()
 * 4. EncryptedVetKey.deserialize() + decryptAndVerify(tsk, dpk, input)
 * 5. vetKey.asDerivedKeyMaterial().deriveAesGcmCryptoKey(label)
 * 6. AES-GCM encrypt/decrypt met de afgeleide CryptoKey
 */

import { HttpAgent, Actor } from '@dfinity/agent';
import { IDL } from '@dfinity/candid';
import { Ed25519KeyIdentity, DelegationChain, DelegationIdentity } from '@dfinity/identity';
import { Principal } from '@dfinity/principal';
import { sha256, sha256Async } from '../crypto/hash';

// @dfinity/vetkeys wordt lazy geladen (WASM) — zie fetchVetKey()
type TransportSecretKeyType = import('@dfinity/vetkeys').TransportSecretKey;
type EncryptedVetKeyType    = import('@dfinity/vetkeys').EncryptedVetKey;
type DerivedPublicKeyType   = import('@dfinity/vetkeys').DerivedPublicKey;

// ============================================
// Token Types
// ============================================

interface TokenPayloadV2 {
  version: 2;
  id: string;
  scopes: string[];
  expiresAt: number;
  delegations: any; // Serialized DelegationChain JSON
  sessionKey: number[]; // Oud veld — kan leeg zijn bij @dfinity/identity >= 2.x
  /** Nieuw formaat: [pubKeyHex, secretKeyHex] via Ed25519KeyIdentity.toJSON() */
  sessionKeyJson?: [string, string];
  principalId: string;
  satelliteId: string;
  vetKeysCanisterId: string;
}

interface TokenPayloadV1 {
  version: 1;
  id: string;
  scopes: string[];
  expiresAt: number;
  sessionKey: number[];
  /** Nieuw formaat: [pubKeyHex, secretKeyHex] via Ed25519KeyIdentity.toJSON() */
  sessionKeyJson?: [string, string];
  publicKey: number[];
  principalId: string;
  satelliteId: string;
  vetKeysCanisterId: string;
}

interface TokenPayloadV3 {
  version: 3;
  id: string;
  scopes: string[];
  expiresAt: number;
  delegations: any; // Serialized DelegationChain JSON
  sessionKey: number[];
  /** Nieuw formaat: [pubKeyHex, secretKeyHex] via Ed25519KeyIdentity.toJSON() */
  sessionKeyJson?: [string, string];
  principalId: string;
  /** Juno user.key — gebruikt voor local-v1 sleutelafleiding */
  junoUserKey?: string;
  /** 'local-v1' of 'vetkeys-v1' — bepaald bij token-aanmaak door web app */
  encryptionMode?: 'local-v1' | 'vetkeys-v1';
  satelliteId: string;
  vetKeysCanisterId: string;
}

type TokenPayload = TokenPayloadV1 | TokenPayloadV2 | TokenPayloadV3;

// ============================================
// Encryption Version
// ============================================

type EncryptionVersion = 'local-v1' | 'vetkeys-v1' | 'mock-v1'; // mock-v1 = legacy alias voor local-v1

// ============================================
// Juno Satellite Candid IDL
// ============================================

const junoSatelliteIdl = ({ IDL: idl }: { IDL: typeof IDL }) => {
  const SetDoc = idl.Record({
    'data': idl.Vec(idl.Nat8),
    'description': idl.Opt(idl.Text),
    'version': idl.Opt(idl.Nat64),
  });

  const Doc = idl.Record({
    'owner': idl.Principal,
    'data': idl.Vec(idl.Nat8),
    'description': idl.Opt(idl.Text),
    'created_at': idl.Nat64,
    'updated_at': idl.Nat64,
    'version': idl.Opt(idl.Nat64),
  });

  const ListOrder = idl.Record({
    'field': idl.Variant({ 'Keys': idl.Null, 'CreatedAt': idl.Null, 'UpdatedAt': idl.Null }),
    'desc': idl.Bool,
  });

  const ListPaginate = idl.Record({
    'start_after': idl.Opt(idl.Text),
    'limit': idl.Opt(idl.Nat64),
  });

  const ListParams = idl.Record({
    'matcher': idl.Opt(idl.Record({
      'key': idl.Opt(idl.Text),
      'description': idl.Opt(idl.Text),
    })),
    'paginate': idl.Opt(ListPaginate),
    'order': idl.Opt(ListOrder),
    'owner': idl.Opt(idl.Principal),
  });

  const ListResults = idl.Record({
    'items': idl.Vec(idl.Tuple(idl.Text, Doc)),
    'items_length': idl.Nat64,
    'items_page': idl.Opt(idl.Nat64),
    'matches_length': idl.Nat64,
    'matches_pages': idl.Opt(idl.Nat64),
  });

  return idl.Service({
    'set_doc': idl.Func([idl.Text, idl.Text, SetDoc], [Doc], []),
    'get_doc': idl.Func([idl.Text, idl.Text], [idl.Opt(Doc)], ['query']),
    'list_docs': idl.Func([idl.Text, ListParams], [ListResults], ['query']),
    'del_doc': idl.Func([idl.Text, idl.Text, idl.Record({ 'version': idl.Opt(idl.Nat64) })], [], []),
  });
};

// ============================================
// VetKeys Canister Candid IDL
// ============================================

const vetKeysIdl = ({ IDL: idl }: { IDL: typeof IDL }) => {
  return idl.Service({
    'whoami': idl.Func([], [idl.Text], []),
    'symmetric_key_verification_key': idl.Func([], [idl.Text], []),
    'encrypted_symmetric_key_for_caller': idl.Func([idl.Vec(idl.Nat8)], [idl.Text], []),
    'encrypted_symmetric_key_for_context': idl.Func([idl.Text, idl.Vec(idl.Nat8)], [idl.Text], []),
  });
};

// ============================================
// Hulpfuncties
// ============================================

function hexDecode(hexString: string): Uint8Array {
  const matches = hexString.match(/.{1,2}/g);
  if (!matches) return new Uint8Array(0);
  return Uint8Array.from(matches.map((byte) => parseInt(byte, 16)));
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...Array.from(bytes)));
}

function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

// ============================================
// VetKeys Plugin Encryptie
// ============================================

interface VetKeysActorInterface {
  whoami: () => Promise<string>;
  symmetric_key_verification_key: () => Promise<string>;
  encrypted_symmetric_key_for_caller: (transportPk: number[]) => Promise<string>;
  encrypted_symmetric_key_for_context: (context: string, transportPk: number[]) => Promise<string>;
}

class VetKeysPluginEncryption {
  private keyCache: Map<string, CryptoKey> = new Map();
  private actor: VetKeysActorInterface | null = null;
  private userPrincipal: Principal | null = null;
  private mockMode = true;
  /**
   * PrincipalId van de gebruiker (Juno user.key).
   * Altijd ingesteld — ook als VetKeys offline is.
   * Wordt gebrukt voor local-v1 sleutelafleiding zodat de web app de sleutel
   * ook kan reproduceren: PBKDF2(principalId + ":notes", fixed_salt).
   */
  private localPrincipalId: string | null = null;

  /**
   * Sla de principalId op voor local-v1 encryptie.
   * Moet altijd aangeroepen worden, ook als VetKeys offline is.
   */
  setLocalPrincipal(principalId: string): void {
    this.localPrincipalId = principalId;
    console.log('[Local Encryptie] Principal ingesteld voor local-v1:', principalId.slice(0, 20) + '...');
  }

  configure(actor: VetKeysActorInterface, principal: Principal): void {
    this.actor = actor;
    this.userPrincipal = principal;
    this.mockMode = false;
    console.log('[VetKeys Plugin] Geconfigureerd in ECHTE modus (DFINITY patroon)');
  }

  getVersion(): EncryptionVersion {
    return this.mockMode ? 'local-v1' : 'vetkeys-v1';
  }

  isLocalMode(): boolean {
    return this.mockMode;
  }

  /** @deprecated Gebruik isLocalMode() */
  isMock(): boolean {
    return this.mockMode;
  }

  /**
   * Haal VetKey op voor de gegeven context.
   *
   * Volgt DFINITY-patroon (vetkeys.ts):
   * 1. TransportSecretKey.random()
   * 2. encrypted_symmetric_key_for_context(context, transportPk)
   * 3. symmetric_key_verification_key()
   * 4. EncryptedVetKey.deserialize() + decryptAndVerify(tsk, dpk, principal‖context)
   * 5. asDerivedKeyMaterial().deriveAesGcmCryptoKey(label)
   *
   * @dfinity/vetkeys wordt lazy geladen zodat de WASM-module pas ingeladen
   * wordt wanneer VetKeys daadwerkelijk nodig is.
   */
  private async fetchVetKey(context: string): Promise<CryptoKey> {
    const cached = this.keyCache.get(context);
    if (cached) return cached;

    if (!this.actor || !this.userPrincipal) {
      throw new Error('VetKeys actor niet geconfigureerd');
    }

    // Lazy import — @dfinity/vetkeys bevat een WASM-module
    const vetkd = await import('@dfinity/vetkeys');

    // Stap 1: tijdelijk sleutelpaar
    const tsk = vetkd.TransportSecretKey.random();

    // Stap 2 + 3: haal versleutelde sleutel en verificatiesleutel PARALLEL op
    const [encryptedKeyHex, pkBytesHex] = await Promise.all([
      this.actor.encrypted_symmetric_key_for_context(
        context,
        Array.from(tsk.publicKeyBytes())
      ),
      this.actor.symmetric_key_verification_key(),
    ]);

    // Stap 4: deserialiseer en ontsleutel + verifieer
    const encryptedVetKey = vetkd.EncryptedVetKey.deserialize(hexDecode(encryptedKeyHex));
    const dpk = vetkd.DerivedPublicKey.deserialize(hexDecode(pkBytesHex));

    // Input = principal‖context  (identiek aan canister-zijde)
    const principalBytes = this.userPrincipal.toUint8Array();
    const contextBytes   = new TextEncoder().encode(context);
    const input = new Uint8Array(principalBytes.length + contextBytes.length);
    input.set(principalBytes);
    input.set(contextBytes, principalBytes.length);

    const vetKey = encryptedVetKey.decryptAndVerify(tsk, dpk, input);

    // Stap 5: leid AES-GCM-sleutel af
    const derivedMaterial = await vetKey.asDerivedKeyMaterial();
    const aesKey = await derivedMaterial.deriveAesGcmCryptoKey(`minddock:${context}`);

    this.keyCache.set(context, aesKey);
    console.log(`[VetKeys Plugin] ✓ Sleutel afgeleid voor context "${context}"`);

    return aesKey;
  }

  private async vetKeysEncrypt(data: string, context: string): Promise<string> {
    const aesKey = await this.fetchVetKey(context);
    const dataBytes = new TextEncoder().encode(data);
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      aesKey,
      dataBytes.buffer as ArrayBuffer
    );

    const result = new Uint8Array(iv.length + ciphertext.byteLength);
    result.set(iv, 0);
    result.set(new Uint8Array(ciphertext), iv.length);
    return toBase64(result);
  }

  /**
   * Ontsleutel met een VetKey-afgeleide AES-GCM-sleutel.
   *
   * Backward-compat strategie (zelfde als vetkeys.ts):
   * 1. Probeer category-sleutel (bijv. 'notes') — nieuwe aanpak, 1 sleutel per categorie
   * 2. Probeer legacy per-item-sleutel (bijv. 'notes/noteId') — voor eerder versleutelde noten
   */
  private async vetKeysDecrypt(
    encryptedB64: string,
    derivationPath: string,
    itemContext?: string
  ): Promise<string> {
    const encryptedBytes = fromBase64(encryptedB64);
    const iv         = encryptedBytes.slice(0, 12);
    const ciphertext = encryptedBytes.slice(12);

    const tryDecrypt = async (key: CryptoKey) =>
      crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext.buffer as ArrayBuffer);

    // 1. Category-sleutel ('notes')
    try {
      const aesKey   = await this.fetchVetKey(derivationPath);
      const decrypted = await tryDecrypt(aesKey);
      return new TextDecoder().decode(decrypted);
    } catch {
      // Niet versleuteld met category-sleutel → probeer legacy
    }

    // 2. Legacy per-item-sleutel ('notes/noteId') — backward compat
    if (itemContext) {
      const legacyContext = `${derivationPath}/${itemContext}`;
      try {
        const legacyKey  = await this.fetchVetKey(legacyContext);
        const decrypted  = await tryDecrypt(legacyKey);
        console.log(`[VetKeys Plugin] Ontsleuteld met legacy sleutel "${legacyContext}"`);
        return new TextDecoder().decode(decrypted);
      } catch (err) {
        throw new Error(
          `VetKeys ontsleuteling mislukt voor "${derivationPath}" ` +
          `en legacy "${legacyContext}": ${(err as Error).message}`
        );
      }
    }

    throw new Error(`VetKeys ontsleuteling mislukt voor "${derivationPath}"`);
  }

  /**
   * Leid een lokale AES-GCM-sleutel af op basis van de principalId van de gebruiker.
   *
   * local-v1 sleutelafleiding (COMPATIBEL MET WEB APP):
   *   keyMaterial = principalId + ":" + derivationPath  (bijv. "abc...xyz:notes")
   *   key = AES-256-GCM via PBKDF2(keyMaterial, 'minddock-local-key-v1')
   *
   * Beide kant (plugin EN web app) kennen de principalId (= Juno user.key),
   * dus de sleutel is reproduceerbaar aan beide kanten → noten zijn leesbaar
   * in MindDock zelfs zonder VetKeys cycles.
   *
   * OPMERKING: dit is GEEN echte E2E encryptie — de principalId is publiek op IC.
   * Voor de gratis tier (geen VetKeys) is dit acceptabel en bewust zo gekozen.
   * Gebruikers met betaald plan krijgen VetKeys (echte E2E encryptie).
   */
  private async localDeriveKey(derivationPath: string): Promise<CryptoKey> {
    // Gebruik principalId als primaire input; val terug op derivationPath als
    // principalId niet beschikbaar is (configuratiefout).
    const principalPart = this.localPrincipalId || `nokey`;
    const cacheKey = `local:${principalPart}:${derivationPath}`;
    const cached = this.keyCache.get(cacheKey);
    if (cached) return cached;

    const encoder = new TextEncoder();
    // keyMaterial = principalId + ":" + derivationPath — reproduceerbaar door web app
    const keyMaterial = `${principalPart}:${derivationPath}`;
    const keyData = encoder.encode(keyMaterial);

    const importedKey = await crypto.subtle.importKey(
      'raw', keyData, { name: 'PBKDF2' }, false, ['deriveBits']
    );

    const keyBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: encoder.encode('minddock-local-key-v1'), // vaste salt, v1 slot
        iterations: 100000,
        hash: 'SHA-256'
      },
      importedKey,
      256
    );

    const cryptoKey = await crypto.subtle.importKey(
      'raw', keyBits, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );

    this.keyCache.set(cacheKey, cryptoKey);
    return cryptoKey;
  }

  /**
   * Legacy mock-v1 sleutelafleiding (backward compat voor eerder aangemaakte noten).
   * NIET compatibel met web app — alleen voor decryptie van oude plugin-noten.
   */
  private async legacyMockDeriveKey(derivationPath: string, context: string): Promise<CryptoKey> {
    const cacheKey = `mock:${derivationPath}:${context}`;
    const cached = this.keyCache.get(cacheKey);
    if (cached) return cached;

    const encoder = new TextEncoder();
    const keyMaterial = `${derivationPath}:${context}`;
    const keyData = encoder.encode(keyMaterial);

    const importedKey = await crypto.subtle.importKey(
      'raw', keyData, { name: 'PBKDF2' }, false, ['deriveBits']
    );

    const keyBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: encoder.encode('minddock-vetkeys-mock-salt'),
        iterations: 100000,
        hash: 'SHA-256'
      },
      importedKey,
      256
    );

    const cryptoKey = await crypto.subtle.importKey(
      'raw', keyBits, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );

    this.keyCache.set(cacheKey, cryptoKey);
    return cryptoKey;
  }

  private async localEncrypt(data: string, derivationPath: string): Promise<string> {
    const key = await this.localDeriveKey(derivationPath);
    const encoder = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, key, encoder.encode(data)
    );

    const result = new Uint8Array(iv.length + encrypted.byteLength);
    result.set(iv, 0);
    result.set(new Uint8Array(encrypted), iv.length);
    return toBase64(result);
  }

  private async localDecrypt(
    encryptedB64: string,
    derivationPath: string,
    legacyContext?: string
  ): Promise<string> {
    const encryptedBytes = fromBase64(encryptedB64);
    const iv = encryptedBytes.slice(0, 12);
    const ciphertext = encryptedBytes.slice(12);

    const tryWithKey = async (key: CryptoKey): Promise<string> => {
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv }, key, ciphertext
      );
      return new TextDecoder().decode(decrypted);
    };

    // Stap 1: probeer local-v1 sleutel (principal-gebaseerd, web app-compatibel)
    try {
      const key = await this.localDeriveKey(derivationPath);
      return await tryWithKey(key);
    } catch {
      // Niet versleuteld met local-v1 sleutel → probeer legacy
    }

    // Stap 2: probeer legacy mock-v1 sleutel (backward compat met oude plugin-noten)
    if (legacyContext) {
      try {
        const key = await this.legacyMockDeriveKey(derivationPath, legacyContext);
        const result = await tryWithKey(key);
        console.log(`[Local Encryptie] Ontsleuteld met legacy mock-v1 sleutel voor "${derivationPath}"`);
        return result;
      } catch { /* geeft hieronder een fout */ }
    }

    throw new Error(`Local ontsleuteling mislukt voor "${derivationPath}"`);
  }

  async encrypt(
    data: string,
    derivationPath: string,
    itemContext: string
  ): Promise<{ ciphertext: string; version: EncryptionVersion }> {
    // Echte VetKeys: gebruik derivationPath als context
    // (bijv. 'notes' → 1 sleutel voor alle noten; geen canister-call per noot)
    if (!this.mockMode) {
      try {
        const ciphertext = await this.vetKeysEncrypt(data, derivationPath);
        return { ciphertext, version: 'vetkeys-v1' };
      } catch (err) {
        console.warn('[VetKeys Plugin] VetKeys versleuteling mislukt, val terug op local-v1:', err);
      }
    }

    // Local-v1: principal-gebaseerde sleutel (compatibel met MindDock web app)
    const ciphertext = await this.localEncrypt(data, derivationPath);
    return { ciphertext, version: 'local-v1' };
  }

  async decrypt(
    encryptedB64: string,
    derivationPath: string,
    itemContext: string,
    version: EncryptionVersion = 'local-v1'
  ): Promise<string> {
    if (version === 'vetkeys-v1' && !this.mockMode) {
      try {
        // Geeft legacy fallback mee (backward-compat met noten versleuteld vóór categorie-sleutel)
        return await this.vetKeysDecrypt(encryptedB64, derivationPath, itemContext);
      } catch (err) {
        console.warn('[VetKeys Plugin] VetKeys-ontsleuteling mislukt, val terug op local-v1:', err);
      }
    }

    // local-v1 en mock-v1 (legacy): gebruik localDecrypt met backward compat
    return this.localDecrypt(encryptedB64, derivationPath, itemContext);
  }

  clear(): void {
    this.keyCache.clear();
    this.actor = null;
    this.userPrincipal = null;
    this.mockMode = true;
  }
}

// ============================================
// IC Direct Client
// ============================================

export interface DockResult {
  success: boolean;
  noteId?: string;
  contentHash?: string;
  icTimestamp?: number;
  proofUrl?: string;
  isUpdate?: boolean;
  encryptionVersion?: EncryptionVersion;
  error?: string;
}

export interface VerifyResult {
  success: boolean;
  verified?: boolean;
  timestamp?: number;
  message?: string;
  error?: string;
}

export class MindDockICClient {
  private payload: TokenPayload;
  private identity: any;
  private agent: HttpAgent | null = null;
  private satelliteActor: any = null;
  private vetKeysActor: any = null;
  private encryption: VetKeysPluginEncryption;
  private principal: Principal | null = null;
  /**
   * Authoratief principal ID voor UI-display.
   * Ingesteld door whoami() na initialize() — wat de IC canister daadwerkelijk
   * als caller() ziet via de DelegationChain.
   * Fallback: payload.principalId (Juno user.key).
   */
  private displayPrincipalId: string | null = null;

  constructor(apiToken: string) {
    if (!apiToken.startsWith('mdock_')) {
      throw new Error('Ongeldig token: moet beginnen met mdock_');
    }

    this.payload = JSON.parse(atob(apiToken.slice(6)));

    if (Date.now() > this.payload.expiresAt) {
      throw new Error('API token is verlopen');
    }

    this.encryption = new VetKeysPluginEncryption();
  }

  /**
   * Lees de junoUserKey uit het token.
   * Prioriteit: junoUserKey (v3) → principalId (v1/v2 backward compat)
   * NOOIT: sessionKey.getPrincipal() of DelegationIdentity.getPrincipal()
   */
  private getJunoUserKey(): string | null {
    const p = this.payload as any;
    return p.junoUserKey || p.principalId || null;
  }

  /**
   * Lees de encryptionMode uit het token.
   * v3 tokens: expliciet veld
   * v1/v2 tokens: default local-v1 (safe, nooit VetKeys als we het niet weten)
   */
  private getEncryptionMode(): 'local-v1' | 'vetkeys-v1' {
    const p = this.payload as any;
    if (p.encryptionMode === 'vetkeys-v1') return 'vetkeys-v1';
    return 'local-v1';
  }

  /**
   * Herstel Ed25519KeyIdentity uit token payload.
   * 
   * Ondersteunt twee formaten:
   * - Nieuw (sessionKeyJson): [pubKeyHex, secKeyHex] via .toJSON() -- werkt altijd
   * - Oud (sessionKey bytes): raw number[] -- werkt alleen als array niet leeg is
   * 
   * De fout "private key of length 32 expected, got 0" treedt op bij het oude
   * formaat als @dfinity/identity >= 2.x een CryptoKey opslaat in plaats van bytes.
   * Fix: gebruik sessionKeyJson dat altijd hex strings bevat.
   */
  private resolveSessionKey(
    sessionKey: number[],
    sessionKeyJson?: [string, string]
  ): Ed25519KeyIdentity {
    // PRIORITEIT 1: raw bytes — zelfde methode als de werkende backup-versie (fromSecretKey).
    // Werkt met zowel 32-byte (noble/ed25519 seed) als 64-byte (tweetnacl keypair) formaat.
    if (sessionKey && (sessionKey.length === 64 || sessionKey.length === 32)) {
      console.log(`[MindDock IC] Session key hersteld via ${sessionKey.length}-byte array (raw bytes — primair)`);
      return Ed25519KeyIdentity.fromSecretKey(new Uint8Array(sessionKey));
    }

    // PRIORITEIT 2: JSON formaat — alleen als raw bytes niet beschikbaar zijn (leeg/ontbrekend).
    // Kan optreden als de browser WebCrypto non-extractable keys gebruikt.
    if (sessionKeyJson && sessionKeyJson.length === 2 &&
        sessionKeyJson[0] && sessionKeyJson[1]) {
      const identity = Ed25519KeyIdentity.fromJSON(JSON.stringify(sessionKeyJson));
      console.log('[MindDock IC] Session key hersteld via sessionKeyJson (fallback formaat)');
      return identity;
    }

    // Geen bruikbare sleutel
    throw new Error(
      `Token bevat geen bruikbare session key ` +
      `(sessionKey.length=${sessionKey?.length ?? 0}, sessionKeyJson=${!!sessionKeyJson}). ` +
      `Maak een NIEUW token aan in MindDock: Instellingen > API Tokens > Nieuw Token Aanmaken.`
    );
  }

  /**
   * Initialiseer: herstel identity, maak agent en actors aan.
   */
  async initialize(): Promise<void> {
    // Herstel identity uit token
    if (this.payload.version === 2 || this.payload.version === 3) {
      const p = this.payload as TokenPayloadV2 | TokenPayloadV3;
      const sessionKey = this.resolveSessionKey(p.sessionKey, p.sessionKeyJson);
      if (!p.delegations) {
        throw new Error(
          'Token bevat geen delegationChain (delegations ontbreekt). ' +
          'Dit token is waarschijnlijk een fallback-token door een principal mismatch bij aanmaak. ' +
          'Log uit en opnieuw in via MindDock en maak een NIEUW token aan.'
        );
      }
      const chain = DelegationChain.fromJSON(p.delegations);
      this.identity = DelegationIdentity.fromDelegation(sessionKey, chain);
    } else {
      // v1: standalone sleutel (geen Juno schrijftoegang, mock encryptie)
      const p1 = this.payload as TokenPayloadV1;
      this.identity = this.resolveSessionKey(p1.sessionKey, p1.sessionKeyJson);
    }

    // Maak agent
    this.agent = await HttpAgent.create({
      identity: this.identity,
      host: 'https://icp-api.io',
    });

    this.principal = await this.agent.getPrincipal();
    console.log('[MindDock IC] Verbonden als:', this.principal.toText().slice(0, 20) + '...');
    console.log('[MindDock IC] Token versie:', this.payload.version);

    // Satellite actor (Juno document CRUD)
    if (this.payload.satelliteId) {
      this.satelliteActor = Actor.createActor(junoSatelliteIdl as any, {
        agent: this.agent,
        canisterId: this.payload.satelliteId,
      });
      console.log('[MindDock IC] Satellite:', this.payload.satelliteId);
    }

    // Local principal instellen voor local-v1 encryptie.
    // GEBRUIK ALTIJD junoUserKey (v3) of principalId (v1/v2), NOOIT session key principal.
    const junoUserKey = this.getJunoUserKey();
    if (junoUserKey) {
      this.encryption.setLocalPrincipal(junoUserKey);
      this.displayPrincipalId = junoUserKey; // vroeg initialiseren als fallback
    }

    // Encryptie-modus: bepaald door token (v3) of standaard local-v1 voor oude tokens
    const tokenEncryptionMode = this.getEncryptionMode();
    console.log(`[MindDock IC] Token encryptionMode: ${tokenEncryptionMode}`);

    // VetKeys actor — alleen als token encryptionMode = vetkeys-v1 EN canisterId aanwezig
    if (tokenEncryptionMode === 'vetkeys-v1' && this.payload.vetKeysCanisterId) {
      this.vetKeysActor = Actor.createActor(vetKeysIdl as any, {
        agent: this.agent,
        canisterId: this.payload.vetKeysCanisterId,
      });
      console.log('[MindDock IC] VetKeys canister:', this.payload.vetKeysCanisterId);

      // whoami() = wat de IC canister daadwerkelijk als caller() ziet via de DelegationChain.
      let realPrincipal: Principal = this.principal!;
      try {
        const whoamiResult: string = await this.vetKeysActor.whoami();
        realPrincipal = Principal.fromText(whoamiResult);
        this.displayPrincipalId = whoamiResult; // ← authoratief voor display
        console.log('[MindDock IC] whoami() (authoratief principal):', whoamiResult.slice(0, 25) + '...');
      } catch {
        // VetKeys canister offline → gebruik junoUserKey als realPrincipal
        if (junoUserKey) {
          realPrincipal = Principal.fromText(junoUserKey);
          console.warn('[MindDock IC] whoami() mislukt — gebruik junoUserKey als realPrincipal:', junoUserKey.slice(0, 25) + '...');
        } else {
          console.warn('[MindDock IC] whoami() mislukt én geen junoUserKey — VetKeys encryptie onbetrouwbaar');
        }
      }

      this.encryption.configure(this.vetKeysActor, realPrincipal);
    } else if (tokenEncryptionMode === 'local-v1') {
      // Bewust local-v1 modus (trial of oud token) — encryption al geconfigureerd via setLocalPrincipal()
      console.log('[MindDock IC] local-v1 modus actief (geen VetKeys canister aanroepen)');
    }
  }

  getTokenInfo(): { id: string; scopes: string[]; expiresAt: number; principalId: string; version: number } {
    // AUTHORATIEF: gebruik displayPrincipalId (gezet door whoami() in initialize()).
    //
    // whoami() = wat de IC VetKeys canister als caller() ziet = identiek aan wat
    // Juno/MindDock als jouw user principal toont.
    //
    // Fallback: payload.principalId (Juno user.key — gezet bij token-aanmaak)
    //
    // agent.getPrincipal() voor een DelegationIdentity = INNER session key principal
    //   → NIET weergeven, dit is de ephemeral delegatee key, niet de Juno user.key
    return {
      id: this.payload.id,
      scopes: this.payload.scopes,
      expiresAt: this.payload.expiresAt,
      principalId: this.displayPrincipalId ?? this.payload.principalId,
      version: this.payload.version,
    };
  }

  getEncryptionVersion(): EncryptionVersion {
    return this.encryption.getVersion();
  }

  /** Geeft de encryptionMode terug zoals opgeslagen in het token */
  getTokenEncryptionMode(): 'local-v1' | 'vetkeys-v1' {
    return this.getEncryptionMode();
  }

  /**
   * Maak of update een map-document in de Juno `folders` collection.
   * Gebruikt een deterministisch key op basis van het Obsidian pad → idempotent.
   * @returns de folderId (key) van de aangemaakt/bijgewerkte map
   */
  async dockFolderDoc(
    name: string,
    obsidianPath: string,
    parentId: string | null
  ): Promise<string> {
    if (!this.satelliteActor) {
      throw new Error('Satellite niet geconfigureerd');
    }

    const folderId = `obs_${sha256(obsidianPath).slice(0, 20)}`;
    const now = Date.now();

    // Controleer of map al bestaat (voor version + createdAt bewaren)
    let docVersion: [] | [bigint] = [];
    let createdAt = now;
    try {
      const existing = await this.satelliteActor.get_doc('folders', folderId);
      if (existing && existing.length > 0) {
        docVersion = existing[0].version;
        try {
          const d = JSON.parse(new TextDecoder().decode(new Uint8Array(existing[0].data)));
          createdAt = d.createdAt || now;
        } catch { /* gebruik now */ }
      }
    } catch { /* map bestaat nog niet */ }

    const folderData = {
      version: 1,
      key: folderId,
      name,
      parentId,
      sort: createdAt,
      createdAt,
      updatedAt: now,
      extensions: {},
    };

    const dataBlob = new TextEncoder().encode(JSON.stringify(folderData));
    await this.satelliteActor.set_doc('folders', folderId, {
      data: Array.from(dataBlob),
      description: [],
      version: docVersion,
    });

    console.log(`[MindDock IC] Map gedockt: "${name}" → ${folderId}`);
    return folderId;
  }

  async dock(
    title: string,
    content: string,
    obsidianPath: string,
    existingNoteId?: string,
    folderId?: string | null
  ): Promise<DockResult> {
    if (!this.satelliteActor) {
      return { success: false, error: 'Satellite niet geconfigureerd. Controleer je API token.' };
    }

    try {
      const noteId = existingNoteId || this.generateId();
      const contentHash = sha256(content);
      const now = Date.now();
      const isUpdate = !!existingNoteId;

      const { ciphertext: encryptedContent, version: encVersion } =
        await this.encryption.encrypt(content, 'notes', noteId);

      // Encryptie resultaat loggen — local-v1 is MindDock-compatibel, vetkeys-v1 is
      // volledig E2E versleuteld. Beide zijn leesbaar in de web app.
      if (encVersion === 'local-v1') {
        console.log('[MindDock IC] Encryptie: local-v1 (principal-gebaseerd, web app-compatibel)');
      } else if (encVersion === 'vetkeys-v1') {
        console.log('[MindDock IC] Encryptie: vetkeys-v1 (echte E2E encryptie)');
      }

      const { ciphertext: encryptedTitle } =
        await this.encryption.encrypt(title, 'notes', `${noteId}_title`);

      console.log(`[MindDock IC] Encryptie versie: ${encVersion}`);

      const noteData: Record<string, any> = {
        version: 1,
        key: noteId,
        title: '',
        content: '',
        folderId: folderId ?? null,
        tags: [],
        isPublic: false,
        favorite: false,
        encrypted: true,
        encryptedContent,
        encryptionVersion: encVersion,
        createdAt: isUpdate ? undefined : now,
        updatedAt: now,
        lastEditedBy: 'obsidian-plugin',
        editCount: isUpdate ? 1 : 0,
        extensions: {
          encryptedTitle,
          titleHash: sha256(title.toLowerCase()),
        },
        metadata: {
          obsidianPath,
          contentHash,
          sourceApplication: 'obsidian',
          dockedAt: now,
        },
      };

      // Juno vereist de huidige version bij een update (optimistic concurrency control).
      let docVersion: [] | [bigint] = [];
      // Oude plaintext inhoud voor delta hash en versiegeschiedenis
      let oldPlaintextContent: string | undefined;

      if (isUpdate) {
        try {
          const existing = await this.satelliteActor.get_doc('notes', noteId);
          if (existing && existing.length > 0) {
            const existingData = JSON.parse(new TextDecoder().decode(new Uint8Array(existing[0].data)));
            noteData.createdAt = existingData.createdAt || now;
            noteData.editCount = (existingData.editCount || 0) + 1;
            // Bewaar version voor set_doc — Juno gooit 'no_version_provided' zonder dit
            docVersion = existing[0].version;
            // Ontsleutel oude inhoud voor delta hash en versiegeschiedenis
            if (existingData.encryptedContent) {
              try {
                oldPlaintextContent = await this.encryption.decrypt(
                  existingData.encryptedContent,
                  'notes',
                  noteId,
                  existingData.encryptionVersion || 'local-v1'
                );
              } catch {
                // Kan oude inhoud niet ontsleutelen — delta hash wordt weggelaten
              }
            }
          }
        } catch (e) {
          noteData.createdAt = now;
        }
      } else {
        noteData.createdAt = now;
      }

      const dataBlob = new TextEncoder().encode(JSON.stringify(noteData));

      const result = await this.satelliteActor.set_doc('notes', noteId, {
        data: Array.from(dataBlob),
        description: [],
        version: docVersion,
      });

      console.log('[MindDock IC] Notitie gedockt:', noteId);

      // Versiegeschiedenis opslaan — versionNumber ook doorgeven aan audit entry
      let savedVersionNumber = 1;
      try {
        const latestVersion = await this.getLatestVersionNumber(noteId);
        savedVersionNumber = latestVersion + 1;
        console.log(`[MindDock IC] Versie opslaan: v${savedVersionNumber} voor notitie ${noteId}`);
        await this.saveVersionEntry(noteId, content, savedVersionNumber);
      } catch (versionError) {
        console.error('[MindDock IC] Versie opslag mislukt:', versionError);
      }

      try {
        await this.createAuditEntry(noteId, title, content, isUpdate ? 'note.updated' : 'note.created', oldPlaintextContent, savedVersionNumber);
      } catch (auditError) {
        console.warn('[MindDock IC] Audit trail mislukt (niet-blokkerend):', auditError);
      }

      const proofUrl = `https://app.minddock.network/verify/${contentHash}`;

      return {
        success: true,
        noteId,
        contentHash,
        icTimestamp: Number(result.updated_at),
        proofUrl,
        isUpdate,
        encryptionVersion: encVersion,
      };
    } catch (error) {
      console.error('[MindDock IC] Dock mislukt:', error);
      return {
        success: false,
        error: `Dock mislukt: ${(error as Error).message}`,
      };
    }
  }

  async verify(contentHash: string): Promise<VerifyResult> {
    if (!this.satelliteActor) {
      return { success: false, error: 'Satellite niet geconfigureerd' };
    }

    try {
      const result = await this.satelliteActor.list_docs('notes', {
        matcher: [],
        paginate: [{ start_after: [], limit: [BigInt(100)] }],
        order: [{ field: { UpdatedAt: null }, desc: true }],
        owner: [],
      });

      for (const [key, doc] of result.items) {
        try {
          const noteData = JSON.parse(new TextDecoder().decode(new Uint8Array(doc.data)));
          if (noteData.metadata?.contentHash === contentHash) {
            return {
              success: true,
              verified: true,
              timestamp: Number(doc.updated_at),
              message: `Geverifieerd! Notitie "${key}" komt overeen.`,
            };
          }
        } catch { /* sla niet-parseerbare docs over */ }
      }

      return { success: true, verified: false, message: 'Hash niet gevonden in MindDock' };
    } catch (error) {
      return { success: false, error: `Verificatie mislukt: ${(error as Error).message}` };
    }
  }

  async testConnection(): Promise<{ success: boolean; principal?: string; error?: string }> {
    if (!this.agent || !this.principal) {
      return { success: false, error: 'Niet geinitialiseerd' };
    }

    // Gebruik whoami()-resultaat (authoratief) — consistent met getTokenInfo()
    const displayPrincipal = this.displayPrincipalId ?? this.payload.principalId;

    if (this.vetKeysActor) {
      try {
        const whoamiResult: string = await this.vetKeysActor.whoami();
        // whoami() retourneert wat de canister ziet als caller(); dit kan de
        // DelegationIdentity-principal zijn (session key) of de Juno user.key,
        // afhankelijk van de IC delegation semantiek. Voor display gebruiken we
        // altijd payload.principalId.
        console.log('[MindDock IC] testConnection whoami():', whoamiResult.slice(0, 30) + '...');
        return { success: true, principal: displayPrincipal };
      } catch {
        // VetKeys canister niet beschikbaar (bijv. geen cycles) —
        // normaal bedrijf, plugin valt terug op lokale sleutels.
        return { success: true, principal: displayPrincipal };
      }
    }

    return { success: true, principal: displayPrincipal };
  }

  hasScope(scope: string): boolean {
    if (this.payload.scopes.includes('full_access')) return true;
    return this.payload.scopes.includes(scope);
  }

  isFullToken(): boolean {
    return this.payload.version === 2 || this.payload.version === 3;
  }

  private async createAuditEntry(
    noteId: string,
    title: string,
    content: string,
    action: 'note.created' | 'note.updated',
    oldContent?: string,
    versionNumber?: number
  ): Promise<void> {
    if (!this.satelliteActor) return;

    const auditId = this.generateId();
    const now = Date.now();
    const principalText = this.displayPrincipalId ?? this.payload.principalId;
    // Gebruik dezelfde normalisatie en hash-methode als de web app's generateContentHash:
    // SHA-256(JSON.stringify(content.trim().replace(/\r\n/g, '\n')))
    const normalizedNew = content.trim().replace(/\r\n/g, '\n');
    const contentHashAfter = await sha256Async(JSON.stringify(normalizedNew));

    const actor = {
      userId: principalText,
      userPrincipal: principalText,
      deviceInfo: {
        userAgent: 'Obsidian MindDock Plugin',
        browser: 'Obsidian',
        browserVersion: '',
        os: 'Desktop',
        deviceType: 'desktop' as const,
        screenResolution: '',
      },
    };

    const context = {
      ipAddress: 'plugin',
      userAgent: 'Obsidian MindDock Plugin',
      sessionId: `obsidian-${Date.now()}`,
    };

    // Bereken content hash (voor+na) en delta hash bij updates
    const contentHash: Record<string, any> = {
      after: contentHashAfter,
      algorithm: 'SHA-256',
      timestamp: now,
      // versionNumber koppelt de audit entry aan de versie in content_versions
      // — vereist door VersionListItem om "Verifieer Hash" knop te tonen
      ...(versionNumber !== undefined ? { versionNumber } : {}),
    };

    let deltaHash: Record<string, any> | undefined;

    if (action === 'note.updated' && oldContent !== undefined) {
      const normalizedOld = oldContent.trim().replace(/\r\n/g, '\n');
      contentHash.before = await sha256Async(JSON.stringify(normalizedOld));

      const stats = this.calculateDiffStats(normalizedOld, normalizedNew);
      deltaHash = {
        diffHash: sha256(normalizedOld + '\x00' + normalizedNew),
        addedLines: stats.addedLines,
        removedLines: stats.removedLines,
        changedLines: stats.changedLines,
        addedChars: stats.addedChars,
        removedChars: stats.removedChars,
        changePercentage: stats.changePercentage,
        isMinorEdit: stats.isMinorEdit,
        isMajorRewrite: stats.isMajorRewrite,
      };
    }

    const entryWithoutSig: Record<string, any> = {
      version: 1,
      id: auditId,
      timestamp: now,
      action,
      resourceType: 'note',
      resourceId: noteId,
      resourceTitle: title,
      actor,
      context,
      contentHash,
      chainIndex: 0,
      previousHash: undefined,
    };

    if (deltaHash) {
      entryWithoutSig.deltaHash = deltaHash;
    }

    const signatureHash = sha256(JSON.stringify(entryWithoutSig));
    const auditEntry = {
      ...entryWithoutSig,
      signature: { hash: signatureHash, algorithm: 'SHA-256', timestamp: now },
    };

    const dataBlob = new TextEncoder().encode(JSON.stringify(auditEntry));
    await this.satelliteActor.set_doc('audit_logs', auditId, {
      data: Array.from(dataBlob),
      description: [],
      version: [],
    });
  }

  private calculateDiffStats(oldContent: string, newContent: string): {
    addedLines: number;
    removedLines: number;
    changedLines: number;
    addedChars: number;
    removedChars: number;
    changePercentage: number;
    isMinorEdit: boolean;
    isMajorRewrite: boolean;
  } {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    const minLen = Math.min(oldLines.length, newLines.length);

    let changedLines = 0;
    for (let i = 0; i < minLen; i++) {
      if (oldLines[i] !== newLines[i]) changedLines++;
    }

    const addedLines = Math.max(0, newLines.length - oldLines.length);
    const removedLines = Math.max(0, oldLines.length - newLines.length);
    const addedChars = Math.max(0, newContent.length - oldContent.length);
    const removedChars = Math.max(0, oldContent.length - newContent.length);

    const maxLen = Math.max(oldContent.length, newContent.length);
    const rawPct = maxLen > 0
      ? Math.round((Math.abs(newContent.length - oldContent.length) + changedLines * 5) / maxLen * 100)
      : 0;
    const changePercentage = Math.min(rawPct, 100);

    return {
      addedLines,
      removedLines,
      changedLines,
      addedChars,
      removedChars,
      changePercentage,
      isMinorEdit: changePercentage < 20,
      isMajorRewrite: changePercentage > 80,
    };
  }

  private async getLatestVersionNumber(noteId: string): Promise<number> {
    try {
      const result = await this.satelliteActor.list_docs('content_versions', {
        matcher: [{ key: [`${noteId}_v`], description: [] }],
        paginate: [],
        order: [],
        owner: [],
      });
      let max = 0;
      for (const [key] of result.items) {
        const match = (key as string).match(/_v(\d+)$/);
        if (match) {
          const n = parseInt(match[1], 10);
          if (n > max) max = n;
        }
      }
      return max;
    } catch {
      return 0;
    }
  }

  private async saveVersionEntry(noteId: string, content: string, versionNumber: number): Promise<void> {
    const timestamp = Date.now();
    const isVetKeys = this.encryption.getVersion() === 'vetkeys-v1';

    let storedContent: string;
    let encrypted: boolean;

    if (isVetKeys) {
      // vetkeys-v1: versleutel met dezelfde context als de web app ('version')
      // → web app kan decrypten met VersionStorage.decryptContent(content, noteId)
      const { ciphertext } = await this.encryption.encrypt(content, 'version', noteId);
      storedContent = ciphertext;
      encrypted = true;
    } else {
      // local-v1: web app heeft geen local-v1 decryptie voor versies
      // → sla ruwe plaintext op zodat preview én hash-verificatie correct werken
      storedContent = content;
      encrypted = false;
    }

    const versionData = {
      noteId,
      version: versionNumber,
      timestamp,
      data: {
        version: versionNumber,
        content: storedContent,
        timestamp,
        isSnapshot: true,
        encrypted,
      },
    };

    const key = `${noteId}_v${versionNumber}`;
    const dataBlob = new TextEncoder().encode(JSON.stringify(versionData));
    await this.satelliteActor.set_doc('content_versions', key, {
      data: Array.from(dataBlob),
      description: [`Version ${versionNumber} of note ${noteId}`],
      version: [],
    });
    console.log(`[MindDock IC] Versie ${versionNumber} opgeslagen (${isVetKeys ? 'vetkeys-v1' : 'local-v1 plaintext'}) voor notitie ${noteId}`);
  }

  private generateId(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
    const bytes = crypto.getRandomValues(new Uint8Array(21));
    let id = '';
    for (const byte of bytes) {
      id += chars[byte % chars.length];
    }
    return id;
  }

  /**
   * Get the rank badge for the current user from the user_ranks collection.
   * Returns a badge string (emoji + label), falls back to '🚢 Passenger'.
   */
  async getUserRankBadge(): Promise<string> {
    if (!this.satelliteActor) return 'ship';
    try {
      const result = await this.satelliteActor.get_doc('user_ranks', this.payload.principalId);
      const doc = result && 'Ok' in result ? result.Ok : (Array.isArray(result) && result[0] ? result[0] : null);
      if (!doc?.data) return 'ship';

      const record = JSON.parse(new TextDecoder().decode(new Uint8Array(doc.data)));
      // Returns Lucide icon names (kebab-case) — used by Obsidian's setIcon API
      const ranks: Record<string, string> = {
        passenger:      'ship',
        deckhand:       'anchor',
        navigator:      'compass',
        first_mate:     'map',
        captain:        'sailboat',
        admiral:        'award',
        lighthouse_dao: 'tower-control',
      };
      return ranks[record.rank] ?? 'ship';
    } catch {
      return 'ship';
    }
  }

  destroy(): void {
    this.encryption.clear();
    this.agent = null;
    this.satelliteActor = null;
    this.vetKeysActor = null;
  }
}
