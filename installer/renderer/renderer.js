const state = {
  step: 'welcome',
  installDir: '',
  result: null,
  busy: false,
};

const $ = (id) => document.getElementById(id);

function showStep(name) {
  state.step = name;
  ['Welcome', 'Location', 'Install', 'Done', 'Error'].forEach((key) => {
    $(`step${key}`).classList.toggle('active', key.toLowerCase() === name);
  });

  const back = $('btnBack');
  const next = $('btnNext');
  const cancel = $('btnCancel');

  back.classList.toggle('hidden', name === 'welcome' || name === 'install' || name === 'done');
  cancel.textContent = name === 'done' || name === 'error' ? 'Close' : 'Cancel';
  cancel.disabled = name === 'install';

  if (name === 'welcome') {
    next.textContent = 'Continue';
    next.classList.remove('hidden');
    next.disabled = false;
  } else if (name === 'location') {
    next.textContent = 'Install';
    next.classList.remove('hidden');
    next.disabled = false;
  } else if (name === 'install') {
    next.classList.add('hidden');
  } else if (name === 'done') {
    next.textContent = 'Finish';
    next.classList.remove('hidden');
    next.disabled = false;
  } else if (name === 'error') {
    next.textContent = 'Retry';
    next.classList.remove('hidden');
    next.disabled = false;
  }
}

function setProgress({ percent = 0, message = '' } = {}) {
  $('progressBar').style.width = `${percent}%`;
  $('progressPercent').textContent = `${percent}%`;
  if (message) $('progressMessage').textContent = message;
}

async function boot() {
  const defaults = await window.setup.defaults();
  state.installDir = defaults.installDir;
  $('installDir').value = defaults.installDir;
  $('versionLabel').textContent = `v${defaults.version}`;
  window.setup.onProgress(setProgress);
  showStep('welcome');
}

async function runInstall() {
  state.busy = true;
  showStep('install');
  setProgress({ percent: 2, message: 'Starting installation…' });
  try {
    const result = await window.setup.install({ installDir: $('installDir').value.trim() });
    state.result = result;
    $('doneMessage').textContent = `Installed to ${result.installDir}`;
    showStep('done');
    if ($('launchAfter').checked) {
      await window.setup.launch(result.exePath);
    }
  } catch (err) {
    $('errorMessage').textContent = err.message || String(err);
    showStep('error');
  } finally {
    state.busy = false;
  }
}

$('btnBrowse').addEventListener('click', async () => {
  const chosen = await window.setup.browse($('installDir').value.trim());
  $('installDir').value = chosen;
  state.installDir = chosen;
});

$('btnBack').addEventListener('click', () => {
  if (state.step === 'location') showStep('welcome');
  else if (state.step === 'error') showStep('location');
});

$('btnCancel').addEventListener('click', () => {
  if (state.busy) return;
  window.setup.quit();
});

$('btnNext').addEventListener('click', async () => {
  if (state.step === 'welcome') {
    showStep('location');
    return;
  }
  if (state.step === 'location' || state.step === 'error') {
    await runInstall();
    return;
  }
  if (state.step === 'done') {
    window.setup.quit();
  }
});

boot();
