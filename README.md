# MindDock for Obsidian

**Blockchain-verified proof of authorship for your notes.**

Dock your Obsidian notes to the [Internet Computer](https://internetcomputer.org/) blockchain — creating an unforgeable timestamp that proves *you* wrote something at a specific moment in time. Even the server can't manipulate the record.

> ⚓ **Public beta** — free 14-day trial, no credit card required.

---

## What it does

- **Prove authorship** — every docked note gets an immutable timestamp on Internet Computer
- **E2E encrypted** — notes are encrypted with AES-256-GCM *before* leaving Obsidian; MindDock servers never see your plaintext
- **Mind Trail** — an immutable audit trail showing every version of your note
- **Dock folders** — dock an entire folder structure including subfolders in one click
- **Verify integrity** — detect if a note was changed since it was last docked
- **Proof URL** — share a public URL to prove authorship to anyone

---

## How it works

1. Create a free account at [app.minddock.network](https://app.minddock.network)
2. Go to **Settings → API Tokens** → Create a new token
3. Copy the `mdock_...` token and paste it into the MindDock plugin settings in Obsidian
4. Right-click any note → **⚓ Dock to MindDock**

After docking, your note's frontmatter contains:

```yaml
---
minddock:
  synced: true
  noteId: abc123
  contentHash: a7b3c4d5e6f7...
  proofUrl: https://app.minddock.network/verify/a7b3c4d5e6f7
  lastDock: 2026-03-15T20:00:00.000Z
---
```

---

## Installation (manual — before official Obsidian directory listing)

> Once accepted into the Obsidian Community Plugin directory, you will be able to install directly from within Obsidian.

**Step 1:** Download the latest release

Go to [Releases](https://github.com/MindDockNetwork/obsidian-minddock/releases) and download:
- `main.js`
- `manifest.json`
- `styles.css`

**Step 2:** Copy files to your vault

Create a folder named `obsidian-minddock` inside `.obsidian/plugins/` in your vault, then copy the three files there:

```
YourVault/
└── .obsidian/
    └── plugins/
        └── obsidian-minddock/
            ├── main.js
            ├── manifest.json
            └── styles.css
```

**Step 3:** Enable the plugin

In Obsidian: **Settings → Community Plugins → Installed Plugins → Enable MindDock**

**Step 4:** Connect your account

In **Settings → MindDock**: paste your API token from [app.minddock.network](https://app.minddock.network) → Settings → API Tokens.

---

## Tutorial videos

> *(Coming soon — will be linked here before the public launch)*

- **Video 1:** What is MindDock and why does it matter?
- **Video 2:** Installation + creating your API token (5 min)
- **Video 3:** Docking your first note and reading the Mind Trail (3 min)

---

## Encryption

| Account tier | Encryption method |
|---|---|
| Trial (14 days free) | AES-256-GCM with PBKDF2-derived key (local-v1) |
| Personal / Pro / Business | AES-256-GCM with VetKeys threshold key (vetkeys-v1) |

**VetKeys** uses Internet Computer's threshold cryptography — your decryption key is reconstructed from distributed key shards, never stored in one place.

**In both cases:** your plaintext content never leaves Obsidian. The plugin encrypts locally, then sends ciphertext to Internet Computer.

---

## Privacy

| What is sent to Internet Computer | What is NOT sent |
|---|---|
| Encrypted note content (ciphertext) | Plaintext note content |
| Note title (plaintext) | Your email or IP address |
| Content hash (SHA-256) | Device identifiers |
| Folder name and structure | Analytics or tracking data |

Your Internet Computer **principal ID** is derived from your Internet Identity login — it is a pseudonymous identifier that is public on IC by design.

---

## 🧭 Proof of Mind — Early Adopter Advantage

MindDock is building a distributed witnessing system called **Proof of Mind**.

Beta testers build reputation from day one. Reputation is based on account age and activity history — **this advantage cannot be gained retroactively**. The earlier you start, the greater your head start.

**Beta testers receive:**
- 30-day trial (instead of 14)
- 20% off the first 3 months after launching paid plans
- Priority selection as a Witness in the Proof of Mind system

**Witness ranks:** 🚢 Passenger → ⚓ Sailor → 🧭 Navigator → ⛵ Captain → 🗼 Lighthouse Keeper

Witnesses earn up to €5/month in account credit. [Learn more at app.minddock.network](https://app.minddock.network)

> To claim your beta offer: open a GitHub issue with your MindDock username or email [beta@minddock.network](mailto:beta@minddock.network)

---

## Commands

| Command | Description |
|---|---|
| Dock current note | Dock the active note to MindDock |
| Verify MindDock proof | Check if the note matches the IC record |
| Copy content hash | Copy the SHA-256 hash to clipboard |
| Open proof URL | Open the verification URL in browser |
| Test connection | Verify your API token is working |

Right-click any note or folder in the file explorer for context menu options.

---

## Troubleshooting

**"Token invalid or expired"**
→ Create a new API token at app.minddock.network → Settings → API Tokens. Tokens expire after the period set at creation.

**"API token does not have 'create_note' permission"**
→ When creating a token, make sure the `create_note` scope is selected.

**Note docks but doesn't appear in the web app**
→ Wait 10–30 seconds and refresh. Internet Computer consensus takes a moment.

**"VetKeys temporarily offline"**
→ Your note will be encrypted with local-v1 as a fallback. This is safe. The status bar will show when VetKeys is back online.

**Build error / plugin won't load**
→ Open the developer console (Ctrl+Shift+I), copy the error, and [open a GitHub issue](https://github.com/MindDockNetwork/obsidian-minddock/issues).

---

## Feedback & support

- **Bugs and feature requests:** [GitHub Issues](https://github.com/MindDockNetwork/obsidian-minddock/issues)
- **Questions:** [Obsidian Forum thread](https://forum.obsidian.md) *(link to be added after launch)*
- **Email:** [support@minddock.network](mailto:support@minddock.network)

---

## License

MIT — see [LICENSE](LICENSE)
