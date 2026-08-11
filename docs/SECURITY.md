# CullSpace Security Model

## Process split
- **Electron UI** is unelevated and never deletes files directly.
- **CullSpace.Helper** (.NET) performs scans, uninstall launches, and deletions.
- IPC uses a per-session named pipe + random secret. Pipe ACL is limited to the current user.

## Allowlisted helper commands
`ping`, `list_drives`, `scan_files`, `scan_folder_files`, `scan_largest_folders`, `cancel_scan`, `list_apps`, `related_files`, `related_app`, `delete_paths`, `uninstall_app`, `is_admin`

## Scan scope
- Drive walks may descend into the **user profile** (soft-protected for deletes).
- **Program Files** / **Program Files (x86)** are skipped unless the client sends `includeProgramFiles: true`.
- Hard-protected Windows/system trees are never scanned or deleted.
- Explicit folder scans may start under the profile or Program Files when the user picks that folder, but still refuse hard system roots (e.g. `C:\Windows`).

## Delete protections
- Path canonicalization rejects `..` and non-rooted paths.
- Protected Windows roots are refused; soft-protected roots (profile / Program Files) block deleting the root itself.
- Privileged commands spawn an elevated helper via UAC. Batch deletes can reuse one elevated session (one prompt per batch).
- UI requires typing **DELETE** (inline error if mismatched). Deletes are permanent (not Recycle Bin).
- Audit log: `%LOCALAPPDATA%\CullSpace\logs\`

## Uninstall flow
1. Official uninstaller is launched with UAC (`runas`); helper returns a PID when available.
2. UI waits for process exit **or** the user clicks **I’ve finished**.
3. Leftover related paths are previewed.
4. Second typed confirmation + elevated delete for leftovers only.
5. Multi-select app uninstall is **launch-only**; leftover cleanup remains on the single-app flow.

## Auto-update
- Update checks use the GitHub Releases API for `CarterWilliamson08/cullspace`.
- Optional read-only token may be embedded at package time via `CULLSPACE_GH_TOKEN` → `resources/update-config.json` (gitignored; never commit secrets).
- Downloads only assets matching `CullSpace-Setup-*.exe`.
- User must confirm **Update Now** before download/install.
- Silent Setup is launched with `--silent --launch --install-dir=<current> --wait-pid=<pid>`. Existing installs are staged beside the live folder and swapped after CullSpace exits (avoids EBUSY while files are locked). The app waits for Setup exit and keeps running if staging fails.
- **Skip this version** persists a dismissed version in localStorage.
