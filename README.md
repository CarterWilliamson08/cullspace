# CullSpace

Scan Windows drives, rank the largest files and folders, review installed apps, and remove them with typed confirmation plus UAC-gated deletes.

## Features
- **Largest files** — drive-wide ranking with size color tiers
- **Folders** — large folders on selected drives (optional deepest-path “unique savings”), or files inside a chosen folder
- **Installed apps** — load programs, uninstall via the vendor uninstaller, then optional leftover cleanup
- **Multi-select** — batch remove files/folders or launch several uninstallers (one UAC for a delete batch when possible)
- **Safety** — type `DELETE` to confirm; permanent delete (not Recycle Bin); protected system paths blocked; audit logs under `%LOCALAPPDATA%\CullSpace\logs`
- **Themes** — light / dark / system
- **Auto-update** — checks GitHub Releases for `CullSpace-Setup-*.exe`; silent install into the current install directory; remind later or skip a version

## Scan scope
- Drive scans **include your user profile** by default
- **Program Files** is opt-in (toolbar checkbox)
- Hard Windows/system trees stay blocked for scanning and deletes
- Soft-protected roots (profile / Program Files) can appear in results but cannot be deleted as roots
- Scans show progress, support **Cancel**, and return skip / access-denied stats

## Stack
- **Electron** UI
- **.NET 8 helper** (named-pipe IPC, per-session secret, current-user ACL)
- Branded **CullSpace Setup** installer (not a stock Windows wizard)

## Requirements
- Windows 10/11
- Node.js 20+
- .NET 8 SDK (user-local is fine). Publish the helper under `helper/publish`.

## Setup
```powershell
npm install
node node_modules/electron/install.js
$env:PATH = "$env:LOCALAPPDATA\Microsoft\dotnet;$env:PATH"
npm run helper:publish
powershell -ExecutionPolicy Bypass -File scripts/make-icon.ps1
powershell -ExecutionPolicy Bypass -File scripts/create-shortcut.ps1
```

## Run
```powershell
npm start
```

## Installer
```powershell
npm run installer
# output: dist/CullSpace-Setup-<version>-x64.exe
```

Faster Setup UI iteration (reuses an existing app payload):

```powershell
npm run installer:fast
```

- Default install: `%LOCALAPPDATA%\Programs\CullSpace`
- Desktop + Start Menu shortcuts, plus **Uninstall CullSpace**
- Silent flags: `--silent`, `--launch`, `--install-dir=<path>`, `--wait-pid=<pid>`
- Unsigned builds may hit SmartScreen (“More info” → “Run anyway”)

## Auto-update
On launch (and via **Help / Settings → Check for updates…**):

- **Update Now** — downloads Setup, runs it silently with `--install-dir=<current> --wait-pid=<pid>`; Setup stages files beside the live install, exits 0, then swaps after CullSpace quits and relaunches
- **Remind me later** — session dismiss
- **Skip this version** — persists so that version won’t prompt again

Packaged private-repo builds may embed a read-only GitHub token via `CULLSPACE_GH_TOKEN` → gitignored `update-config.json` (see `update-config.example.json`).

Keep versions aligned:

- `package.json` → `"version": "X.Y.Z"`
- GitHub tag/title → `vX.Y.Z`
- Setup asset → `CullSpace-Setup-X.Y.Z-x64.exe`

## Smoke tests
```powershell
npm run smoke:ping
npm run smoke:scan
npm run smoke:folder-scan
npm run smoke:folders-ui
npm run smoke:delete-confirm
npm run smoke:ux-polish
npm run smoke:ops
npm run smoke:silent-setup
npm run smoke:multiselect-ui
npm run smoke:electron
npm run smoke:updater
```

## Security
See [docs/SECURITY.md](docs/SECURITY.md).
