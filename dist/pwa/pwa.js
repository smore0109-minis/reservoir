(function () {
  const en = () => localStorage.getItem('retirement-language') === 'en';
  const label = (zh, english) => (en() ? english : zh);
  const controls = document.createElement('div');
  controls.className = 'app-portability';
  const backup = document.createElement('button');
  const restore = document.createElement('button');
  const install = document.createElement('button');
  const status = document.createElement('span');
  status.setAttribute('role', 'status');
  install.hidden = true;
  for (const button of [backup, restore, install]) {
    button.type = 'button';
    button.className = 'ghost';
    controls.append(button);
  }
  controls.append(status);
  document.querySelector('.topbar').after(controls);
  let statusCode = '';
  const messages = {
    ready: ['已可離線使用', 'Ready for offline use'],
    loading: ['正在準備離線資料…', 'Preparing offline data…'],
    update: [
      '新版已下載；請關閉所有此應用程式視窗與分頁後重新開啟。',
      'Update downloaded. Close all app windows and tabs, then reopen.',
    ],
    error: ['離線準備未完成；請連線後重新開啟。', 'Offline setup incomplete. Reopen while online.'],
  };
  function render() {
    backup.textContent = label('備份設定', 'Back up settings');
    restore.textContent = label('匯入設定', 'Import settings');
    install.textContent = label('安裝應用程式', 'Install app');
    status.textContent = statusCode ? label(...messages[statusCode]) : '';
  }
  function setStatus(code) {
    statusCode = code;
    render();
  }
  document.getElementById('language-toggle').addEventListener('click', render);
  render();
  const keys = [
    'retirement-reservoir',
    'retirement-selected-plan',
    'retirement-language',
    'retirement-scenario-comparison',
  ];
  backup.onclick = () => {
    const data = Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)]));
    const blob = new Blob([JSON.stringify({ format: 'retirement-reservoir-backup', version: 1, data }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `retirement-settings-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  restore.onclick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        if (file.size > 5 * 1024 * 1024) throw new Error('size');
        const parsed = JSON.parse(await file.text());
        if (parsed.format !== 'retirement-reservoir-backup' || parsed.version !== 1 || !parsed.data)
          throw new Error('format');
        const data = { ...parsed.data };
        // Older backups predate the independent scenario workspace.
        if (data[keys[3]] === undefined) data[keys[3]] = null;
        if (data[keys[3]] !== null) {
          const comparison = JSON.parse(data[keys[3]]);
          if (
            !comparison ||
            !['a', 'b', 'c'].includes(comparison.planId) ||
            !['real', 'nominal'].includes(comparison.basis) ||
            !Array.isArray(comparison.scenarios) ||
            comparison.scenarios.length !== 3 ||
            !comparison.scenarios.every(
              item =>
                item &&
                ['sp500', 'taiwan', 'nikkei'].includes(item.market) &&
                ['forward', 'reverse'].includes(item.direction) &&
                Number.isInteger(item.startYear) &&
                typeof item.enabled === 'boolean',
            )
          )
            throw new Error('scenario comparison');
        }
        if (!keys.every(key => data[key] === null || typeof data[key] === 'string')) throw new Error('data');
        const state = JSON.parse(data[keys[0]]);
        if (
          !state ||
          typeof state !== 'object' ||
          Array.isArray(state) ||
          !Array.isArray(state.buckets) ||
          state.schemaVersion > window.RetirementSim.DEFAULT.schemaVersion
        )
          throw new Error('state');
        if (data[keys[1]] !== null && !['a', 'b', 'c'].includes(data[keys[1]])) throw new Error('plan');
        if (data[keys[2]] !== null && !['zh', 'en'].includes(data[keys[2]])) throw new Error('language');
        if (
          !confirm(
            label(
              '匯入會取代目前所有設定並重新載入。建議先備份，是否繼續？',
              'Import replaces all current settings and reloads. Back up first. Continue?',
            ),
          )
        )
          return;
        const previous = keys.map(key => localStorage.getItem(key));
        try {
          for (const key of keys) {
            if (data[key] === null) localStorage.removeItem(key);
            else localStorage.setItem(key, data[key]);
          }
        } catch (error) {
          keys.forEach((key, i) =>
            previous[i] === null ? localStorage.removeItem(key) : localStorage.setItem(key, previous[i]),
          );
          throw error;
        }
        location.reload();
      } catch {
        alert(
          label(
            '匯入失敗：請選擇有效的設定備份，並確認瀏覽器有可用儲存空間。',
            'Import failed. Choose a valid settings backup and check available browser storage.',
          ),
        );
      }
    };
    input.click();
  };
  if (window.desktop?.isElectron || !['http:', 'https:'].includes(location.protocol)) return;
  if (window.pwaVersion)
    document.getElementById('app-version').textContent = `RETIREMENT ASSET PLANNER · v${window.pwaVersion} · PWA`;
  let prompt;
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    prompt = event;
    install.hidden = false;
  });
  install.onclick = async () => {
    if (!prompt) return;
    await prompt.prompt();
    prompt = null;
    install.hidden = true;
  };
  window.addEventListener('appinstalled', () => {
    install.hidden = true;
  });
  if (!('serviceWorker' in navigator)) {
    setStatus('error');
    return;
  }
  setStatus('loading');
  navigator.serviceWorker
    .register('./sw.js', { updateViaCache: 'none' })
    .then(registration => {
      const update = () => {
        if (registration.waiting) setStatus('update');
      };
      update();
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed') update();
          if (worker.state === 'redundant') setStatus('error');
        });
      });
      navigator.serviceWorker.ready.then(() => {
        if (statusCode !== 'update') setStatus('ready');
      });
    })
    .catch(() => setStatus('error'));
})();
