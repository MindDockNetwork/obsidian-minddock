# Changelog

All notable changes to the MindDock Obsidian Plugin will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [0.1.0-beta] — 2026-03-15

### Added
- Dock individual notes to MindDock with blockchain-verified authorship proof
- Dock entire folder structures (including subfolders) with preserved hierarchy
- E2E encryption using AES-256-GCM — plaintext never leaves Obsidian
- VetKeys encryption (vetkeys-v1) for paid plans (personal / pro / business)
- Local PBKDF2 encryption (local-v1) for trial accounts
- Mind Trail: immutable audit trail per note on Internet Computer
- Proof URL in note frontmatter for instant verification
- Content hash verification — detect if a note has been modified since docking
- Multilingual UI: English and Dutch (auto-detected from Obsidian language setting)
- Status bar indicator showing connection state and principal ID
- Ribbon icon and right-click context menu for quick docking
- API token authentication (mdock_... format with DelegationChain)

### Notes
- This is a public beta release. APIs and data formats may change before v1.0.
- Beta testers: see README for the early adopter incentive (Proof of Mind head start).
