const THEME_KEY = 'cullspace.theme';

const state = {
  drives: [],
  selectedDrives: new Set(),
  files: [],
  apps: [],
  tab: 'files',
  themePreference: localStorage.getItem(THEME_KEY) || 'system',
  pendingUpdate: null,
  updateDownloading: false,
};

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
        <button type="button" class="primary" id="updateNow">Update Now</button>
      </div>
    `,
  });

  $('remindLater').onclick = () => {
    // Session-only dismiss; next launch will check again.
    state.pendingUpdate = null;
    hideOverlay();
    setStatus('Update reminder set', `v${info.latestVersion} available next launch`);
  };

  $('updateNow').onclick = async () => {
    if (!state.pendingUpdate || state.updateDownloading) return;
    state.updateDownloading = true;
    const download = document.getElementById('updateDownload');
    const bar = document.getElementById('updateBar');
    const meta = document.getElementById('updateMeta');
    const updateBtn = document.getElementById('updateNow');
    const remindBtn = document.getElementById('remindLater');
    download.classList.remove('hidden');
    updateBtn.disabled = true;
    remindBtn.disabled = true;
    updateBtn.textContent = 'Downloading…';
    setStatus('Downloading update…', `v${info.latestVersion}`);

    try {
      await window.cullspace.updates.install(state.pendingUpdate);
      meta.textContent = 'Launching installer…';
      bar.style.width = '100%';
      setStatus('Updater launched', 'CullSpace will close');
    } catch (err) {
      state.updateDownloading = false;
      updateBtn.disabled = false;
      remindBtn.disabled = false;
      updateBtn.textContent = 'Update Now';
      meta.textContent = err.message || 'Download failed';
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
      <div class="modal-actions">
        <button type="button" id="cancelModal" class="primary">Done</button>
      </div>
    `,
  });
  $('cancelModal').onclick = hideOverlay;
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

function showOverlay({ scan = false, del = false, html = '' }) {
  const overlay = $('overlay');
  overlay.classList.remove('hidden', 'closing');
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
}

function hideOverlay() {
  const overlay = $('overlay');
  if (overlay.classList.contains('hidden')) return;
  overlay.classList.add('closing');
  setTimeout(() => {
    overlay.classList.add('hidden');
    overlay.classList.remove('closing');
    $('animScan').classList.add('hidden');
    $('animDelete').classList.add('hidden');
    $('modalBody').innerHTML = '';
  }, 170);
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
  } catch (err) {
    $('splash').querySelector('.splash-sub').textContent = `Helper failed: ${err.message}`;
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

async function scanFiles() {
  const drives = selectedDriveList();
  if (!drives.length) {
    $('scanStatus').textContent = 'Select at least one drive.';
    return;
  }
  const limit = Number($('fileLimit').value) || 100;
  showOverlay({ scan: true, html: '<p>Ranking the largest files on selected drives…</p>' });
  $('scanStatus').textContent = 'Scanning…';
  try {
    state.files = await window.cullspace.call('scan_files', { drives, limit });
    renderFiles();
    $('scanStatus').textContent = `${state.files.length} items`;
    setStatus(`Scan complete · ${state.files.length} items`, selectedDriveList().join(' '));
  } catch (err) {
    $('scanStatus').textContent = err.message;
    setStatus('Scan failed', err.message);
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

  files.forEach((f, index) => {
    const row = document.createElement('div');
    row.className = 'item';
    row.style.animationDelay = `${Math.min(index, 24) * 28}ms`;
    row.innerHTML = `
      <div>
        <div>${escapeHtml(f.name || f.path)}</div>
        <div class="path">${escapeHtml(f.path)}</div>
      </div>
      <div class="size">${formatBytes(f.sizeBytes)}</div>
      <button type="button">Remove…</button>
    `;
    row.querySelector('button').addEventListener('click', () => previewFileRemove(f));
    root.appendChild(row);
  });

  if (state.files.length) {
    $('scanStatus').textContent = q
      ? `${files.length} of ${state.files.length} items`
      : `${state.files.length} items`;
  }
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
        <p>Type <strong>${escapeHtml(file.name)}</strong> to confirm, then continue to the Windows admin prompt.</p>
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
        <label class="settings-row">Confirm name
          <input id="confirmName" class="field" type="text" style="width:100%;margin-top:0.35rem;" />
        </label>
        <div class="modal-actions">
          <button type="button" id="cancelModal">Cancel</button>
          <button type="button" class="danger" id="confirmDelete" ${removable.length ? '' : 'disabled'}>Delete with admin</button>
        </div>
      `,
    });
    $('cancelModal').onclick = hideOverlay;
    $('confirmDelete').onclick = async () => {
      const typed = document.getElementById('confirmName').value.trim();
      if (typed !== file.name) {
        alert('Confirmation text does not match.');
        return;
      }
      if (blocked.length) {
        // protected paths are skipped by helper anyway
      }
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
          <h3>Administrator required</h3>
          <p>${escapeHtml(result.error)}</p>
          <p>Re-run CullSpace / the helper as Administrator for delete operations, or approve the UAC prompt when shown.</p>
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
    $('cancelModal').onclick = () => {
      hideOverlay();
      scanFiles();
    };
  } catch (err) {
    showOverlay({
      html: `<h3>Delete failed</h3><p>${escapeHtml(err.message)}</p><div class="modal-actions"><button id="cancelModal">Close</button></div>`,
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
  const apps = state.apps.filter((a) => {
    if (!q) return true;
    return (
      a.name.toLowerCase().includes(q) ||
      (a.publisher || '').toLowerCase().includes(q)
    );
  });

  apps.slice(0, 400).forEach((a, index) => {
    const row = document.createElement('div');
    row.className = 'item';
    row.style.animationDelay = `${Math.min(index, 24) * 28}ms`;
    row.innerHTML = `
      <div>
        <div>${escapeHtml(a.name)}</div>
        <div class="path">${escapeHtml(a.publisher || 'Unknown publisher')} · ${escapeHtml(a.version || '')} · ${escapeHtml(a.installLocation || 'No install location')}</div>
      </div>
      <div class="size">${formatBytes(a.estimatedSizeBytes)}</div>
      <button type="button">Uninstall…</button>
    `;
    row.querySelector('button').addEventListener('click', () => uninstallFlow(a));
    root.appendChild(row);
  });
}

async function uninstallFlow(app) {
  showOverlay({
    html: `
      <h3>Uninstall ${escapeHtml(app.name)}</h3>
      <p>Step 1: launch the official uninstaller (UAC may appear). After it finishes, CullSpace will scan leftovers for a second confirmed cleanup.</p>
      <label class="settings-row">Type <strong>${escapeHtml(app.name)}</strong> to continue
        <input id="confirmName" class="field" type="text" style="width:100%;margin-top:0.35rem;" />
      </label>
      <div class="modal-actions">
        <button type="button" id="cancelModal">Cancel</button>
        <button type="button" class="danger" id="confirmUninstall">Start official uninstall</button>
      </div>
    `,
  });
  $('cancelModal').onclick = hideOverlay;
  $('confirmUninstall').onclick = async () => {
    const typed = document.getElementById('confirmName').value.trim();
    if (typed !== app.name) {
      alert('Confirmation text does not match.');
      return;
    }
    showOverlay({ del: true, html: '<p>Starting official uninstaller…</p>' });
    try {
      await window.cullspace.call('uninstall_app', { uninstallString: app.uninstallString });
      await leftoverPass(app);
    } catch (err) {
      showOverlay({
        html: `<h3>Uninstall launch failed</h3><p>${escapeHtml(err.message)}</p><div class="modal-actions"><button id="cancelModal">Close</button></div>`,
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
        <p>Official uninstaller was started. Review leftovers for <strong>${escapeHtml(app.name)}</strong>, then confirm to delete with admin rights.</p>
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
        <label class="settings-row">Type <strong>CLEAN ${escapeHtml(app.name)}</strong>
          <input id="confirmName" class="field" type="text" style="width:100%;margin-top:0.35rem;" />
        </label>
        <div class="modal-actions">
          <button type="button" id="cancelModal">Skip leftovers</button>
          <button type="button" class="danger" id="confirmDelete" ${removable.length ? '' : 'disabled'}>Delete leftovers</button>
        </div>
      `,
    });
    $('cancelModal').onclick = hideOverlay;
    $('confirmDelete').onclick = async () => {
      const typed = document.getElementById('confirmName').value.trim();
      if (typed !== `CLEAN ${app.name}`) {
        alert('Confirmation text does not match.');
        return;
      }
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

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.tab = btn.dataset.tab;
    const filesPane = $('filesPane');
    const appsPane = $('appsPane');
    filesPane.classList.toggle('hidden', state.tab !== 'files');
    appsPane.classList.toggle('hidden', state.tab !== 'apps');
    const pane = state.tab === 'files' ? filesPane : appsPane;
    pane.classList.remove('switching');
    void pane.offsetWidth;
    pane.classList.add('switching');
    moveTabInk();
  });
});

window.addEventListener('resize', moveTabInk);

$('btnRefreshDrives').addEventListener('click', refreshDrives);
$('includeNetwork').addEventListener('change', refreshDrives);
$('btnScanFiles').addEventListener('click', scanFiles);
$('btnLoadApps').addEventListener('click', loadApps);
$('fileFilter').addEventListener('input', renderFiles);
$('appFilter').addEventListener('input', renderApps);
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
