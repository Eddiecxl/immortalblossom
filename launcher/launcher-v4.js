const $ = (id) => document.getElementById(id);
const toast = $('toast');
let toastTimer;
let offeredUpdateKey = '';
let snoozedUpdateKey = '';
let installingUpdate = false;
let latestUpdateState = null;
let modelStatus = null;
const pendingVersionKey = 'luoxian_pending_update_version';
const lowSpecUI = Number(navigator.hardwareConcurrency || 8) <= 8 || (Number(navigator.deviceMemory || 0) > 0 && Number(navigator.deviceMemory || 0) <= 8);
if (lowSpecUI) document.documentElement.classList.add('low-spec-ui');

function say(message) {
  clearTimeout(toastTimer);
  toast.textContent = String(message || '');
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2200);
}

function formatGiB(bytes) { return (Number(bytes || 0) / 1073741824).toFixed(1) + ' GiB'; }

function renderModelStatus(status) {
  modelStatus = status;
  try { localStorage.setItem('luoxian_active_local_model', status.active || ''); } catch (_) {}
  const hardware = status.hardware || {};
  $('modelHardware').textContent = `${hardware.totalRamGiB ?? '?'} GiB RAM（可用 ${hardware.availableRamGiB ?? '?'}）· ${hardware.cpu || 'CPU 未识别'} · GPU ${hardware.gpu || '未知'} / ${hardware.vramGiB ?? '?'} GiB · ${hardware.freeDiskGiB ?? '?'} GiB 磁盘`;
  const active = (status.models || []).find(model => model.fileName === status.active);
  const activeName = active?.label || (status.active?.startsWith('universal-') ? '随包 Qwen3-4B' : (status.active || '未选择'));
  $('modelCurrent').textContent = `正在使用：${activeName}。推荐：${(status.models || []).find(model => model.id === status.recommended)?.label || '随包模型'}。下载文件保存在本机用户目录，不随游戏补丁重复下载。`;
  if (status.downloadInProgress) $('modelProgress').textContent = `正在下载 ${status.downloadModel}：${status.progress || '准备中'}`;
  const choices = $('modelChoices');
  choices.replaceChildren();
  for (const model of status.models || []) {
    const row = document.createElement('article');
    row.className = 'model-choice';
    const description = document.createElement('div');
    const title = document.createElement('b'); title.textContent = model.label;
    const detail = document.createElement('small');
    const eligible = model.compatible && model.hardwareEligible;
    detail.textContent = `${formatGiB(model.estimatedBytes)} · 至少 ${model.minimumRamGiB} GiB RAM · ${model.installed ? '已下载' : '未下载'}${eligible ? '' : model.compatible ? ' · 内存不足' : ' · 需更新运行时'}`;
    description.append(title, detail);
    const controls = document.createElement('div'); controls.className = 'model-choice-actions';
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = model.installed ? '使用' : '下载';
    button.disabled = !eligible || Boolean(status.downloadInProgress) || status.active === model.fileName;
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        if (model.installed) {
          await window.nativeAction('model-select', { id: model.id });
          $('modelProgress').textContent = '模型已切换；下次进入游戏生效。';
          await refreshModels();
        } else {
          await window.nativeAction('model-download', { id: model.id });
          $('modelProgress').textContent = `${model.label} 正在后台下载。中断后可继续。`;
          await refreshModels();
        }
      } catch (error) { $('modelProgress').textContent = error.message; await refreshModels(); }
    });
    controls.append(button);
    if (model.installed && status.active !== model.fileName) {
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '删除';
      remove.addEventListener('click', async () => {
        if (!confirm(`删除已下载的 ${model.label}？`)) return;
        try { await window.nativeAction('model-delete', { id: model.id }); await refreshModels(); }
        catch (error) { $('modelProgress').textContent = error.message; }
      });
      controls.append(remove);
    }
    row.append(description, controls); choices.append(row);
  }
}

async function refreshModels() {
  if (!window.lxNative) {
    $('modelHardware').textContent = '请从 LuoXian.exe 启动以管理本地模型';
    $('modelCurrent').textContent = '浏览器预览模式无法检测硬件或下载模型。';
    $('modelCustomButton').disabled = true;
    $('modelBundledButton').disabled = true;
    return;
  }
  try { renderModelStatus(await window.nativeAction('model-status')); }
  catch (error) { $('modelProgress').textContent = '模型状态读取失败：' + error.message; }
}

window.addEventListener('lx:model-progress', event => {
  const detail = event.detail || {};
  $('modelProgress').textContent = detail.message || detail.phase || '模型下载中';
  if (detail.phase === 'complete' || detail.phase === 'error') refreshModels();
});

async function api(path, options = {}) {
  const response = await fetch(path, { cache: 'no-store', ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `操作失败 · HTTP ${response.status}`);
  return data;
}

async function loadUpdateDiscovery() {
  if (!window.lxNative) throw new Error('请从 LuoXian.exe 启动以管理补丁');
  const native = await window.nativeAction('scan-patches');
  const scan = {patches:(native.patches||[]).filter(p=>p.valid).sort((a,b)=>b.toVersion.localeCompare(a.toVersion,undefined,{numeric:true})).slice(0,1).map(p=>({patch_id:p.name,from_version:p.fromVersion,to_version:p.toVersion,notes:[]})),rejected:(native.patches||[]).filter(p=>!p.valid).length};
  const patches = Array.isArray(scan.patches) ? scan.patches : [];
  const first = patches[0] || null;
  const last = patches.at(-1) || null;
  latestUpdateState = {
    available: patches.length > 0,
    current_version: first?.from_version || native.version || '',
    target_version: last?.to_version || '',
    patch_count: patches.length,
    patch_ids: patches.map(item => item.patch_id).filter(Boolean),
    notes: patches.flatMap(item => Array.isArray(item.notes) ? item.notes : []),
    rejected: Number(scan.rejected || 0)
  };
  return latestUpdateState;
}

function updateKey(state) {
  if (!state?.available) return '';
  return [state.current_version || '', state.target_version || '', ...(state.patch_ids || [])].join('|');
}

function setUpdateModal(open) {
  $('updateConfirmLayer').hidden = !open;
  if (!open && !installingUpdate) document.body.classList.remove('update-lock');
}

function renderUpdateOffer(state) {
  const count = Math.max(1, Number(state.patch_count || 1));
  $('updateConfirmTitle').textContent = count > 1 ? `发现 ${count} 个连续更新` : '发现可用更新';
  const notes = Array.isArray(state.notes) ? state.notes.filter(Boolean).slice(0, 4) : [];
  $('updateConfirmText').textContent =
    `已检测到可安装补丁。目前只完成只读检测，还没有改动任何文件；点击“确认更新”后才会安装，完成后会自动关闭并重新打开启动器。更新内容请查看公告。` +
    (notes.length ? '\n\n本次更新：\n• ' + notes.join('\n• ') : '');
  $('updateProgressWrap').hidden = true;
  $('updateLaterButton').hidden = false;
  $('updateLaterButton').disabled = false;
  $('updateConfirmButton').disabled = false;
  $('updateConfirmButton').querySelector('span').textContent = '确认更新';
}

async function checkForUpdate({ manual = false, forceOffer = false } = {}) {
  if (installingUpdate) return;
  try {
    const state = await loadUpdateDiscovery();
    const key = updateKey(state);
    if (!state?.available || !key) {
      $('updateTitle').textContent = '当前没有可安装更新';
      $('updateText').textContent = state.rejected ? `有 ${state.rejected} 个补丁未通过校验或与当前版本不兼容。` : 'Patches 中没有可从当前版本安装的有效补丁。';
      if (manual) say('暂无可安装更新');
      return;
    }

    $('updateTitle').textContent = '发现可用更新';
    $('updateText').textContent = `已检测到 ${state.patch_count || 1} 个可安装补丁，等待玩家确认。`;

    if (forceOffer || (key !== offeredUpdateKey && key !== snoozedUpdateKey)) {
      offeredUpdateKey = key;
      renderUpdateOffer(state);
      setUpdateModal(true);
    }
  } catch (error) {
    if (manual) say('检查更新失败：' + error.message);
  }
}

async function applyConfirmedUpdate() {
  if (installingUpdate || !latestUpdateState?.available) return;
  installingUpdate = true;
  document.body.classList.add('update-lock');
  $('updateLaterButton').hidden = true;
  $('updateConfirmButton').disabled = true;
  $('updateConfirmButton').querySelector('span').textContent = '正在更新';
  $('updateProgressWrap').hidden = false;
  $('updateProgressText').textContent = '正在验证补丁并安装，请不要关闭 Launcher…';
  $('updateTitle').textContent = '正在安装更新';
  $('updateText').textContent = '补丁已由玩家确认，正在交给安全更新器处理。';

  try {
    try { localStorage.setItem(pendingVersionKey, latestUpdateState.target_version); } catch (_) {}
    const result = await window.nativeAction('apply-patches',{name:latestUpdateState?.patch_ids?.[0]});
    result.applied = result.applied || ['pending-restart'];
    const applied = Array.isArray(result.applied) ? result.applied : [];
    if (!applied.length) {
      try { localStorage.removeItem(pendingVersionKey); } catch (_) {}
      installingUpdate = false;
      document.body.classList.remove('update-lock');
      $('updateConfirmButton').disabled = false;
      $('updateLaterButton').hidden = false;
      $('updateProgressText').textContent = '没有安装任何补丁；请重新扫描。';
      await refresh();
      await checkForUpdate({ manual: true });
      return;
    }
    $('updateProgressText').textContent = '更新已安装，正在自动关闭并重新启动 Launcher…';
    $('updateConfirmTitle').textContent = '更新完成 · 正在重启';
    $('updateConfirmButton').querySelector('span').textContent = '正在重启';
  } catch (error) {
    try { localStorage.removeItem(pendingVersionKey); } catch (_) {}
    installingUpdate = false;
    document.body.classList.remove('update-lock');
    $('updateLaterButton').hidden = false;
    $('updateConfirmButton').disabled = false;
    $('updateConfirmButton').querySelector('span').textContent = '重新尝试';
    $('updateProgressText').textContent = '更新失败：' + error.message;
    $('updateTitle').textContent = '更新没有完成';
    $('updateText').textContent = '游戏文件未确认更新成功，可以重新尝试。';
  }
}

async function refresh() {
  try {
    const status = await api('/api/status');
    let gameDisplayVersion = 'Game Beta v4';
    let installedVersion = '';
    try {
      const response = await fetch('/game/version.json', { cache: 'no-store' });
      if (response.ok) {
        const gameVersion = await response.json();
        if (/^Game Beta v4(?:\.\d+\.\d+)?$/.test(gameVersion.display_version || '')) gameDisplayVersion = gameVersion.display_version;
        if (/^4\.\d+\.\d+$/.test(gameVersion.version || '')) installedVersion = gameVersion.version;
      }
    } catch (_) { /* Keep the bundled display version if metadata cannot be read. */ }
    $('gameVersion').textContent = gameDisplayVersion;
    $('releaseVersion').textContent = installedVersion ? `当前安装 · v${installedVersion}` : '暂时无法读取安装版本';
    $('launcherRelease').textContent = installedVersion ? `GAME · v${installedVersion}` : '落仙 · 启程';
    const bad = Array.isArray(status.bad_files) ? status.bad_files.length : 0;
    let pendingVersion = '';
    try { pendingVersion = localStorage.getItem(pendingVersionKey) || ''; } catch (_) {}
    if (status.healthy && installedVersion && pendingVersion === installedVersion) {
      $('updateSuccess').textContent = `更新成功 · 当前版本 v${installedVersion}，游戏文件已校验完整。`;
      $('updateSuccess').hidden = false;
      try { localStorage.removeItem(pendingVersionKey); } catch (_) {}
    }
    $('healthText').innerHTML = status.healthy
      ? '<i></i>游戏文件完整'
      : `<i></i>发现 ${bad} 个文件需要修复`;
    $('healthText').className = 'health ' + (status.healthy ? 'good' : 'bad');
    if (!installingUpdate && !latestUpdateState?.available) {
      $('updateTitle').textContent = status.healthy ? '游戏已就绪' : '建议先修复游戏';
      $('updateText').textContent = status.healthy
        ? '山海已就绪。开启独立游戏窗口，启动器会自动最小化。'
        : '修复会恢复当前游戏文件；存档与 Key 保留。';
    }
  } catch (error) {
    $('healthText').innerHTML = '<i></i>启动器服务检查失败';
    $('healthText').className = 'health bad';
    $('updateTitle').textContent = '需要诊断';
    $('updateText').textContent = error.message;
  }
}

function installPetals() {
  const root = $('petals');
  root.replaceChildren();
  const compact = matchMedia('(max-width: 900px)').matches;
  const count = lowSpecUI ? 10 : (compact ? 18 : 34);
  for (let i = 0; i < count; i += 1) {
    const petal = document.createElement('i');
    petal.className = 'petal';
    petal.style.left = ((i * 41 + 7) % 103) + '%';
    petal.style.setProperty('--dur', (9 + (i % 8) * 1.45) + 's');
    petal.style.setProperty('--delay', (-(i % 13) * .92) + 's');
    petal.style.setProperty('--drift', (42 + (i % 7) * 20) + 'px');
    petal.style.transform = `scale(${.58 + (i % 5) * .12})`;
    root.append(petal);
  }
}

function installParallax() {
  const photo = $('launcherPhoto');
  if (!photo || lowSpecUI || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let raf = 0;
  addEventListener('pointermove', (event) => {
    cancelAnimationFrame(raf);
    const x = (event.clientX / innerWidth - .5) * 10;
    const y = (event.clientY / innerHeight - .5) * 7;
    raf = requestAnimationFrame(() => {
      photo.style.transform = `scale(1.055) translate(${-x}px,${-y}px)`;
    });
  }, { passive: true });
  addEventListener('pointerleave', () => {
    photo.style.transform = '';
  }, { passive: true });
}

$('startButton').addEventListener('click', async () => {
  $('startButton').disabled = true;
  try {
    if (window.lxNative) await window.nativeAction('launch-game');
    else {const child=window.open('/game/v4/','luoxian-game');if(!child)throw new Error('请允许游戏窗口弹出，或使用 LuoXian.exe');}
  } catch(error) {say('启动失败：'+error.message);} finally {$('startButton').disabled=false;}
});

$('checkButton').addEventListener('click', async () => {
  say('正在扫描 Patches…');
  await checkForUpdate({ manual: true, forceOffer: true });
});

$('updateLaterButton').addEventListener('click', () => {
  if (installingUpdate) return;
  snoozedUpdateKey = updateKey(latestUpdateState);
  setUpdateModal(false);
  say('本次先不更新；下次启动 Launcher 会再次提醒');
});

$('updateConfirmButton').addEventListener('click', applyConfirmedUpdate);

$('updateConfirmLayer').addEventListener('click', (event) => {
  if (event.target !== $('updateConfirmLayer') || installingUpdate) return;
  snoozedUpdateKey = updateKey(latestUpdateState);
  setUpdateModal(false);
});

$('repairButton').addEventListener('click', async () => {
  try {
    say('正在核验并修复…');
    const result = await api('/api/repair', { method: 'POST' });
    await refresh();
    say(result.healthy ? '修复完成 · 游戏文件完整' : '修复完成 · 请再次检查');
  } catch (error) {
    say('修复失败：' + error.message);
  }
});

$('updatesButton').addEventListener('click', async () => {
  try {
    await window.nativeAction('open-patches');
    say('已打开 Patches');
  } catch (error) {
    say(error.message);
  }
});

$('saveButton').addEventListener('click', async () => {
  try {
    if (!window.lxNative) throw new Error('请从 LuoXian.exe 打开本地数据目录');
    await window.nativeAction('open-save');
    say('已打开 v3 数据目录；请在游戏设置 → 叙事中导出可搬迁的命簿');
  } catch (error) {
    say(error.message);
  }
});

$('gameFolderHint').addEventListener('click', () => {
  $('modelPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

$('modelRefreshButton').addEventListener('click', refreshModels);
$('modelBundledButton').addEventListener('click', async () => {
  try { await window.nativeAction('model-bundled'); $('modelProgress').textContent = '已恢复随包模型；下次进入游戏生效。'; await refreshModels(); }
  catch (error) { $('modelProgress').textContent = error.message; }
});
$('modelCustomButton').addEventListener('click', async () => {
  try { const result = await window.nativeAction('model-custom'); $('modelProgress').textContent = result?.selected ? '自选模型已配置；下次进入游戏生效。' : '没有选择模型。'; await refreshModels(); }
  catch (error) { $('modelProgress').textContent = error.message; }
});

$('aiHintButton').addEventListener('click',async()=>{try{if(window.lxNative)await window.nativeAction('launch-game',{settings:true});else window.open('/game/v4/?settings=1','luoxian-game');}catch(error){say(error.message);}});

for (const button of document.querySelectorAll('[data-scroll]')) {
  button.addEventListener('click', () => {
    $(button.dataset.scroll)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}


for (const button of document.querySelectorAll('[data-native-action]')) {
  button.addEventListener('click', async () => {
    const action = button.dataset.nativeAction;
    if (typeof window.nativeAction === 'function') {
      try { await window.nativeAction(action); } catch (error) { say(error.message); }
      return;
    }
    if (action === 'close') window.close();
    else if (action === 'minimize') say('浏览器后备模式不支持原生最小化按钮');
    else if (action === 'maximize') say('浏览器后备模式可使用系统窗口按钮最大化');
  });
}

async function bootLauncher() {
  installPetals();
  installParallax();
  await refresh();
  await refreshModels();

  // The window is already rendered at this point. Detection is read-only and
  // may only open a confirmation dialog; it can never install by itself.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await checkForUpdate();
    if (latestUpdateState) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }

  setInterval(refresh, 30000);
  setInterval(refreshModels, 30000);
  setInterval(() => checkForUpdate(), 30000);
}

bootLauncher();
