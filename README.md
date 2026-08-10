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
