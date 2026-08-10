# CullSpace Security Model

## Process split
- **Electron UI** is unelevated and never deletes files directly.
- **CullSpace.Helper** (.NET) performs scans, uninstall launches, and deletions.
- IPC uses a per-session named pipe + random secret. Pipe ACL is limited to the current user.

## Allowlisted helper commands
`ping`, `list_drives`, `scan_files`, `list_apps`, `related_files`, `related_app`, `delete_paths`, `uninstall_app`, `is_admin`

## Delete protections
- Path canonicalization rejects `..` and non-rooted paths.
- Protected Windows roots are refused.
- Deletes require administrator elevation in the helper.
- UI requires typed confirmation before delete/uninstall.
- Audit log: `%LOCALAPPDATA%\CullSpace\logs\`

## Uninstall flow
1. Official uninstaller is launched with UAC (`runas`).
2. Leftover related paths are previewed.
3. Second typed confirmation + elevated delete for leftovers only.

## Auto-update
- Update checks use the GitHub Releases API for `CarterWilliamson08/cullspace`.
- Optional read-only token may be embedded at package time via `CULLSPACE_GH_TOKEN` → `resources/update-config.json` (gitignored; never commit secrets).
- Downloads only assets matching `CullSpace-Setup-*.exe`.
- User must confirm **Update Now** before download/install; **Remind me later** is session-only.
