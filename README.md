# CullSpace

Scan drives, surface the largest files and installed apps, and remove them securely with Windows UAC.

## Stack
- **Electron** UI with loading / scanning / deleting animations
- **.NET helper** for drive scan, uninstall registry, related-path discovery, and elevated deletes
- Named-pipe IPC with per-session secret (current-user ACL)

## Requirements
- Windows 10/11
- Node.js 20+
- .NET 8 (user-local SDK is fine). Self-contained helper is published under `helper/publish`.

## Setup
```powershell
npm install
node node_modules/electron/install.js
$env:PATH = "$env:LOCALAPPDATA\Microsoft\dotnet;$env:PATH"
dotnet publish helper/CullSpace.Helper/CullSpace.Helper.csproj -c Release -r win-x64 --self-contained true -o helper/publish /p:PublishSingleFile=true
powershell -ExecutionPolicy Bypass -File scripts/make-icon.ps1
powershell -ExecutionPolicy Bypass -File scripts/create-shortcut.ps1
```

## Run
```powershell
npm start
```

Desktop shortcut: **CullSpace.lnk**

## Installer (branded Setup)
Builds a CullSpace-styled Setup UI (not a stock Windows wizard), packs the app + helper, and produces a portable Setup executable:

```powershell
# Optional but required for private-repo auto-update in the packaged app:
$env:CULLSPACE_GH_TOKEN = "ghp_your_readonly_token"

npm run installer
# output: dist/CullSpace-Setup-<version>-x64.exe
```

- Default install path: `%LOCALAPPDATA%\Programs\CullSpace`
- Creates Desktop + Start Menu shortcuts
- Includes an Uninstall shortcut in the Start Menu
- Unsigned builds may show SmartScreen; choose “More info” → “Run anyway” if needed

## Auto-update
On launch, CullSpace checks GitHub Releases for a newer `CullSpace-Setup-*.exe`, then shows an in-app prompt:

- **Update Now** — downloads the Setup exe and launches it, then quits CullSpace
- **Remind me later** — dismisses for this session only (prompt can return next launch)

Because the repo is private, packaged builds need a read-only GitHub token:

1. Create a classic/fine-grained PAT with release read access to `CarterWilliamson08/cullspace`
2. Set `CULLSPACE_GH_TOKEN` before `npm run installer` / `npm run pack`
3. The build writes gitignored `update-config.json` into app resources (see `update-config.example.json`)

### Release naming
Keep these in sync so version compares work:

- `package.json` → `"version": "X.Y.Z"`
- GitHub release title/tag → `vX.Y.Z` (or contains `X.Y.Z`)
- Setup asset → `CullSpace-Setup-X.Y.Z-x64.exe`

Manual check: **Help → Check for updates…**

## Smoke tests
```powershell
npm run smoke:ping
node scripts/smoke-scan.js
node scripts/smoke-apps.js
node scripts/smoke-related.js
node scripts/smoke-delete.js
node scripts/smoke-uninstall-preview.js
```

## Security
See [docs/SECURITY.md](docs/SECURITY.md).
