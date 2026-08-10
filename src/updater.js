const fs = require('fs');
const path = require('path');
const https = require('https');

const REPO = 'CarterWilliamson08/cullspace';
const SETUP_ASSET = /^CullSpace-Setup-.*\.exe$/i;

function getElectronApp() {
  try {
    return require('electron').app;
  } catch {
    return null;
  }
}

function getAppVersion() {
  const electronApp = getElectronApp();
  if (electronApp?.getVersion) return electronApp.getVersion();
  try {
    return require('../package.json').version;
  } catch {
    return '0.0.0';
  }
}

function getTempDir() {
  const electronApp = getElectronApp();
  if (electronApp?.getPath) return electronApp.getPath('temp');
  return require('os').tmpdir();
}

function loadGithubToken() {
  if (process.env.CULLSPACE_GH_TOKEN) return process.env.CULLSPACE_GH_TOKEN.trim();

  const candidates = [
    path.join(process.resourcesPath || '', 'update-config.json'),
    path.join(__dirname, '..', 'update-config.json'),
  ];
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (cfg && typeof cfg.githubToken === 'string' && cfg.githubToken.trim()) {
        return cfg.githubToken.trim();
      }
    } catch {
      // ignore invalid config
    }
  }
  return '';
}

function parseSemver(input) {
  if (!input) return null;
  const m = String(input).trim().match(/v?(\d+)\.(\d+)\.(\d+)/i);
  if (!m) return null;
  return {
    raw: `${m[1]}.${m[2]}.${m[3]}`,
    parts: [Number(m[1]), Number(m[2]), Number(m[3])],
  };
}

function compareSemver(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a.parts[i] > b.parts[i]) return 1;
    if (a.parts[i] < b.parts[i]) return -1;
  }
  return 0;
}

function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        path: `${u.pathname}${u.search}`,
        method: 'GET',
        headers,
      },
      (res) => resolve(res)
    );
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error('Request timed out')));
    req.end();
  });
}

async function readJsonResponse(res) {
  const chunks = [];
  for await (const chunk of res) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString('utf8');
  if (res.statusCode && res.statusCode >= 400) {
    throw new Error(`GitHub API ${res.statusCode}: ${body.slice(0, 200)}`);
  }
  return JSON.parse(body);
}

async function githubApi(urlPath, token) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'CullSpace-Updater',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await httpsGet(`https://api.github.com${urlPath}`, headers);
  return readJsonResponse(res);
}

function pickLatestSetupRelease(releases) {
  if (!Array.isArray(releases)) return null;

  const scored = [];
  for (const release of releases) {
    if (release.draft) continue;
    const asset = (release.assets || []).find((a) => SETUP_ASSET.test(a.name || ''));
    if (!asset) continue;

    const version =
      parseSemver(release.name) ||
      parseSemver(release.tag_name) ||
      parseSemver(asset.name);
    if (!version) continue;

    scored.push({
      release,
      asset,
      version,
      publishedAt: Date.parse(release.published_at || release.created_at || 0) || 0,
    });
  }

  scored.sort((a, b) => {
    const c = compareSemver(b.version, a.version);
    if (c !== 0) return c;
    return b.publishedAt - a.publishedAt;
  });

  return scored[0] || null;
}

async function checkForUpdates() {
  const currentVersion = parseSemver(getAppVersion()) || parseSemver('0.0.0');
  const token = loadGithubToken();

  try {
    const releases = await githubApi(`/repos/${REPO}/releases?per_page=20`, token);
    const latest = pickLatestSetupRelease(releases);
    if (!latest) {
      return {
        updateAvailable: false,
        currentVersion: currentVersion.raw,
        latestVersion: currentVersion.raw,
        reason: 'no-setup-release',
      };
    }

    const newer = compareSemver(latest.version, currentVersion) > 0;
    return {
      updateAvailable: newer,
      currentVersion: currentVersion.raw,
      latestVersion: latest.version.raw,
      releaseName: latest.release.name || latest.release.tag_name || latest.version.raw,
      notes: (latest.release.body || '').slice(0, 1200),
      assetName: latest.asset.name,
      assetUrl: latest.asset.url,
      browserDownloadUrl: latest.asset.browser_download_url,
      hasToken: Boolean(token),
    };
  } catch (err) {
    return {
      updateAvailable: false,
      currentVersion: currentVersion.raw,
      latestVersion: currentVersion.raw,
      error: err.message || String(err),
    };
  }
}

async function downloadToFile(startUrl, destPath, token, onProgress) {
  let url = startUrl;
  let headers = {
    'User-Agent': 'CullSpace-Updater',
    Accept: 'application/octet-stream',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  for (let hop = 0; hop < 6; hop += 1) {
    const res = await httpsGet(url, headers);
    if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
      res.resume();
      url = res.headers.location.startsWith('http')
        ? res.headers.location
        : new URL(res.headers.location, url).toString();
      // CDN redirect usually should not send GitHub auth header
      if (!url.includes('api.github.com')) {
        headers = { 'User-Agent': 'CullSpace-Updater' };
      }
      continue;
    }

    if (res.statusCode && res.statusCode >= 400) {
      const chunks = [];
      for await (const chunk of res) chunks.push(chunk);
      throw new Error(
        `Download failed (${res.statusCode}): ${Buffer.concat(chunks).toString('utf8').slice(0, 180)}`
      );
    }

    const total = Number(res.headers['content-length'] || 0);
    let received = 0;
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(destPath);
      res.on('data', (chunk) => {
        received += chunk.length;
        if (onProgress) {
          onProgress({
            received,
            total,
            percent: total ? Math.min(99, Math.round((received / total) * 100)) : null,
          });
        }
      });
      res.pipe(out);
      out.on('finish', () => {
        out.close(() => {
          if (onProgress) onProgress({ received, total, percent: 100 });
          resolve();
        });
      });
      out.on('error', reject);
      res.on('error', reject);
    });
    return destPath;
  }

  throw new Error('Too many redirects while downloading update');
}

async function downloadAndPrepareInstall(updateInfo, onProgress) {
  const token = loadGithubToken();
  const startUrl = updateInfo?.assetUrl || updateInfo?.browserDownloadUrl;
  if (!startUrl) throw new Error('Missing download URL for update asset');

  const dest = path.join(
    getTempDir(),
    updateInfo.assetName || `CullSpace-Setup-${updateInfo.latestVersion}.exe`
  );
  if (fs.existsSync(dest)) {
    try {
      fs.unlinkSync(dest);
    } catch {
      // ignore
    }
  }

  await downloadToFile(startUrl, dest, token, onProgress);
  return dest;
}

module.exports = {
  checkForUpdates,
  downloadAndPrepareInstall,
  loadGithubToken,
  parseSemver,
  compareSemver,
};
