const THEME_KEY = 'cullspace.theme';
const SAFETY_KEY = 'cullspace.safetySeen';
const SKIP_UPDATE_KEY = 'cullspace.skipUpdateVersions';
const APPS_PAGE = 200;

const state = {
  drives: [],
  selectedDrives: new Set(),
  files: [],
  apps: [],
  folderResults: [],
  foldersMode: 'folders',
  folderRoot: '',
  tab: 'files',
  selectedFilePaths: new Set(),
  selectedFolderPaths: new Set(),
  selectedAppKeys: new Set(),
  appsVisibleLimit: APPS_PAGE,
  lastScanStats: null,
  includeProgramFiles: false,
  dedupeDeepest: true,
  scanCancelled: false,
  themePreference: localStorage.getItem(THEME_KEY) || 'system',
  pendingUpdate: null,
  updateDownloading: false,
};

function normalizeScanResult(result) {
  if (Array.isArray(result)) return { items: result, stats: null };
  if (result && Array.isArray(result.items)) {
    return { items: result.items, stats: result.stats || null };
  }
  return { items: [], stats: null };
}

function setConfirmError(message) {
  const el = document.getElementById('confirmError');
  if (el) el.textContent = message || '';
}

function confirmInputHtml() {
  return `
    <label class="settings-row">Type DELETE to confirm
      <input id="confirmName" class="field" type="text" style="width:100%;margin-top:0.35rem;" autocomplete="off" />
    </label>
    <p id="confirmError" class="confirm-error" aria-live="polite"></p>
  `;
}

function emptyStateHtml({ title, body, buttonId, buttonLabel }) {
  return `
    <div class="empty-state">
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(body)}</p>
      ${
        buttonId
          ? `<button type="button" class="primary" id="${buttonId}">${escapeHtml(buttonLabel)}</button>`
          : ''
      }
    </div>
  `;
}

async function refreshAfterDelete() {
  if (state.tab === 'folders') {
    if (state.foldersMode === 'folders') await scanLargeFolders();
    else await scanFolderFiles();
  } else if (state.tab === 'apps') {
    await loadApps();
  } else {
    await scanFiles();
  }
}

function appKey(app) {
  return `${app.name}||${app.uninstallString || ''}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function updateSelectionBar(kind) {
  if (kind === 'files') {
    const n = state.selectedFilePaths.size;
    $('fileSelectionBar').classList.toggle('hidden', n === 0);
    $('fileSelectionCount').textContent = `${n} selected`;
  } else if (kind === 'folders') {
    const n = state.selectedFolderPaths.size;
    $('folderSelectionBar').classList.toggle('hidden', n === 0);
    $('folderSelectionCount').textContent = `${n} selected`;
  } else if (kind === 'apps') {
    const n = state.selectedAppKeys.size;
    $('appSelectionBar').classList.toggle('hidden', n === 0);
    $('appSelectionCount').textContent = `${n} selected`;
  }
}

function selectionPreviewList(names, limit = 8) {
  const shown = names.slice(0, limit);
  const more = names.length - shown.length;
  return `${shown.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}${
    more > 0 ? `<li class="muted">and ${more} more…</li>` : ''
  }`;
}

const $ = (id) => document.getElementById(id);

function resolveTheme(pref) {
  if (pref === 'light' || pref === 'dark') return pref;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyTheme(pref, { animate = false } = {}) {
  state.themePreference = pref;
  localStorage.setItem(THEME_KEY, pref);
  const resolved = resolveTheme(pref);
  const root = document.documentElement;
  if (animate) {
    document.body.classList.add('theme-animating');
    const veil = $('themeVeil');
    veil.classList.add('show');
    requestAnimationFrame(() => {
      root.setAttribute('data-theme', resolved);
    });
    setTimeout(() => {
      veil.classList.remove('show');
      document.body.classList.remove('theme-animating');
    }, 450);
  } else {
    root.setAttribute('data-theme', resolved);
  }
}

function showUpdatePrompt(info) {
  if (!info?.updateAvailable || state.updateDownloading) return;
  if (isUpdateSkipped(info.latestVersion)) return;
  state.pendingUpdate = info;
  showOverlay({
    html: `
      <h3>Update available</h3>
      <p>A newer CullSpace release is ready to install.</p>
      <div class="update-versions">
        <span class="ver">${escapeHtml(info.currentVersion)}</span>
        <span class="arrow">→</span>
        <span class="ver">${escapeHtml(info.latestVersion)}</span>
      </div>
      <p class="muted">${escapeHtml(info.releaseName || `v${info.latestVersion}`)}</p>
      ${
        info.notes
          ? `<div class="update-notes">${escapeHtml(info.notes)}</div>`
          : ''
      }
      <div id="updateDownload" class="update-download hidden">
        <div class="track"><div id="updateBar" class="bar"></div></div>
        <div class="meta" id="updateMeta">Starting download…</div>
      </div>
      <div class="modal-actions">
        <button type="button" id="remindLater">Remind me later</button>
        <button type="button" id="skipVersion">Skip this version</button>
        <button type="button" class="primary" id="updateNow">Update Now</button>
      </div>
    `,
  });

  $('remindLater').onclick = () => {
    state.pendingUpdate = null;
    hideOverlay();
    setStatus('Update reminder set', `v${info.latestVersion} available next launch`);
  };

  $('skipVersion').onclick = () => {
    skipUpdateVersion(info.latestVersion);
    state.pendingUpdate = null;
    hideOverlay();
    setStatus('Update skipped', `v${info.latestVersion} won’t prompt again`);
  };

  $('updateNow').onclick = async () => {
    if (!state.pendingUpdate || state.updateDownloading) return;
    state.updateDownloading = true;
    const download = document.getElementById('updateDownload');
    const bar = document.getElementById('updateBar');
    const meta = document.getElementById('updateMeta');
    const updateBtn = document.getElementById('updateNow');
    const remindBtn = document.getElementById('remindLater');
    const skipBtn = document.getElementById('skipVersion');
    download.classList.remove('hidden');
    updateBtn.disabled = true;
    remindBtn.disabled = true;
    if (skipBtn) skipBtn.disabled = true;
    updateBtn.textContent = 'Downloading…';
    setStatus('Downloading update…', `v${info.latestVersion}`);

    try {
      await window.cullspace.updates.install(state.pendingUpdate);
      meta.textContent = 'Installing update…';
      bar.style.width = '100%';
      setStatus('Installing update', 'CullSpace will restart');
    } catch (err) {
      state.updateDownloading = false;
      updateBtn.disabled = false;
      remindBtn.disabled = false;
      if (skipBtn) skipBtn.disabled = false;
      updateBtn.textContent = 'Update Now';
      meta.textContent = err.message || 'Update failed';
      setStatus('Update failed', err.message || 'Download error');
    }
  };
}

function wireUpdateCheckButton(checkBtn, statusEl) {
  if (!checkBtn || !window.cullspace.updates) return;
  checkBtn.onclick = async () => {
    checkBtn.disabled = true;
    statusEl.textContent = 'Checking…';
    try {
      const info = await window.cullspace.updates.check();
      if (info?.updateAvailable) {
        hideOverlay();
        showUpdatePrompt(info);
      } else {
        statusEl.textContent = info?.error
          ? `Update check failed: ${info.error}`
          : `You're on the latest version (${info?.currentVersion || '?'}).`;
      }
    } catch (err) {
      statusEl.textContent = err.message || 'Update check failed';
    } finally {
      checkBtn.disabled = false;
    }
  };
}

function openSettings() {
  const pref = state.themePreference;
  showOverlay({
    html: `
      <h3>Settings</h3>
      <p>Appearance follows your choice instantly, with a short transition.</p>
      <div class="settings-block">
        <div class="settings-row">
          <span>Theme</span>
          <div class="segmented" role="group" aria-label="Theme">
            <button type="button" data-theme-choice="light" class="${pref === 'light' ? 'active' : ''}">Light</button>
            <button type="button" data-theme-choice="dark" class="${pref === 'dark' ? 'active' : ''}">Dark</button>
            <button type="button" data-theme-choice="system" class="${pref === 'system' ? 'active' : ''}">System</button>
          </div>
        </div>
        <div class="settings-row">
          <span>Updates</span>
          <button type="button" id="btnCheckUpdates">Check for updates…</button>
        </div>
        <p id="updateCheckStatus" class="settings-hint" aria-live="polite"></p>
      </div>
      <div class="modal-actions">
        <button type="button" id="cancelModal" class="primary">Done</button>
      </div>
    `,
  });
  $('cancelModal').onclick = hideOverlay;
  document.querySelectorAll('[data-theme-choice]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const choice = btn.getAttribute('data-theme-choice');
      applyTheme(choice, { animate: true });
      document.querySelectorAll('[data-theme-choice]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
  wireUpdateCheckButton($('btnCheckUpdates'), $('updateCheckStatus'));
}

function skippedUpdateVersions() {
  try {
    return JSON.parse(localStorage.getItem(SKIP_UPDATE_KEY) || '[]');
  } catch {
    return [];
  }
}

function isUpdateSkipped(version) {
  if (!version) return false;
  return skippedUpdateVersions().includes(String(version));
}

function skipUpdateVersion(version) {
  const list = skippedUpdateVersions().filter((v) => v !== String(version));
  list.push(String(version));
  localStorage.setItem(SKIP_UPDATE_KEY, JSON.stringify(list));
}

async function openHelp() {
  let version = '…';
  try {
    if (window.cullspace.getVersion) version = await window.cullspace.getVersion();
  } catch {
    version = '?';
  }

  showOverlay({
    html: `
      <h3>Help</h3>
      <p>CullSpace version <strong>${escapeHtml(version)}</strong></p>
      <div class="settings-block">
        <div class="settings-row">
          <span>Updates</span>
          <button type="button" id="btnCheckUpdates">Check for updates…</button>
        </div>
        <p id="updateCheckStatus" class="settings-hint" aria-live="polite"></p>
        <div class="settings-row">
          <span>Logs</span>
          <button type="button" id="btnHelpLogs">Open logs folder</button>
        </div>
      </div>
      <h4>Safety</h4>
      <ul class="safety-list">
        <li>Removals require typing <strong>DELETE</strong>, then a Windows UAC prompt.</li>
        <li>Deletes are permanent (not Recycle Bin).</li>
        <li>Drive scans include your user profile; Program Files is opt-in.</li>
        <li>Protected system paths are blocked. Audit logs: open Logs above.</li>
      </ul>
      <div class="modal-actions">
        <button type="button" id="btnShowSafety">Show first-run tips</button>
        <button type="button" id="cancelModal" class="primary">Done</button>
      </div>
    `,
  });
  $('cancelModal').onclick = hideOverlay;
  $('btnShowSafety').onclick = () => showSafetyCard({ force: true });
  wireUpdateCheckButton($('btnCheckUpdates'), $('updateCheckStatus'));
  const logsBtn = $('btnHelpLogs');
  if (logsBtn) {
    logsBtn.onclick = () => window.cullspace.openLogs();
  }
}

function formatBytes(n) {
  if (!n || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

function sizeImpactClass(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 5 * GB) return 'size-xl';
  if (n >= 1 * GB) return 'size-lg';
  if (n >= 100 * MB) return 'size-md';
  return 'size-sm';
}

function showOverlay({ scan = false, del = false, html = '' }) {
  const overlay = $('overlay');
  overlay.classList.remove('hidden', 'closing');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  $('animScan').classList.toggle('hidden', !scan);
  $('animDelete').classList.toggle('hidden', !del);
  $('modalBody').innerHTML = html;
  if (!scan && !del) {
    $('modalBody')
      .querySelectorAll('.preview-list li')
      .forEach((li, i) => {
        li.style.animationDelay = `${Math.min(i, 12) * 35}ms`;
      });
  }
  requestAnimationFrame(() => {
    const focusEl =
      $('modalBody').querySelector('#confirmName, button.primary, button.danger, button') ||
      null;
    focusEl?.focus?.();
  });
}

function hideOverlay() {
  const overlay = $('overlay');
  if (overlay.classList.contains('hidden')) return;
  overlay.classList.add('closing');
  setTimeout(() => {
    overlay.classList.add('hidden');
    overlay.classList.remove('closing');
    overlay.removeAttribute('role');
    overlay.removeAttribute('aria-modal');
    $('animScan').classList.add('hidden');
    $('animDelete').classList.add('hidden');
    $('modalBody').innerHTML = '';
  }, 170);
}

function showSafetyCard({ force = false } = {}) {
  if (!force && localStorage.getItem(SAFETY_KEY) === '1') return;
  showOverlay({
    html: `
      <h3>Before you cull</h3>
      <ul class="safety-list">
        <li>Removals ask you to type <strong>DELETE</strong>, then Windows may show a UAC prompt.</li>
        <li>Deletes are permanent (not Recycle Bin).</li>
        <li>Protected system paths are blocked; audit logs live under CullSpace logs.</li>
        <li>Drive scans include your user profile; Program Files stays opt-in.</li>
      </ul>
      <div class="modal-actions">
        <button type="button" id="cancelModal" class="primary">Got it</button>
      </div>
    `,
  });
  $('cancelModal').onclick = () => {
    localStorage.setItem(SAFETY_KEY, '1');
    hideOverlay();
  };
}

function setStatus(left, right) {
  if ($('statusLeft') && left != null) {
    $('statusLeft').textContent = left;
    $('statusLeft').classList.remove('pulse');
    void $('statusLeft').offsetWidth;
    $('statusLeft').classList.add('pulse');
  }
  if ($('statusRight') && right != null) {
    $('statusRight').textContent = right;
    $('statusRight').classList.remove('pulse');
    void $('statusRight').offsetWidth;
    $('statusRight').classList.add('pulse');
  }
}

function moveTabInk() {
  const ink = $('tabInk');
  const active = document.querySelector('.tab.active');
  if (!ink || !active) return;
  const strip = active.parentElement.getBoundingClientRect();
  const box = active.getBoundingClientRect();
  ink.style.left = `${box.left - strip.left + 10}px`;
  ink.style.width = `${Math.max(24, box.width - 20)}px`;
}

async function revealApp() {
  const splash = $('splash');
  splash.classList.add('leaving');
  await new Promise((r) => setTimeout(r, 380));
  splash.classList.add('hidden');
  const app = $('app');
  app.classList.remove('hidden');
  app.classList.add('enter');
  requestAnimationFrame(moveTabInk);
}

async function boot() {
  try {
    await window.cullspace.call('ping');
    await revealApp();
    setStatus('Ready', 'Secure helper connected');
    await refreshDrives();
    renderFiles();
    renderFolderResults();
    renderApps();
    showSafetyCard({ force: false });
  } catch (err) {
    const sub = $('splash').querySelector('.splash-sub');
    sub.innerHTML = `Helper failed: ${escapeHtml(err.message)}<br/><button type="button" id="btnRetryHelper" class="primary" style="margin-top:10px">Retry</button>`;
    $('btnRetryHelper')?.addEventListener('click', () => {
      sub.textContent = 'Starting…';
      boot();
    });
    setStatus('Helper unavailable', err.message);
  }
}

async function refreshDrives() {
  const includeNetworkOptical = $('includeNetwork').checked;
  state.drives = await window.cullspace.call('list_drives', { includeNetworkOptical });
  const list = $('driveList');
  list.innerHTML = '';
  state.selectedDrives.clear();

  state.drives.forEach((d, index) => {
    const id = `drive-${d.name}`;
    const label = document.createElement('label');
    label.className = 'drive';
    label.style.animationDelay = `${index * 45}ms`;
    label.innerHTML = `
      <input type="checkbox" id="${id}" ${d.isFixed ? 'checked' : ''} />
      <div>
        <strong>${d.label} (${d.name})</strong>
        <span>${d.driveType} · Free ${formatBytes(d.freeBytes)} / ${formatBytes(d.totalBytes)}</span>
      </div>
    `;
    list.appendChild(label);
    const box = label.querySelector('input');
    if (d.isFixed) state.selectedDrives.add(d.name);
    box.addEventListener('change', () => {
      if (box.checked) state.selectedDrives.add(d.name);
      else state.selectedDrives.delete(d.name);
    });
  });
}

function selectedDriveList() {
  return [...state.selectedDrives];
}

function setFoldersMode(mode, { keepResults = false } = {}) {
  const next = mode === 'folders' ? 'folders' : 'files';
  const changed = state.foldersMode !== next;
  state.foldersMode = next;
  document.querySelectorAll('[data-folders-mode]').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-folders-mode') === state.foldersMode);
  });
  document.querySelectorAll('.folders-files-only').forEach((el) => {
    el.classList.toggle('hidden', state.foldersMode !== 'files');
  });
  document.querySelectorAll('.folders-dirs-only').forEach((el) => {
    el.classList.toggle('hidden', state.foldersMode !== 'folders');
  });
  if (changed && !keepResults) {
    state.folderResults = [];
    state.selectedFolderPaths.clear();
    if ($('folderStatus')) $('folderStatus').textContent = '';
  }
  renderFolderResults();
  if (state.tab === 'folders') syncTabStatus();
}

function syncTabStatus() {
  if (state.tab === 'files') {
    const n = state.files.length;
    setStatus(n ? `Scan complete · ${n} items` : 'Ready', selectedDriveList().join(' ') || 'Select drives');
  } else if (state.tab === 'folders') {
    const n = state.folderResults.length;
    if (state.foldersMode === 'folders') {
      setStatus(
        n ? `Large folders · ${n}` : 'Ready',
        selectedDriveList().join(' ') || 'Select drives'
      );
    } else {
      setStatus(n ? `Folder files · ${n}` : 'Ready', state.folderRoot || 'Choose a folder');
    }
  } else if (state.tab === 'apps') {
    const n = state.apps.length;
    setStatus(n ? `Loaded ${n} apps` : 'Ready', 'Installed programs');
  }
}

async function openFolderAsFileScan(folderPath) {
  if (!folderPath) return;
  state.folderRoot = folderPath;
  if ($('folderRoot')) $('folderRoot').value = folderPath;
  setFoldersMode('files', { keepResults: true });
  await scanFolderFiles();
}

function renderFolderResults() {
  const root = $('folderResults');
  if (!root) return;
  root.innerHTML = '';
  const rows = state.folderResults || [];
  if (!rows.length) {
    root.innerHTML = emptyStateHtml(
      state.foldersMode === 'folders'
        ? {
            title: 'No large folders yet',
            body: 'Scan selected drives to rank the biggest folders. Tip: turn on Unique folder savings to prefer deepest paths.',
            buttonId: 'emptyScanFolders',
            buttonLabel: 'Scan',
          }
        : {
            title: 'No folder files yet',
            body: 'Browse to a folder, then scan to rank its largest files.',
            buttonId: 'emptyScanFolderFiles',
            buttonLabel: state.folderRoot ? 'Scan' : 'Browse…',
          }
    );
    if (state.foldersMode === 'folders') {
      $('emptyScanFolders')?.addEventListener('click', scanLargeFolders);
    } else if (state.folderRoot) {
      $('emptyScanFolderFiles')?.addEventListener('click', scanFolderFiles);
    } else {
      $('emptyScanFolderFiles')?.addEventListener('click', browseFolderRoot);
    }
    updateSelectionBar('folders');
    return;
  }
  const visible = new Set(rows.map((f) => f.path));
  for (const p of [...state.selectedFolderPaths]) {
    if (!visible.has(p)) state.selectedFolderPaths.delete(p);
  }
  const drillIn = state.foldersMode === 'folders';
  const selectAll = $('folderSelectAll');
  if (selectAll) {
    selectAll.checked = rows.length > 0 && rows.every((f) => state.selectedFolderPaths.has(f.path));
    selectAll.indeterminate =
      state.selectedFolderPaths.size > 0 && !selectAll.checked && rows.some((f) => state.selectedFolderPaths.has(f.path));
  }
  rows.forEach((f, index) => {
    const row = document.createElement('div');
    row.className = drillIn ? 'item item-clickable' : 'item';
    row.style.animationDelay = `${Math.min(index, 24) * 28}ms`;
    const kind = f.isDirectory ? 'Folder' : 'File';
    const checked = state.selectedFolderPaths.has(f.path) ? 'checked' : '';
    row.innerHTML = `
      <label class="col-check"><input type="checkbox" class="row-check" ${checked} /></label>
      <div class="item-main">
        <div>${escapeHtml(f.name || f.path)} <span class="muted">· ${kind}</span></div>
        <div class="path">${escapeHtml(f.path)}</div>
      </div>
      <div class="size ${sizeImpactClass(f.sizeBytes)}">${formatBytes(f.sizeBytes)}</div>
      <button type="button" class="row-action">Remove…</button>
    `;
    const check = row.querySelector('.row-check');
    check.addEventListener('click', (e) => e.stopPropagation());
    check.addEventListener('change', () => {
      if (check.checked) state.selectedFolderPaths.add(f.path);
      else state.selectedFolderPaths.delete(f.path);
      updateSelectionBar('folders');
      renderFolderResults();
    });
    row.querySelector('.row-action').addEventListener('click', (e) => {
      e.stopPropagation();
      previewFileRemove(f);
    });
    if (drillIn) {
      row.title = 'Open files in this folder';
      row.addEventListener('click', (e) => {
        if (e.target.closest('button, input, label.col-check')) return;
        openFolderAsFileScan(f.path);
      });
    }
    root.appendChild(row);
  });
  updateSelectionBar('folders');
}

async function browseFolderRoot() {
  if (!window.cullspace.pickFolder) return;
  const chosen = await window.cullspace.pickFolder();
  if (!chosen) return;
  state.folderRoot = chosen;
  $('folderRoot').value = chosen;
  if ($('folderStatus')) $('folderStatus').textContent = 'Folder selected';
  setStatus('Folder selected', chosen);
}

function scanOverlayHtml(message) {
  return `
    <p id="scanProgressText">${escapeHtml(message)}</p>
    <div class="modal-actions">
      <button type="button" id="btnCancelScan">Cancel</button>
    </div>
  `;
}

function wireScanCancel() {
  const btn = $('btnCancelScan');
  if (!btn) return;
  btn.onclick = async () => {
    state.scanCancelled = true;
    try {
      await window.cullspace.call('cancel_scan', {});
    } catch {
      // ignore
    }
    btn.textContent = 'Cancelling…';
    btn.disabled = true;
  };
}

function formatStats(stats) {
  if (!stats) return '';
  const parts = [];
  if (stats.scannedFiles != null) parts.push(`${stats.scannedFiles.toLocaleString?.() || stats.scannedFiles} files seen`);
  if (stats.skippedProtected) parts.push(`${stats.skippedProtected} protected skipped`);
  if (stats.accessDenied) parts.push(`${stats.accessDenied} access denied`);
  return parts.join(' · ');
}

async function scanFolderFiles() {
  const root = ($('folderRoot').value || state.folderRoot || '').trim();
  if (!root) {
    if ($('folderStatus')) $('folderStatus').textContent = 'Choose a folder first.';
    return;
  }
  const limit = Number($('folderLimit')?.value) || 100;
  state.scanCancelled = false;
  showOverlay({ scan: true, html: scanOverlayHtml('Ranking the largest files in the selected folder…') });
  wireScanCancel();
  if ($('folderStatus')) $('folderStatus').textContent = 'Scanning…';
  try {
    const raw = await window.cullspace.call('scan_folder_files', { root, limit });
    const { items, stats } = normalizeScanResult(raw);
    state.folderResults = items;
    state.lastScanStats = stats;
    renderFolderResults();
    const statsLine = formatStats(stats);
    if ($('folderStatus')) {
      $('folderStatus').textContent = `${items.length} items${statsLine ? ` · ${statsLine}` : ''}`;
    }
    setStatus('Folder scan complete', root);
  } catch (err) {
    if ($('folderStatus')) {
      $('folderStatus').textContent = state.scanCancelled ? 'Cancelled' : 'Scan failed';
    }
    setStatus(state.scanCancelled ? 'Scan cancelled' : 'Folder scan failed', err.message);
    if (!state.scanCancelled) {
      showOverlay({
        html: `<h3>Folder scan failed</h3><p>${escapeHtml(err.message)}</p><div class="modal-actions"><button id="cancelModal">Close</button></div>`,
      });
      $('cancelModal').onclick = hideOverlay;
      return;
    }
  }
  hideOverlay();
}

async function scanLargeFolders() {
  const drives = selectedDriveList();
  if (!drives.length) {
    if ($('folderStatus')) $('folderStatus').textContent = 'Select at least one drive.';
    return;
  }
  const limit = Number($('folderLimit')?.value) || 100;
  state.includeProgramFiles = !!$('includeProgramFiles')?.checked;
  state.dedupeDeepest = !!$('dedupeDeepest')?.checked;
  state.scanCancelled = false;
  showOverlay({ scan: true, html: scanOverlayHtml('Ranking the largest folders on selected drives…') });
  wireScanCancel();
  if ($('folderStatus')) $('folderStatus').textContent = 'Scanning…';
  try {
    const raw = await window.cullspace.call('scan_largest_folders', {
      drives,
      limit,
      includeProgramFiles: state.includeProgramFiles,
      dedupeDeepest: state.dedupeDeepest,
    });
    const { items, stats } = normalizeScanResult(raw);
    state.folderResults = items;
    state.lastScanStats = stats;
    renderFolderResults();
    const statsLine = formatStats(stats);
    if ($('folderStatus')) {
      $('folderStatus').textContent = `${items.length} folders${statsLine ? ` · ${statsLine}` : ''}`;
    }
    setStatus('Large folders scan complete', `${items.length} folders`);
  } catch (err) {
    if ($('folderStatus')) {
      $('folderStatus').textContent = state.scanCancelled ? 'Cancelled' : 'Scan failed';
    }
    setStatus(state.scanCancelled ? 'Scan cancelled' : 'Large folders scan failed', err.message);
    if (!state.scanCancelled) {
      showOverlay({
        html: `<h3>Folder scan failed</h3><p>${escapeHtml(err.message)}</p><div class="modal-actions"><button id="cancelModal">Close</button></div>`,
      });
      $('cancelModal').onclick = hideOverlay;
      return;
    }
  }
  hideOverlay();
}

async function scanFiles() {
  const drives = selectedDriveList();
  if (!drives.length) {
    $('scanStatus').textContent = 'Select at least one drive.';
    return;
  }
  const limit = Number($('fileLimit').value) || 100;
  state.includeProgramFiles = !!$('includeProgramFiles')?.checked;
  state.scanCancelled = false;
  showOverlay({ scan: true, html: scanOverlayHtml('Ranking the largest files on selected drives…') });
  wireScanCancel();
  $('scanStatus').textContent = 'Scanning…';
  try {
    const raw = await window.cullspace.call('scan_files', {
      drives,
      limit,
      includeProgramFiles: state.includeProgramFiles,
    });
    const { items, stats } = normalizeScanResult(raw);
    state.files = items;
    state.lastScanStats = stats;
    renderFiles();
    const statsLine = formatStats(stats);
    $('scanStatus').textContent = `${items.length} items${statsLine ? ` · ${statsLine}` : ''}`;
    setStatus(`Scan complete · ${items.length} items`, selectedDriveList().join(' '));
  } catch (err) {
    $('scanStatus').textContent = state.scanCancelled ? 'Cancelled' : err.message;
    setStatus(state.scanCancelled ? 'Scan cancelled' : 'Scan failed', err.message);
  } finally {
    hideOverlay();
  }
}

function renderFiles() {
  const root = $('fileResults');
  root.innerHTML = '';
  const q = ($('fileFilter').value || '').trim().toLowerCase();
  const files = state.files.filter((f) => {
    if (!q) return true;
    return (
      (f.name || '').toLowerCase().includes(q) ||
      (f.path || '').toLowerCase().includes(q)
    );
  });
  if (!state.files.length) {
    root.innerHTML = emptyStateHtml({
      title: 'No files scanned yet',
      body: 'Select drives above, then scan to rank the largest files. Your user profile is included; Program Files is opt-in.',
      buttonId: 'emptyScanFiles',
      buttonLabel: 'Scan',
    });
    $('emptyScanFiles')?.addEventListener('click', scanFiles);
    updateSelectionBar('files');
    return;
  }
  if (!files.length) {
    root.innerHTML = emptyStateHtml({
      title: 'No matches',
      body: 'Try a different search, or clear the filter to see all scanned files.',
    });
    updateSelectionBar('files');
    return;
  }
  const visible = new Set(files.map((f) => f.path));
  for (const p of [...state.selectedFilePaths]) {
    if (!visible.has(p)) state.selectedFilePaths.delete(p);
  }
  const selectAll = $('fileSelectAll');
  if (selectAll) {
    selectAll.checked = files.length > 0 && files.every((f) => state.selectedFilePaths.has(f.path));
    selectAll.indeterminate =
      state.selectedFilePaths.size > 0 && !selectAll.checked && files.some((f) => state.selectedFilePaths.has(f.path));
  }

  files.forEach((f, index) => {
    const row = document.createElement('div');
    row.className = 'item';
    row.style.animationDelay = `${Math.min(index, 24) * 28}ms`;
    const checked = state.selectedFilePaths.has(f.path) ? 'checked' : '';
    row.innerHTML = `
      <label class="col-check"><input type="checkbox" class="row-check" ${checked} /></label>
      <div class="item-main">
        <div>${escapeHtml(f.name || f.path)}</div>
        <div class="path">${escapeHtml(f.path)}</div>
      </div>
      <div class="size ${sizeImpactClass(f.sizeBytes)}">${formatBytes(f.sizeBytes)}</div>
      <button type="button" class="row-action">Remove…</button>
    `;
    row.querySelector('.row-check').addEventListener('change', (e) => {
      if (e.target.checked) state.selectedFilePaths.add(f.path);
      else state.selectedFilePaths.delete(f.path);
      updateSelectionBar('files');
      renderFiles();
    });
    row.querySelector('.row-action').addEventListener('click', () => previewFileRemove(f));
    root.appendChild(row);
  });

  if (state.files.length) {
    $('scanStatus').textContent = q
      ? `${files.length} of ${state.files.length} items`
      : `${state.files.length} items`;
  }
  updateSelectionBar('files');
}

async function previewFileRemove(file) {
  showOverlay({ scan: true, html: '<p>Resolving related files…</p>' });
  try {
    const related = await window.cullspace.call('related_files', {
      path: file.path,
      allowedDrives: selectedDriveList(),
    });
    const removable = related.filter((r) => r.exists && !r.protected);
    const blocked = related.filter((r) => r.protected);
    showOverlay({
      html: `
        <h3>Remove file and related paths</h3>
        <p>Type <strong>DELETE</strong> to confirm, then continue to the Windows admin prompt. Deletes are permanent.</p>
        <ul class="preview-list">
          ${related
            .map(
              (r) => `<li>
                <div>${escapeHtml(r.path)}</div>
                <div class="reason">${escapeHtml(r.reason)} · ${formatBytes(r.sizeBytes)}${r.protected ? ' · <span class="bad">protected</span>' : ''}</div>
              </li>`
            )
            .join('')}
        </ul>
        ${confirmInputHtml()}
        <div class="modal-actions">
          <button type="button" id="cancelModal">Cancel</button>
          <button type="button" class="danger" id="confirmDelete" ${removable.length ? '' : 'disabled'}>Delete with admin</button>
        </div>
      `,
    });
    $('cancelModal').onclick = hideOverlay;
    $('confirmDelete').onclick = async () => {
      const typed = document.getElementById('confirmName').value.trim();
      if (typed !== 'DELETE') {
        setConfirmError('Type DELETE exactly to continue.');
        return;
      }
      setConfirmError('');
      await deletePaths(
        removable.map((r) => r.path),
        `Removed related files for ${file.name}`
      );
    };
  } catch (err) {
    showOverlay({
      html: `<h3>Preview failed</h3><p>${escapeHtml(err.message)}</p><div class="modal-actions"><button id="cancelModal">Close</button></div>`,
    });
    $('cancelModal').onclick = hideOverlay;
  }
}

function formatElevationError(err) {
  const msg = err?.message || String(err || '');
  if (/UAC elevation was cancelled/i.test(msg)) {
    return 'Windows UAC was cancelled. Approve the prompt to delete with admin rights.';
  }
  if (/Timed out waiting for elevated helper/i.test(msg) || /UAC may have been denied/i.test(msg)) {
    return 'Timed out waiting for the elevated helper. If you denied UAC, try again and approve the prompt.';
  }
  return msg;
}

async function deletePaths(paths, successMessage) {
  showOverlay({ del: true, html: '<p>Waiting for administrator approval and deleting…</p>' });
  try {
    const result = await window.cullspace.call('delete_paths', {
      paths,
      allowedDrives: selectedDriveList(),
    });
    if (result.error && !result.elevated) {
      showOverlay({
        html: `
          <h3>Administrator approval needed</h3>
          <p>${escapeHtml(formatElevationError({ message: result.error }))}</p>
          <p class="muted">Approve the Windows UAC prompt when CullSpace asks to elevate. Deletes are permanent.</p>
          <div class="modal-actions"><button id="cancelModal">Close</button></div>
        `,
      });
      $('cancelModal').onclick = hideOverlay;
      return;
    }
    showOverlay({
      html: `
        <h3>Removal complete</h3>
        <p>${escapeHtml(successMessage)}</p>
        <p>Deleted: ${result.deleted?.length || 0}. Failed: ${result.failed?.length || 0}.</p>
        <div class="modal-actions"><button id="cancelModal" class="primary">Done</button></div>
      `,
    });
    $('cancelModal').onclick = async () => {
      hideOverlay();
      await refreshAfterDelete();
    };
  } catch (err) {
    showOverlay({
      html: `<h3>Delete failed</h3><p>${escapeHtml(formatElevationError(err))}</p><div class="modal-actions"><button id="cancelModal">Close</button></div>`,
    });
    $('cancelModal').onclick = hideOverlay;
  }
}

async function loadApps() {
  showOverlay({ scan: true, html: '<p>Reading installed programs…</p>' });
  $('appStatus').textContent = 'Loading…';
  try {
    state.apps = await window.cullspace.call('list_apps');
    renderApps();
    $('appStatus').textContent = `${state.apps.length} apps`;
    setStatus(`Loaded ${state.apps.length} apps`, 'Installed programs');
  } catch (err) {
    $('appStatus').textContent = err.message;
    setStatus('App load failed', err.message);
  } finally {
    hideOverlay();
  }
}

function renderApps() {
  const q = ($('appFilter').value || '').trim().toLowerCase();
  const root = $('appResults');
  root.innerHTML = '';
  if (!state.apps.length) {
    root.innerHTML = emptyStateHtml({
      title: 'No apps loaded',
      body: 'Load installed programs to uninstall them and optionally clean leftovers afterward.',
      buttonId: 'emptyLoadApps',
      buttonLabel: 'Load apps',
    });
    $('emptyLoadApps')?.addEventListener('click', loadApps);
    $('appStatus').textContent = '';
    updateSelectionBar('apps');
    return;
  }
  const apps = state.apps.filter((a) => {
    if (!q) return true;
    return (
      a.name.toLowerCase().includes(q) ||
      (a.publisher || '').toLowerCase().includes(q)
    );
  });
  if (!apps.length) {
    root.innerHTML = emptyStateHtml({
      title: 'No matches',
      body: 'Try a different search, or clear the filter to see all apps.',
    });
    updateSelectionBar('apps');
    return;
  }
  const visibleApps = apps.slice(0, state.appsVisibleLimit);
  const visibleKeys = new Set(visibleApps.map(appKey));
  for (const k of [...state.selectedAppKeys]) {
    if (!visibleKeys.has(k)) state.selectedAppKeys.delete(k);
  }
  const selectAll = $('appSelectAll');
  if (selectAll) {
    selectAll.checked =
      visibleApps.length > 0 && visibleApps.every((a) => state.selectedAppKeys.has(appKey(a)));
    selectAll.indeterminate =
      state.selectedAppKeys.size > 0 &&
      !selectAll.checked &&
      visibleApps.some((a) => state.selectedAppKeys.has(appKey(a)));
  }

  visibleApps.forEach((a, index) => {
    const key = appKey(a);
    const row = document.createElement('div');
    row.className = 'item';
    row.style.animationDelay = `${Math.min(index, 24) * 28}ms`;
    const checked = state.selectedAppKeys.has(key) ? 'checked' : '';
    row.innerHTML = `
      <label class="col-check"><input type="checkbox" class="row-check" ${checked} /></label>
      <div class="item-main">
        <div>${escapeHtml(a.name)}</div>
        <div class="path">${escapeHtml(a.publisher || 'Unknown publisher')} · ${escapeHtml(a.version || '')} · ${escapeHtml(a.installLocation || 'No install location')}</div>
      </div>
      <div class="size">${formatBytes(a.estimatedSizeBytes)}</div>
      <button type="button" class="row-action">Uninstall…</button>
    `;
    row.querySelector('.row-check').addEventListener('change', (e) => {
      if (e.target.checked) state.selectedAppKeys.add(key);
      else state.selectedAppKeys.delete(key);
      updateSelectionBar('apps');
      renderApps();
    });
    row.querySelector('.row-action').addEventListener('click', () => uninstallFlow(a));
    root.appendChild(row);
  });
  const shown = visibleApps.length;
  const total = apps.length;
  $('appStatus').textContent = q
    ? `Showing ${shown} of ${total} matches (${state.apps.length} loaded)`
    : `Showing ${shown} of ${total}`;
  if (shown < total) {
    const more = document.createElement('div');
    more.className = 'apps-more';
    more.innerHTML = `<button type="button" id="btnShowMoreApps">Show more</button>`;
    root.appendChild(more);
    $('btnShowMoreApps').onclick = () => {
      state.appsVisibleLimit += APPS_PAGE;
      renderApps();
    };
  }
  updateSelectionBar('apps');
}

async function removePathEntry(entry) {
  const related = await window.cullspace.call('related_files', {
    path: entry.path,
    allowedDrives: selectedDriveList(),
  });
  const removable = related.filter((r) => r.exists && !r.protected);
  if (!removable.length) {
    throw new Error('No removable paths (protected or missing)');
  }
  const result = await window.cullspace.call('delete_paths', {
    paths: removable.map((r) => r.path),
    allowedDrives: selectedDriveList(),
  });
  if (result.error && !result.elevated) {
    throw new Error(result.error || 'Administrator elevation required');
  }
  if (result.failed?.length && !result.deleted?.length) {
    throw new Error(result.failed[0]?.error || 'Delete failed');
  }
  return result;
}

function confirmBatchDelete(items, { title, verb, onRun, note }) {
  const names = items.map((i) => i.name || i.path);
  showOverlay({
    html: `
      <h3>${escapeHtml(title)}</h3>
      <p>Type <strong>DELETE</strong> to confirm. ${escapeHtml(note || 'Items are processed one at a time. Deletes are permanent.')}</p>
      <ul class="preview-list">${selectionPreviewList(names)}</ul>
      ${confirmInputHtml()}
      <div class="modal-actions">
        <button type="button" id="cancelModal">Cancel</button>
        <button type="button" class="danger" id="confirmDelete">${escapeHtml(verb)}</button>
      </div>
    `,
  });
  $('cancelModal').onclick = hideOverlay;
  $('confirmDelete').onclick = async () => {
    const typed = document.getElementById('confirmName').value.trim();
    if (typed !== 'DELETE') {
      setConfirmError('Type DELETE exactly to continue.');
      return;
    }
    setConfirmError('');
    await onRun(items);
  };
}

async function runSequentialPathRemoves(items, refresh) {
  let ok = 0;
  const failures = [];
  try {
    if (window.cullspace.beginElevated) await window.cullspace.beginElevated();
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      showOverlay({
        del: true,
        html: `<p>Removing ${i + 1} of ${items.length} — ${escapeHtml(item.name || item.path)}…</p>
          <p class="muted">One admin prompt covers this batch when possible.</p>`,
      });
      try {
        await removePathEntry(item);
        ok += 1;
      } catch (err) {
        failures.push({
          name: item.name || item.path,
          error: formatElevationError(err),
        });
      }
    }
  } finally {
    try {
      if (window.cullspace.endElevated) await window.cullspace.endElevated();
    } catch {
      // ignore
    }
  }
  showOverlay({
    html: `
      <h3>Batch removal complete</h3>
      <p>Removed: ${ok}. Failed: ${failures.length}.</p>
      ${
        failures.length
          ? `<ul class="preview-list">${failures
              .slice(0, 8)
              .map((f) => `<li>${escapeHtml(f.name)} — ${escapeHtml(f.error)}</li>`)
              .join('')}</ul>`
          : ''
      }
      <div class="modal-actions"><button type="button" id="cancelModal" class="primary">Done</button></div>
    `,
  });
  $('cancelModal').onclick = async () => {
    hideOverlay();
    await refresh();
  };
}

async function runSequentialAppUninstalls(apps) {
  let ok = 0;
  const failures = [];
  try {
    if (window.cullspace.beginElevated) await window.cullspace.beginElevated();
    for (let i = 0; i < apps.length; i += 1) {
      const app = apps[i];
      showOverlay({
        del: true,
        html: `<p>Launching uninstaller ${i + 1} of ${apps.length} — ${escapeHtml(app.name)}…</p>
          <p class="muted">This batch only starts official uninstallers. Leftover cleanup is per-app.</p>`,
      });
      try {
        await window.cullspace.call('uninstall_app', { uninstallString: app.uninstallString });
        ok += 1;
        await sleep(800);
      } catch (err) {
        failures.push({ name: app.name, error: formatElevationError(err) });
      }
    }
  } finally {
    try {
      if (window.cullspace.endElevated) await window.cullspace.endElevated();
    } catch {
      // ignore
    }
  }
  showOverlay({
    html: `
      <h3>Batch uninstall launched</h3>
      <p>Launch attempted: ${ok}. Failed: ${failures.length}.</p>
      <p class="muted">Complete each vendor uninstaller yourself. Use Uninstall… on a single app afterward if you want leftover cleanup.</p>
      ${
        failures.length
          ? `<ul class="preview-list">${failures
              .slice(0, 8)
              .map((f) => `<li>${escapeHtml(f.name)} — ${escapeHtml(f.error)}</li>`)
              .join('')}</ul>`
          : ''
      }
      <div class="modal-actions"><button type="button" id="cancelModal" class="primary">Done</button></div>
    `,
  });
  $('cancelModal').onclick = () => {
    hideOverlay();
    loadApps();
  };
}

function removeSelectedFiles() {
  const items = state.files.filter((f) => state.selectedFilePaths.has(f.path));
  if (!items.length) return;
  confirmBatchDelete(items, {
    title: `Remove ${items.length} selected files`,
    verb: 'Delete with admin',
    onRun: async (list) => {
      state.selectedFilePaths.clear();
      updateSelectionBar('files');
      await runSequentialPathRemoves(list, async () => {
        await scanFiles();
      });
    },
  });
}

function removeSelectedFolders() {
  const items = state.folderResults.filter((f) => state.selectedFolderPaths.has(f.path));
  if (!items.length) return;
  confirmBatchDelete(items, {
    title: `Remove ${items.length} selected items`,
    verb: 'Delete with admin',
    onRun: async (list) => {
      state.selectedFolderPaths.clear();
      updateSelectionBar('folders');
      await runSequentialPathRemoves(list, async () => {
        if (state.foldersMode === 'folders') await scanLargeFolders();
        else await scanFolderFiles();
      });
    },
  });
}

function uninstallSelectedApps() {
  const apps = state.apps.filter((a) => state.selectedAppKeys.has(appKey(a)));
  if (!apps.length) return;
  confirmBatchDelete(apps, {
    title: `Uninstall ${apps.length} selected apps`,
    verb: 'Start uninstallers',
    note: 'This only launches each official uninstaller (launch-only). Leftover cleanup stays on single-app Uninstall…',
    onRun: async (list) => {
      state.selectedAppKeys.clear();
      updateSelectionBar('apps');
      await runSequentialAppUninstalls(list);
    },
  });
}

function waitForUninstallerOrUser(pid) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (reason) => {
      if (settled) return;
      settled = true;
      resolve(reason);
    };
    showOverlay({
      html: `
        <h3>Finish the uninstaller</h3>
        <p>Complete the vendor uninstaller window. CullSpace will continue when it exits, or when you confirm.</p>
        <p class="muted" id="uninstallWaitStatus">${pid ? `Watching process ${pid}…` : 'Waiting…'}</p>
        <div class="modal-actions">
          <button type="button" id="btnUninstallFinished" class="primary">I’ve finished</button>
        </div>
      `,
    });
    $('btnUninstallFinished').onclick = () => done('user');
    if (pid && window.cullspace.waitForPid) {
      window.cullspace
        .waitForPid(pid, 30 * 60 * 1000)
        .then(() => done('exit'))
        .catch(() => {
          const el = $('uninstallWaitStatus');
          if (el) el.textContent = 'Still waiting — click I’ve finished when the uninstaller is done.';
        });
    }
  });
}

async function uninstallFlow(app) {
  showOverlay({
    html: `
      <h3>Uninstall ${escapeHtml(app.name)}</h3>
      <p>Step 1: launch the official uninstaller (UAC may appear). After it finishes, CullSpace can scan leftovers for a second confirmed cleanup.</p>
      ${confirmInputHtml()}
      <div class="modal-actions">
        <button type="button" id="cancelModal">Cancel</button>
        <button type="button" class="danger" id="confirmUninstall">Start official uninstall</button>
      </div>
    `,
  });
  $('cancelModal').onclick = hideOverlay;
  $('confirmUninstall').onclick = async () => {
    const typed = document.getElementById('confirmName').value.trim();
    if (typed !== 'DELETE') {
      setConfirmError('Type DELETE exactly to continue.');
      return;
    }
    setConfirmError('');
    showOverlay({ del: true, html: '<p>Starting official uninstaller…</p>' });
    try {
      const launched = await window.cullspace.call('uninstall_app', {
        uninstallString: app.uninstallString,
      });
      await waitForUninstallerOrUser(launched?.pid);
      await leftoverPass(app);
    } catch (err) {
      showOverlay({
        html: `<h3>Uninstall launch failed</h3><p>${escapeHtml(formatElevationError(err))}</p><div class="modal-actions"><button id="cancelModal">Close</button></div>`,
      });
      $('cancelModal').onclick = hideOverlay;
    }
  };
}

async function leftoverPass(app) {
  showOverlay({ scan: true, html: '<p>Scanning for leftover related files…</p>' });
  try {
    const related = await window.cullspace.call('related_app', {
      app,
      allowedDrives: selectedDriveList(),
    });
    const removable = related.filter((r) => r.exists && !r.protected);
    showOverlay({
      html: `
        <h3>Leftover cleanup</h3>
        <p>Review leftovers for <strong>${escapeHtml(app.name)}</strong>, then confirm to delete with admin rights. Deletes are permanent.</p>
        <ul class="preview-list">
          ${
            related.length
              ? related
                  .map(
                    (r) => `<li>
                      <div>${escapeHtml(r.path)}</div>
                      <div class="reason">${escapeHtml(r.reason)} · ${formatBytes(r.sizeBytes)}${r.protected ? ' · <span class="bad">protected</span>' : ''}</div>
                    </li>`
                  )
                  .join('')
              : '<li>No leftover paths detected.</li>'
          }
        </ul>
        ${confirmInputHtml()}
        <div class="modal-actions">
          <button type="button" id="cancelModal">Skip leftovers</button>
          <button type="button" class="danger" id="confirmDelete" ${removable.length ? '' : 'disabled'}>Delete leftovers</button>
        </div>
      `,
    });
    $('cancelModal').onclick = hideOverlay;
    $('confirmDelete').onclick = async () => {
      const typed = document.getElementById('confirmName').value.trim();
      if (typed !== 'DELETE') {
        setConfirmError('Type DELETE exactly to continue.');
        return;
      }
      setConfirmError('');
      await deletePaths(removable.map((r) => r.path), `Leftovers cleaned for ${app.name}`);
      loadApps();
    };
  } catch (err) {
    showOverlay({
      html: `<h3>Leftover scan failed</h3><p>${escapeHtml(err.message)}</p><div class="modal-actions"><button id="cancelModal">Close</button></div>`,
    });
    $('cancelModal').onclick = hideOverlay;
  }
}

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function syncTabAria() {
  document.querySelectorAll('.tab').forEach((b) => {
    const on = b.classList.contains('active');
    b.setAttribute('aria-selected', on ? 'true' : 'false');
    b.setAttribute('tabindex', on ? '0' : '-1');
  });
}

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.tab = btn.dataset.tab;
    const panes = {
      files: $('filesPane'),
      folders: $('foldersPane'),
      apps: $('appsPane'),
    };
    Object.entries(panes).forEach(([key, pane]) => {
      if (!pane) return;
      pane.classList.toggle('hidden', state.tab !== key);
    });
    const pane = panes[state.tab];
    if (pane) {
      pane.classList.remove('switching');
      void pane.offsetWidth;
      pane.classList.add('switching');
    }
    syncTabAria();
    moveTabInk();
    syncTabStatus();
  });
});
syncTabAria();

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const overlay = $('overlay');
  if (!overlay || overlay.classList.contains('hidden')) return;
  if ($('animScan') && !$('animScan').classList.contains('hidden')) return;
  if ($('animDelete') && !$('animDelete').classList.contains('hidden')) return;
  if (state.updateDownloading) return;
  hideOverlay();
});

window.addEventListener('resize', moveTabInk);

if (window.cullspace.onScanProgress) {
  window.cullspace.onScanProgress((message) => {
    const el = $('scanProgressText');
    if (el && message) el.textContent = message;
  });
}

$('btnRefreshDrives').addEventListener('click', refreshDrives);
$('includeNetwork').addEventListener('change', refreshDrives);
$('btnScanFiles').addEventListener('click', scanFiles);
$('btnLoadApps').addEventListener('click', loadApps);
$('fileFilter').addEventListener('input', renderFiles);
$('appFilter').addEventListener('input', renderApps);
$('btnBrowseFolder').addEventListener('click', browseFolderRoot);
$('btnScanFolderFiles').addEventListener('click', scanFolderFiles);
$('btnScanLargeFolders').addEventListener('click', scanLargeFolders);
document.querySelectorAll('[data-folders-mode]').forEach((btn) => {
  btn.addEventListener('click', () => setFoldersMode(btn.getAttribute('data-folders-mode')));
});

$('fileSelectAll').addEventListener('change', () => {
  const q = ($('fileFilter').value || '').trim().toLowerCase();
  const files = state.files.filter((f) => {
    if (!q) return true;
    return (
      (f.name || '').toLowerCase().includes(q) ||
      (f.path || '').toLowerCase().includes(q)
    );
  });
  if ($('fileSelectAll').checked) files.forEach((f) => state.selectedFilePaths.add(f.path));
  else files.forEach((f) => state.selectedFilePaths.delete(f.path));
  renderFiles();
});
$('folderSelectAll').addEventListener('change', () => {
  const rows = state.folderResults || [];
  if ($('folderSelectAll').checked) rows.forEach((f) => state.selectedFolderPaths.add(f.path));
  else rows.forEach((f) => state.selectedFolderPaths.delete(f.path));
  renderFolderResults();
});
$('appSelectAll').addEventListener('change', () => {
  const q = ($('appFilter').value || '').trim().toLowerCase();
  const apps = state.apps
    .filter((a) => {
      if (!q) return true;
      return (
        a.name.toLowerCase().includes(q) || (a.publisher || '').toLowerCase().includes(q)
      );
    })
    .slice(0, state.appsVisibleLimit);
  if ($('appSelectAll').checked) apps.forEach((a) => state.selectedAppKeys.add(appKey(a)));
  else apps.forEach((a) => state.selectedAppKeys.delete(appKey(a)));
  renderApps();
});
$('btnClearFileSelection').addEventListener('click', () => {
  state.selectedFilePaths.clear();
  renderFiles();
});
$('btnClearFolderSelection').addEventListener('click', () => {
  state.selectedFolderPaths.clear();
  renderFolderResults();
});
$('btnClearAppSelection').addEventListener('click', () => {
  state.selectedAppKeys.clear();
  renderApps();
});
$('btnRemoveSelectedFiles').addEventListener('click', removeSelectedFiles);
$('btnRemoveSelectedFolders').addEventListener('click', removeSelectedFolders);
$('btnUninstallSelectedApps').addEventListener('click', uninstallSelectedApps);
$('btnLogs').addEventListener('click', () => window.cullspace.openLogs());
$('btnSettings').addEventListener('click', openSettings);
$('btnHelp').addEventListener('click', () => {
  openHelp();
});
if (window.cullspace.onOpenSettings) {
  window.cullspace.onOpenSettings(() => openSettings());
}

window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
  if (state.themePreference === 'system') applyTheme('system', { animate: true });
});

applyTheme(state.themePreference, { animate: false });
setFoldersMode(state.foldersMode);

if (window.cullspace.updates) {
  window.cullspace.updates.onAvailable((info) => {
    showUpdatePrompt(info);
  });
  window.cullspace.updates.onProgress((progress) => {
    const bar = document.getElementById('updateBar');
    const meta = document.getElementById('updateMeta');
    if (!bar || !meta) return;
    if (progress.percent != null) {
      bar.style.width = `${progress.percent}%`;
      meta.textContent =
        progress.total > 0
          ? `Downloading… ${progress.percent}%`
          : `Downloading… ${Math.round((progress.received || 0) / (1024 * 1024))} MB`;
    } else {
      meta.textContent = `Downloading… ${Math.round((progress.received || 0) / (1024 * 1024))} MB`;
    }
  });
  window.cullspace.updates.onStatus((payload) => {
    if (payload?.message) setStatus(payload.message, 'Updates');
  });
}

boot();
