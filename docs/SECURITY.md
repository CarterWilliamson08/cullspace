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
