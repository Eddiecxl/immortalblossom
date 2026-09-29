import { createGameState } from './game-state.js';
import { characterProfile } from './character-profile.js';
import { ADVANCE_INPUT, initializeOpening } from './play-contract.js';
import { buildLiveScene } from './scene-view.js';
import { feedbackForTurn, createCultivationFeedback } from './cultivation-feedback.js';
import {
  ACHIEVEMENTS, ENDINGS, ITEMS, LOCATIONS, NPCS, QUESTS, REALMS, TECHNIQUES,
  dispatchLocalChoice, getAvailableActions, getLocalPanelActions
} from './game-engine.js';
import { createStorage } from './storage.js';
import { createTranscriptStore } from './transcript-store.js';
import { createAiClient, modelsForProvider, PROVIDERS } from './ai-client.js';
import { personalGroqRecoveryDraft, recoveryActionFor } from './ai-recovery.js';
import { createAiTurnRunner } from './ai-turn.js';
import { createHeroArt, createScenePresentation } from './scene-art.js';
import { classifyTurn } from './turn-router.js';
import {
  derivedPlayerStats, EQUIPMENT_SLOT_ORDER, commitAiEquipmentForActiveJourney, restoreAiEquipmentState
} from './equipment.js';
import {
  buildCharacterView, buildCodexView, buildHistoryView, buildInventoryView, buildMapView, buildQuestView
} from './panel-view.js';
import { LOCATION_EXITS } from './game-data.js';

const byId = (id) => document.getElementById(id);
const dom = Object.fromEntries([
  'cover', 'game', 'characterName', 'newV13Button', 'continueV13Button', 'newAiButton', 'continueAiButton',
  'titleAiSettingsButton', 'legacyCard', 'legacyText', 'legacyAiButton', 'titleButton',
  'statusName', 'statusRealm', 'statusHp', 'statusQi', 'statusSpirit', 'statusGold', 'statusLocation', 'statusMode',
  'hpBar', 'qiBar', 'spiritBar', 'modeBadge', 'actLabel', 'dayLabel', 'pauseBadge', 'storyLog', 'pendingIndicator',
  'localActions', 'aiComposer', 'worldChannel', 'systemChannel', 'aiInputForm', 'playerInput', 'sendButton',
  'composerHint', 'retryPanel', 'retryMessage', 'retryButton', 'switchProviderButton', 'editRetryButton',
  'aiStageGrid', 'systemCompanionPanel', 'systemMessages', 'systemInputForm', 'systemInput', 'systemSendButton', 'systemCharge',
  'sceneStatusPanel', 'sceneStatusLocation', 'sceneStatusWeather', 'sceneStatusTime', 'sceneStatusExits', 'scenePresenceList',
  'retryTitleButton', 'panelLayer', 'panelTitle', 'panelTabs', 'panelContent', 'saveLayer', 'saveButton',
  'saveModeNote', 'saveSlots', 'exportButton', 'importButton', 'importInput', 'aiLayer', 'aiButton', 'providerSelect',
  'credentialField', 'credentialSelect', 'keyField', 'apiKeyInput', 'baseField', 'baseUrlInput', 'modelInput', 'modelOptions',
  'providerTip', 'connectionStatus', 'clearCredentialButton', 'testAiButton', 'saveAiButton', 'trialPrompt',
  'trialProviderA', 'trialProviderB', 'runTrialButton', 'trialResults', 'endingCard', 'endingTitle', 'endingText',
  'newGamePlusButton', 'breakthrough', 'breakthroughRealm', 'toast', 'petalField'
].map((id) => [id, byId(id)]));

const ACT_TITLES = ['', '第一幕 · 尘缘初醒', '第二幕 · 山门风云', '第三幕 · 青岚遗境', '第四幕 · 金丹劫火', '第五幕 · 问天渡劫'];
const LOCAL_OPENING = [
  { type: 'narr', text: '潮湿柴草扎着掌心。你从一场不属于自己的噩梦里睁开眼，门外雨声正紧。' },
  { type: 'dlg', name: '林小满', text: '里面的人还活着吗？赵天霸带人过来了！' },
  { type: 'sys', text: '本地版只接受下方选项。所有剧情均来自固定本地内容，不会连接 AI。' }
];

const storage = createStorage();
const transcriptStore = createTranscriptStore();
const aiClient = createAiClient();
const aiRunner = createAiTurnRunner({ aiClient, transcriptStore, stateStore: storage });
const updateScene = createScenePresentation(byId('sceneStage'));

let state = null;
let mode = null;
const isOnlineMode = (value = mode) => ['ai', 'v13'].includes(value);
let channel = 'world';
let activePanel = 'character';
let historyVisible = 30;
let pending = false;
let equipmentPending = false;
let retryContext = null;
let aiSettings = aiClient.loadSettings();
const runtimeKeys = new Map();
let editingProvider = '';
let retryTicker = null;
let toastTimer;
let activeRequest = null;
let storyFrame = 0;
let queuedSystemRevealText = '';
let readingDelay = 42;
let revealEpoch = 0;
let revealPending = 0;
try { const savedSpeed = localStorage.getItem('wanxiang-reading-speed'); if (['0', '22', '42', '65'].includes(savedSpeed)) readingDelay = Number(savedSpeed); } catch {}
const revealQueues = { story: Promise.resolve(), system: Promise.resolve() };
let motionOff = false;
const cultivationFeedback = createCultivationFeedback({
  overlay: dom.breakthrough, title: byId('breakthroughTitle'), detail: dom.breakthroughRealm,
  stage: byId('sceneStage'), notify: showToast,
  reduced: () => motionOff || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches
});
let followStory = true;
const scrollStory = () => { if (followStory) dom.storyLog.scrollTop = dom.storyLog.scrollHeight; };
dom.storyLog.addEventListener('wheel', () => { followStory = false; }, { passive: true });
dom.storyLog.addEventListener('touchstart', () => { followStory = false; }, { passive: true });
dom.storyLog.addEventListener('pointerdown', () => { followStory = false; });
dom.storyLog.addEventListener('scroll', () => {
  if (dom.storyLog.scrollHeight - dom.storyLog.scrollTop - dom.storyLog.clientHeight < 12) followStory = true;
}, { passive: true });
try { motionOff = localStorage.getItem('luoying-reduce-motion') === 'true'; } catch {}
function syncMotion() {
  document.body.classList.toggle('reduce-motion', motionOff);
  if (motionOff) cultivationFeedback.clear();
  byId('motionToggle').textContent = `动态：${motionOff ? '关' : '开'}`;
  byId('motionToggle').setAttribute('aria-pressed', String(motionOff));
}
syncMotion();
byId('motionToggle').addEventListener('click', () => {
  motionOff = !motionOff; syncMotion();
  try { localStorage.setItem('luoying-reduce-motion', String(motionOff)); } catch {}
});
byId('cancelAiButton').addEventListener('click', () => activeRequest?.controller.abort());
document.addEventListener('visibilitychange', () => document.body.classList.toggle('page-inactive', document.hidden));

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function showToast(message) {
  clearTimeout(toastTimer);
  dom.toast.textContent = String(message);
  dom.toast.hidden = false;
  toastTimer = setTimeout(() => { dom.toast.hidden = true; }, 3200);
}

function spawnPetals() {
  const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduced) return;
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < 18; index += 1) {
    const petal = node('i', 'petal');
    petal.style.left = `${(index * 37) % 100}%`;
    petal.style.setProperty('--size', `${7 + (index % 6)}px`);
    petal.style.setProperty('--opacity', `${0.3 + (index % 5) * 0.1}`);
    petal.style.setProperty('--duration', `${10 + (index % 7)}s`);
    petal.style.setProperty('--delay', `${-(index % 11)}s`);
    petal.style.setProperty('--sway', `${20 + (index % 5) * 13}px`);
    fragment.append(petal);
  }
  dom.petalField.append(fragment);
}

function revealPacedText(text, value, paced = false, lane = 'story') {
  const content = String(value || '');
  const reduced = motionOff || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!paced || reduced || !content || readingDelay === 0) {
    text.textContent = content;
    return;
  }
  const characters = [...content];
  const epoch = revealEpoch;
  revealPending++;
  byId('advanceButton').disabled = true;
  text.textContent = '';
  const animate = () => new Promise((resolve) => {
    let cursor = 0;
    let previous = 0, elapsed = 0;
    const finish = () => { revealPending = Math.max(0, revealPending - 1); byId('advanceButton').disabled = pending || revealPending > 0; text.closest('.blk')?.classList.remove('is-revealing'); resolve(); };
    const reveal = (timestamp) => {
      if (!text.isConnected) { finish(); return; }
      if (epoch !== revealEpoch || readingDelay === 0) { text.textContent = content; finish(); return; }
      elapsed += previous ? Math.min(100, timestamp - previous) : readingDelay;
      previous = timestamp;
      const count = Math.min(3, Math.floor(elapsed / readingDelay));
      elapsed -= count * readingDelay;
      text.textContent += characters.slice(cursor, cursor + count).join('');
      cursor += count;
      if (lane === 'system') dom.systemMessages.scrollTop = dom.systemMessages.scrollHeight;
      else scrollStory();
      if (cursor < characters.length) requestAnimationFrame(reveal);
      else {
        finish();
      }
    };
    requestAnimationFrame(reveal);
  });
  revealQueues[lane] = revealQueues[lane].then(animate, animate);
}

function appendStoryBlock(block, { paced = false } = {}) {
  if (isOnlineMode() && block?.type === 'sys') return;
  const type = ['narr', 'dlg', 'sys', 'player'].includes(block?.type) ? block.type : 'narr';
  const animate = paced && readingDelay > 0 && !motionOff && !globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const article = node('article', `blk ${type}${animate ? ' is-revealing' : ''}`);
  const name = block?.name || (type === 'sys' ? '系统' : type === 'player' ? state?.player?.name || '你' : '');
  if (name) article.append(node('span', 'tag', name));
  const text = node('div', 'txt');
  revealPacedText(text, block?.text, paced);
  article.append(text);
  dom.storyLog.append(article);
  while (dom.storyLog.children.length > 160) dom.storyLog.firstElementChild.remove();
  cancelAnimationFrame(storyFrame);
  storyFrame = requestAnimationFrame(scrollStory);
}

function appendTurnToStory(turn, options = {}) {
  if (isOnlineMode() && turn?.kind === 'system') return;
  if (turn?.userText) appendStoryBlock({ type: 'player', text: turn.userText }, options);
  for (const block of turn?.blocks || []) appendStoryBlock(block, options);
}

async function renderTranscript() {
  dom.storyLog.replaceChildren();
  const turns = await transcriptStore.recentTurns(state.journeyId, 24);
  if (turns.length === 24) {
    const earlier = node('button', 'earlier-history', '更早的经历 · 打开完整历史');
    earlier.addEventListener('click', () => openPanel('history'));
    dom.storyLog.append(earlier);
  }
  for (const turn of turns) appendTurnToStory(turn);
  return turns;
}

function updatePauseBadge() {
  const modalOpen = !dom.panelLayer.hidden || !dom.saveLayer.hidden || !dom.aiLayer.hidden;
  const paused = modalOpen || (isOnlineMode() && (document.activeElement === dom.systemInput || activeRequest?.kind === 'runSystem'));
  dom.pauseBadge.hidden = !paused;
  document.body.classList.toggle('world-paused', paused);
}

function renderTopbar() {
  if (!state) return;
  updateScene(state);
  const realm = REALMS[state.player.realm] || REALMS[0];
  const derived = derivedPlayerStats(state);
  const displayedLocation = isOnlineMode() ? state.worldState?.sceneLabel || state.story.location : state.story.location;
  dom.statusName.textContent = state.player.name;
  dom.statusRealm.textContent = realm.name;
  dom.statusHp.textContent = `${state.player.hp}/${state.player.maxHp}`;
  dom.statusQi.textContent = `${state.player.qi}/${realm.need}`;
  dom.statusSpirit.textContent = `${state.player.spirit}/${derived.maxSpirit}`;
  dom.statusGold.textContent = String(state.player.gold);
  dom.statusLocation.textContent = displayedLocation;
  dom.statusMode.textContent = `${mode === 'v13' ? 'v13.5 本地线上' : '云端线上'} · ${PROVIDERS[aiSettings.provider]?.label || '未设置'}`;
  dom.modeBadge.classList.toggle('ai-mode', isOnlineMode());
  dom.hpBar.style.width = `${Math.max(0, Math.min(100, state.player.hp / state.player.maxHp * 100))}%`;
  dom.qiBar.style.width = `${Math.max(0, Math.min(100, state.player.qi / realm.need * 100))}%`;
  dom.spiritBar.style.width = `${Math.max(0, Math.min(100, state.player.spirit / derived.maxSpirit * 100))}%`;
  dom.actLabel.textContent = ACT_TITLES[state.story.act] || `第 ${state.story.act} 幕`;
  dom.dayLabel.textContent = `第 ${state.story.day} 日 · ${state.story.period}`;
  renderAiLivePanels();
}

function sceneActor(id) {
  if (id === 'unknown:scene') return { name: '身份未知', role: '气息难辨', description: '对方尚未表明身份。' };
  const authored = Object.entries(NPCS).find(([, npc]) => npc.id === id);
  if (authored) return { name: authored[0], role: authored[1].role, description: authored[1].description };
  const remembered = state?.memory?.entities?.[id];
  return remembered ? { name: remembered.name, role: remembered.purpose || '来意未明', description: (remembered.traits || []).join(' · ') || '现场人物' }
    : { name: '身份未知', role: '气息难辨', description: '只留下了无法辨认的痕迹。' };
}

function renderAiLivePanels() {
  if (!state || !isOnlineMode()) return;
  const world = state.worldState || {};
  const companion = state.systemCompanion || {};
  const displayedLocation = isOnlineMode() ? state.worldState?.sceneLabel || state.story.location : state.story.location;
  dom.systemMessages.replaceChildren();
  const exchanges = Array.isArray(companion.dialogueMemory) ? companion.dialogueMemory.slice(-6) : [];
  if (!exchanges.length) dom.systemMessages.append(node('p', 'system-empty', '内心私语 · 在这里与系统交流，外界时间不会流动。'));
  for (const [index, exchange] of exchanges.entries()) {
    const message = node('article', `system-message ${exchange.role === 'player' ? 'from-player' : 'from-system'}`);
    message.append(node('small', '', exchange.role === 'player' ? state.player.name : '系统'));
    const messageText = node('p');
    const revealNewest = index === exchanges.length - 1 && exchange.role === 'system'
      && exchange.text === queuedSystemRevealText;
    revealPacedText(messageText, exchange.text, revealNewest, 'system');
    message.append(messageText);
    dom.systemMessages.append(message);
  }
  queuedSystemRevealText = '';
  dom.systemCharge.textContent = `言出法随 · 因果负担 ${state.journeyWorld.lawDebt || 0}`;
  dom.sceneStatusLocation.textContent = displayedLocation;
  dom.sceneStatusWeather.textContent = world.weather || '天候未明';
  dom.sceneStatusTime.textContent = `第 ${state.story.day} 日 · ${state.story.period}`;
  dom.sceneStatusExits.textContent = (LOCATION_EXITS[state.story.location] || []).filter(name => state.codex.locations.includes(name)).join(' · ') || '暂未探明';
  dom.scenePresenceList.replaceChildren();
  const ids = world.presentActorIds || [];
  if (!ids.length) dom.scenePresenceList.append(node('li', 'scene-empty', '此处暂时没有可辨认的旁人。'));
  for (const id of ids) {
    const actor = sceneActor(id);
    const item = node('li');
    const heading = node('strong', '', actor.name);
    const profile = characterProfile(state, actor.name);
    const role = node('span', '', `此刻在场 · ${profile.realm}`);
    item.append(heading, role, node('small', '', [profile.core, profile.mood, profile.condition, profile.relationship, profile.lastEvent].filter(Boolean).join(' · ')));
    dom.scenePresenceList.append(item);
  }
  const view = buildLiveScene(state);
  byId('sceneDetail').hidden = !view.visible;
  byId('sceneAction').replaceChildren();
  if (view.action) byId('sceneAction').append(node('small', '', view.action.input), node('p', '', view.action.result));
  else byId('sceneAction').append(node('p', '', '世界停在此刻，等你写下第一个行动。'));
  byId('sceneGoal').textContent = view.goal;
  const renderList = (id, entries, empty) => {
    const list = byId(id); list.replaceChildren();
    for (const entry of entries) { const row = node('li'); row.append(node('strong', '', entry.title), node('small', '', entry.detail)); list.append(row); }
    if (!entries.length) list.append(node('li', 'scene-empty', empty));
  };
  renderList('sceneTasks', view.tasks, '还没有接下新的约定。');
  renderList('sceneClues', view.clues.map(title => ({ title, detail: '来自已发生的剧情' })), '线索会随亲历逐渐显现。');
  renderList('sceneSkills', view.skills, '尚未习得功法。');
  renderList('sceneLaws', view.laws.map(l => ({ title: `已实现 · ${l.request}`, detail: l.cost })), '此世还未动用言灵。');
  byId('lawDebt').textContent = `因果负担 · ${view.debt}${view.debt ? '（休整可减轻）' : '（神魂安稳）'}`;
}

function setPending(value) {
  pending = value;
  dom.pendingIndicator.hidden = !value;
  dom.sendButton.disabled = value;
  byId('advanceButton').disabled = value || revealPending > 0;
  // Keep typing responsive while the previous action is being resolved.
  dom.playerInput.disabled = false;
  dom.systemSendButton.disabled = value;
  for (const button of dom.localActions.querySelectorAll('button')) button.disabled = value;
  syncEquipmentControls();
}

function renderLocalChoices() {
  dom.localActions.replaceChildren();
  if (!state || mode !== 'local') return;
  for (const action of getAvailableActions(state)) {
    const button = node('button');
    button.type = 'button';
    button.dataset.choiceId = action.id;
    button.append(node('span', '', action.icon), document.createTextNode(action.label));
    button.addEventListener('click', () => runLocalChoice(action.id, action.label));
    dom.localActions.append(button);
  }
}

function renderModeControls() {
  dom.localActions.hidden = true;
  dom.aiComposer.hidden = !isOnlineMode();
  dom.aiStageGrid.classList.toggle('ai-active', isOnlineMode());
  dom.systemCompanionPanel.hidden = !isOnlineMode();
  dom.sceneStatusPanel.hidden = !isOnlineMode();
  dom.aiButton.hidden = false;
  renderAiLivePanels();
  updateChannelUi();
}

function equipmentUnavailable() {
  return pending || equipmentPending || Boolean(state?.battle);
}

function syncEquipmentControls() {
  for (const button of dom.panelContent.querySelectorAll('[data-equipment-item]')) button.disabled = equipmentUnavailable();
}

function setEquipmentPending(value) {
  equipmentPending = value;
  syncEquipmentControls();
}

function updateChannelUi() {
  const system = channel === 'system';
  dom.worldChannel.classList.toggle('active', !system);
  dom.systemChannel.classList.toggle('active', system);
  dom.worldChannel.setAttribute('aria-selected', String(!system));
  dom.systemChannel.setAttribute('aria-selected', String(system));
  dom.playerInput.placeholder = system ? '系统私语请用左侧输入框……' : '说什么、做什么，都可以直接写……';
  dom.composerHint.textContent = system ? '系统私语已移至左侧；世界时间会保持停止。' : '行动会推动世界；AI 失败时世界原样不动。';
  updatePauseBadge();
}

function showBreakthrough(previousRealm) {
  if (state.player.realm <= previousRealm) return;
  cultivationFeedback.play({ kind: 'breakthrough', title: '破境', detail: REALMS[state.player.realm]?.name || '' });
}

function showEnding(ending) {
  if (!ending) return;
  dom.endingTitle.textContent = ending.title;
  dom.endingText.textContent = ending.description;
  dom.endingCard.hidden = false;
}

async function runLocalChoice(choiceId, label) {
  if (pending || mode !== 'local') return;
  const previousRealm = state.player.realm;
  const result = dispatchLocalChoice(state, choiceId);
  if (!result.autosave) {
    showToast(result.blocks?.[0]?.text || '这个选择当前不可用。');
    return;
  }
  state = result.state;
  storage.saveAuto('local', state);
  const turn = {
    id: `local-${Date.now()}-${state.stats.turns}`,
    kind: 'world', userText: label,
    blocks: result.blocks,
    createdAt: new Date().toISOString()
  };
  await transcriptStore.appendTurn(state.journeyId, turn);
  appendStoryBlock({ type: 'player', text: label });
  for (const block of result.blocks) appendStoryBlock(block);
  renderTopbar();
  renderLocalChoices();
  showBreakthrough(previousRealm);
  showEnding(result.ending);
}

function showRetry(result, type) {
  retryContext = { type, ...result.retry };
  const recovery = recoveryActionFor(result, aiSettings);
  dom.switchProviderButton.dataset.recoveryKind = recovery.kind;
  dom.switchProviderButton.textContent = recovery.label;
  const message = String(result.error || 'AI 回合失败').replace(/[。.!！]+$/u, '');
  const blocked = ['AI_QUOTA_EXHAUSTED', 'AI_MODEL_UNAVAILABLE', 'AI_AUTH_FAILED', 'AI_NOT_CONFIGURED', 'AI_BAD_REQUEST'].includes(result.code);
  dom.retryMessage.textContent = `${message}。世界仍停在行动前，输入和已保存记忆不变。${blocked ? '请先到 AI 设置处理，重复点击不会解决这个问题。' : ''}`;
  const deadline = Date.now() + (result.retryAfterMs || 0);
  clearInterval(retryTicker);
  const refresh = () => {
    const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    dom.retryButton.disabled = blocked || seconds > 0;
    dom.retryButton.textContent = blocked ? '请先调整 AI 设置' : seconds > 0 ? `额度冷却 · ${seconds} 秒` : '重试本回合';
    if (!seconds) { clearInterval(retryTicker); retryTicker = null; }
  };
  if (result.retryAfterMs) retryTicker = setInterval(refresh, 1000);
  refresh();
  dom.retryPanel.hidden = false;
}

function clearRetry() {
  clearInterval(retryTicker); retryTicker = null;
  dom.retryButton.disabled = false;
  dom.retryButton.textContent = '重试本回合';
  dom.switchProviderButton.dataset.recoveryKind = 'settings';
  dom.switchProviderButton.textContent = '切换模型';
  retryContext = null;
  dom.retryPanel.hidden = true;
}

function currentAiSettings() {
  return { ...aiSettings, key: runtimeKeys.get(aiSettings.provider) || '' };
}

async function requestTurn(kind, input, transactionId) {
  const controller = new AbortController();
  const startedAt = performance.now();
  const request = { controller, stage: 'generating', kind };
  activeRequest = request;
  setPending(true);
  const labels = { generating: '命数推演中', repair: '正在校准剧情', validating: '正在核对此世因果', saving: '正在保存旅程' };
  const refresh = () => {
    if (activeRequest !== request) return;
    const seconds = Math.floor((performance.now() - startedAt) / 1000);
    byId('pendingText').textContent = `${labels[request.stage]} · ${seconds} 秒${seconds >= 12 ? ' · 模型响应较慢' : ''}`;
    byId('cancelAiButton').disabled = request.stage === 'saving';
  };
  refresh();
  const ticker = setInterval(refresh, 1000);
  const deadline = setTimeout(() => controller.abort(new DOMException('Turn deadline', 'TimeoutError')), 45_000);
  try {
    return await aiRunner[kind]({ state, input, transactionId, settings: currentAiSettings(), signal: controller.signal,
      onProgress: (stage) => { request.stage = stage; refresh(); } });
  } catch (error) {
    return { ok: false, error: error.message, retry: { input, transactionId } };
  } finally {
    clearInterval(ticker); clearTimeout(deadline);
    if (activeRequest === request) { activeRequest = null; setPending(false); }
  }
}

async function runAiOpening(transactionId) {
  if (pending || !isOnlineMode()) return;
  const journeyId = state.journeyId;
  clearRetry();
  const result = await requestTurn('runOpening', undefined, transactionId);
  if (dom.game.hidden || !isOnlineMode() || state?.journeyId !== journeyId) return;
  if (!result.ok) {
    showRetry(result, 'opening');
    return;
  }
  state = result.state;
  for (const block of result.blocks) appendStoryBlock(block, { paced: true });
  renderTopbar();
}

async function runAiWorld(input, transactionId) {
  if (pending || !isOnlineMode()) return;
  const before = state;
  const journeyId = state.journeyId;
  clearRetry();
  const result = await requestTurn('runWorld', input, transactionId);
  if (dom.game.hidden || !isOnlineMode() || state?.journeyId !== journeyId) return;
  if (!result.ok) {
    showRetry(result, 'world');
    return;
  }
  state = result.state;
  appendStoryBlock({ type: 'player', text: input }, { paced: true });
  for (const block of result.blocks) appendStoryBlock(block, { paced: true });
  queuedSystemRevealText = result.blocks.filter(block => block.type === 'sys').at(-1)?.text || '';
  if (dom.playerInput.value.trim() === input) dom.playerInput.value = '';
  resizeComposer();
  renderTopbar();
  cultivationFeedback.play(feedbackForTurn(before, state));
}

async function runAiSystem(input) {
  if (pending || !isOnlineMode()) return false;
  const journeyId = state.journeyId;
  clearRetry();
  const result = await requestTurn('runSystem', input);
  if (dom.game.hidden || !isOnlineMode() || state?.journeyId !== journeyId) return false;
  if (!result.ok) {
    showRetry(result, 'system');
    return false;
  }
  state = result.state;
  queuedSystemRevealText = [...(state.systemCompanion?.dialogueMemory || [])]
    .reverse().find(exchange => exchange.role === 'system')?.text || '';
  renderTopbar();
  return true;
}

async function submitAiInput(event) {
  event.preventDefault();
  const input = dom.playerInput.value.trim();
  if (!input) return;
  followStory = true;
  await runAiWorld(input);
}

async function submitSystemCompanion(event) {
  event.preventDefault();
  const input = dom.systemInput.value.trim();
  if (!input) return;
  const completed = await runAiSystem(input);
  if (completed && dom.systemInput.value.trim() === input) dom.systemInput.value = '';
}

async function ensureLocalOpening() {
  const turns = await transcriptStore.allTurns(state.journeyId);
  if (turns.length) return;
  const turn = { id: 'local-opening', kind: 'world', blocks: LOCAL_OPENING, createdAt: new Date().toISOString() };
  await transcriptStore.appendTurn(state.journeyId, turn);
}

async function enterGame(nextState, { skipOpening = false } = {}) {
  activeRequest?.controller.abort();
  state = isOnlineMode(nextState.mode)
    ? await storage.recoverPendingTurn(nextState.mode, nextState, transcriptStore)
    : nextState;
  mode = state.mode;
  channel = 'world';
  clearRetry();
  dom.endingCard.hidden = true;
  dom.cover.hidden = true;
  dom.game.hidden = false;
  const turns = await renderTranscript();
  renderTopbar();
  renderModeControls();
  if (isOnlineMode() && !skipOpening && !turns.some((turn) => turn.kind === 'world')) await runAiOpening();
}

function requestedName() {
  return dom.characterName.value.trim() || '顾长生';
}

async function startNew(modeToStart) {
  try {
    const created = initializeOpening(createGameState(requestedName(), modeToStart));
    storage.saveAuto(modeToStart, created);
    await enterGame(created);
  } catch (error) {
    showToast(error.message);
  }
}

async function continueMode(modeToContinue) {
  const saved = storage.loadAuto(modeToContinue);
  if (!saved) return showToast('这个版本还没有自动存档。');
  await enterGame(saved);
}

function closeAllLayers() {
  dom.panelLayer.hidden = true;
  dom.saveLayer.hidden = true;
  dom.aiLayer.hidden = true;
  updatePauseBadge();
}

function renderTitle() {
  cultivationFeedback.clear();
  activeRequest?.controller.abort();
  activeRequest = null;
  setPending(false);
  closeAllLayers();
  dom.game.hidden = true;
  dom.cover.hidden = false;
  const aiSave = storage.loadAuto('ai');
  const v13Save = storage.loadAuto('v13');
  dom.continueV13Button.hidden = !v13Save;
  dom.continueAiButton.hidden = !aiSave;
  if (v13Save) dom.continueV13Button.textContent = `继续 ${v13Save.player.name} · ${REALMS[v13Save.player.realm].name}`;
  if (aiSave) dom.continueAiButton.textContent = `继续 ${aiSave.player.name} · ${PROVIDERS[aiSettings.provider]?.label || 'AI'}`;
  const legacy = storage.findLegacySave();
  dom.legacyCard.hidden = !legacy;
  if (legacy) dom.legacyText.textContent = `发现旧版存档「${legacy.player.name}」。可复制到一个新版本，原存档不会删除。`;
}

function panelCard(title, lines, className = '') {
  const card = node('section', `panel-card ${className}`.trim());
  card.append(node('h3', '', title));
  for (const line of lines) card.append(node('p', '', line));
  return card;
}

const SLOT_LABELS = Object.freeze({
  head: '头饰', neck: '颈饰', body: '躯干', arms: '护臂', hands: '手持', legs: '腿甲', feet: '鞋履'
});

const statText = (item) => [
  item?.attack ? `攻击加${item.attack}` : '', item?.defense ? `防御加${item.defense}` : '',
  item?.spirit ? `灵力上限加${item.spirit}` : ''
].filter(Boolean).join('，');

function vitalMeter(label, value, max, kind) {
  const meter = node('section', `vital-meter ${kind}`);
  const heading = node('header');
  heading.append(node('span', '', label), node('b', '', `${value}/${max}`));
  const rail = node('div', 'vital-rail');
  const fill = node('i');
  fill.style.width = `${Math.max(0, Math.min(100, Number(value) / Math.max(1, Number(max)) * 100))}%`;
  rail.append(fill);
  meter.append(heading, rail);
  return meter;
}

function attributeTile(label, value, detail) {
  const tile = node('section', 'attribute-tile');
  tile.append(node('small', '', label), node('strong', '', String(value)));
  if (detail) tile.append(node('span', '', detail));
  return tile;
}

function itemsForSlot(stateToRender, slot, equippedName) {
  return buildInventoryView(stateToRender).filter((item) => ITEMS[item.name]?.slot === slot
    && item.amount > 0 && item.name !== equippedName);
}

function equipmentSlot(view, slot) {
  const itemName = view.slots[slot];
  const equipped = itemName ? ITEMS[itemName] : null;
  const replacements = isOnlineMode() ? itemsForSlot(state, slot, itemName) : [];
  const className = `equipment-slot rarity-${equipped?.rarity || 'empty'}`;
  const label = SLOT_LABELS[slot];
  const description = equipped ? `${label}：${itemName}${statText(equipped) ? `，${statText(equipped)}` : ''}` : `${label}：未装备`;
  const element = node('section', className);
  element.dataset.slot = slot;
  element.setAttribute('aria-label', state?.battle ? `${description}。战斗未结束，不能更换装备。` : description);
  element.append(node('small', '', label), node('strong', '', itemName || '未装备'));
  if (equipped && statText(equipped)) element.append(node('span', '', statText(equipped)));
  if (state?.battle) element.append(node('span', 'equip-prompt', '战斗中不可更换'));
  const actions = node('div', 'equipment-replacements');
  for (const replacement of replacements) {
    const button = node('button', 'equip-action', `换上 ${replacement.name}`);
    button.type = 'button';
    button.dataset.equipmentItem = replacement.name;
    button.disabled = equipmentUnavailable();
    button.setAttribute('aria-label', `${label}：装备 ${replacement.name}${statText(replacement) ? `，${statText(replacement)}` : ''}`);
    button.addEventListener('click', () => saveAiEquipment(replacement.name));
    actions.append(button);
  }
  if (replacements.length) element.append(actions);
  return element;
}

function paperDoll(view) {
  const doll = node('section', 'paper-doll');
  doll.setAttribute('aria-label', `${view.name}的七槽装备构筑`);
  const silhouette = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  silhouette.setAttribute('class', 'doll-silhouette');
  silhouette.setAttribute('viewBox', '0 0 220 430');
  silhouette.setAttribute('aria-hidden', 'true');
  for (const d of ['M110 70 L110 6', 'M86 122 L18 122', 'M134 170 L202 170', 'M76 264 L18 264', 'M144 316 L202 316', 'M88 374 L18 404', 'M132 374 L202 404']) {
    const connector = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    connector.setAttribute('class', 'doll-line');
    connector.setAttribute('d', d);
    silhouette.append(connector);
  }
  silhouette.append(...createHeroArt().children);
  doll.append(silhouette);
  for (const slot of EQUIPMENT_SLOT_ORDER) doll.append(equipmentSlot(view, slot));
  return doll;
}

async function saveAiEquipment(itemName) {
  if (pending || equipmentPending || state?.battle) {
    if (state?.battle) showToast('战斗尚未结束，暂不能更换装备。');
    return;
  }
  if (!isOnlineMode() || !state) return;
  const original = state;
  setEquipmentPending(true);
  try {
    const saved = await commitAiEquipmentForActiveJourney(storage, original, itemName, () => state);
    if (!saved) return;
    if (state?.journeyId !== original.journeyId) return;
    state = saved;
    renderTopbar();
    await renderPanel(activePanel);
    showToast(`${itemName}已装备。此操作未推进世界时间。`);
  } catch (error) {
    if (state?.journeyId !== original.journeyId) return;
    state = restoreAiEquipmentState(storage, original);
    showToast(error?.message || '装备没有保存。');
    await renderPanel(activePanel);
  } finally {
    setEquipmentPending(false);
  }
}

function renderLocalCharacterPanel() {
  const grid = node('div', 'panel-grid');
  const realm = REALMS[state.player.realm];
  const derived = derivedPlayerStats(state);
  grid.append(panelCard('道途', [
    `${state.player.name} · ${realm.name}`,
    `气血 ${state.player.hp}/${state.player.maxHp} · 灵气 ${state.player.qi}/${realm.need}`,
    `灵力 ${state.player.spirit}/${derived.maxSpirit} · 灵石 ${state.player.gold}`
  ]));
  grid.append(panelCard('攻守', [
    `攻击 ${derived.attack} · 防御 ${derived.defense}`,
    `武器 ${state.equipment.weapon || '无'} · 护甲 ${state.equipment.armor || '无'} · 配饰 ${state.equipment.accessory || '无'}`
  ]));
  grid.append(panelCard('所学功法', state.techniques.known.map((name) => {
    const art = TECHNIQUES[name];
    return art ? `《${name}》· 灵力 ${art.cost} · ${art.description}` : name;
  }), 'wide'));
  grid.append(panelCard('人物关系', Object.entries(state.relationships).map(([name, value]) => `${name} ${value >= 0 ? '+' : ''}${value}`), 'wide'));
  dom.panelContent.append(grid);
}

function renderCharacterPanel() {
  if (state.mode === 'local') return renderLocalCharacterPanel();
  const view = buildCharacterView(state);
  const sheet = node('div', 'character-sheet');
  const stats = node('aside', 'character-stats');
  stats.append(node('p', 'character-kicker', `${view.name} · ${view.realm}`));
  stats.append(vitalMeter('气血', view.hp, view.maxHp, 'hp'));
  stats.append(vitalMeter('灵气', view.qi, view.qiNeed, 'qi'));
  stats.append(vitalMeter('法术灵力', view.spirit, view.maxSpirit, 'spirit'));
  const attributes = node('div', 'attribute-grid');
  attributes.append(
    attributeTile('攻击', view.stats.attack, '本命与装备'),
    attributeTile('防御', view.stats.defense, '护体与装备'),
    attributeTile('灵石', state.player.gold, '随身财货'),
    attributeTile('游戏日', `第 ${state.story.day} 日`, state.story.period)
  );
  stats.append(attributes);
  sheet.append(stats, paperDoll(view));
  dom.panelContent.append(sheet);

  if (view.techniques.length) {
    const techniques = node('section', 'panel-card technique-card');
    techniques.append(node('h3', '', '所学功法'));
    for (const art of view.techniques) {
      const growth = state.journeyWorld?.skills?.[art.name];
      techniques.append(node('p', '', `《${art.name}》· 灵力 ${art.cost} · ${art.description}`));
      if (growth) techniques.append(node('p', '', `熟练 ${growth.mastery}/100 · ${growth.understanding} · 来源：${growth.source} · 进境：${growth.evolution}`));
    }
    dom.panelContent.append(techniques);
  }
  if (view.relationships.length) {
    const relations = node('section', 'panel-card relationship-section');
    relations.append(node('h3', '', '人物关系'));
    const list = node('div', 'relationship-list');
    for (const person of view.relationships) {
      const card = node('article', 'relationship-card');
      card.append(node('strong', '', person.name), node('span', '', person.role), node('b', '', `${person.value >= 0 ? '+' : ''}${person.value}`));
      const relation = state.relationshipStates?.[person.name];
      if (relation) card.append(node('small', '', `信任 ${relation.trust} · 亲近 ${relation.closeness} · 戒备 ${relation.wariness} · 亏欠 ${relation.debt} · 暧昧 ${relation.affection} · 敌意 ${relation.hostility}`));
      list.append(card);
    }
    relations.append(list);
    dom.panelContent.append(relations);
  } else dom.panelContent.append(panelCard('人物关系', ['旅途尚未留下可辨认的人物记录。']));
}

function renderLocalQuestPanel() {
  if (!state.quests.active.length) dom.panelContent.append(panelCard('暂无进行中任务', ['世界行动会继续牵动主线与支线。'], 'wide'));
  for (const entry of state.quests.active) {
    const quest = QUESTS[entry.id];
    const card = node('section', 'quest-card');
    card.append(node('h3', '', `${quest?.type === 'main' ? '主线' : '支线'} · ${quest?.title || entry.id}`));
    card.append(node('p', '', quest?.description || ''));
    card.append(node('p', '', `进度 ${entry.progress}/${entry.target}`));
    const progress = node('div', 'progress');
    const bar = node('i');
    bar.style.width = `${Math.min(100, entry.progress / entry.target * 100)}%`;
    progress.append(bar);
    card.append(progress);
    dom.panelContent.append(card);
  }
}

function renderQuestPanel() {
  if (state.mode === 'local') return renderLocalQuestPanel();
  const view = buildQuestView(state);
  const labels = { active: '进行中', completed: '已完成', failed: '已失败' };
  for (const [status, entries] of Object.entries(view)) {
    if (!entries.length) continue;
    const section = node('section', 'quest-section');
    section.append(node('h3', '', labels[status]));
    for (const quest of entries) {
      const card = node('article', 'quest-card');
      card.append(node('h4', '', `${quest.type === 'main' ? '主线' : '支线'} · ${quest.title}`), node('p', '', quest.description));
      if (status === 'active') {
        card.append(node('p', '', `进度 ${quest.progress}/${quest.target}`));
        const progress = node('div', 'progress');
        const bar = node('i');
        bar.style.width = `${Math.min(100, quest.progress / quest.target * 100)}%`;
        progress.append(bar);
        card.append(progress);
      }
      section.append(card);
    }
    dom.panelContent.append(section);
  }
  for (const thread of state.journeyWorld?.threads || []) {
    dom.panelContent.append(panelCard(`${thread.kind} · ${thread.title}`, [thread.evidence, thread.status === 'resolved' ? '这段牵挂已有结果' : '仍放在心上']));
  }
  if (!dom.panelContent.childElementCount) dom.panelContent.append(panelCard('暂无任务记录', ['新的因果会在真正发生后留下痕迹。'], 'wide'));
}

function actionButton(action) {
  const button = node('button', '', action.label);
  button.type = 'button';
  button.addEventListener('click', async () => {
    closeAllLayers();
    await runLocalChoice(action.id, action.label);
  });
  return button;
}

function aiEquipmentAction(item) {
  const button = node('button', 'equip-action inventory-equip-action');
  const equipped = buildCharacterView(state).slots[ITEMS[item.name]?.slot] === item.name;
  button.type = 'button';
  button.dataset.equipmentItem = item.name;
  button.disabled = equipmentUnavailable() || equipped;
  button.textContent = equipped ? '已装备' : `装备 · ${SLOT_LABELS[ITEMS[item.name]?.slot] || '法器'}`;
  button.setAttribute('aria-label', equipped ? `${item.name}已装备` : `装备${item.name}${statText(ITEMS[item.name]) ? `，${statText(ITEMS[item.name])}` : ''}`);
  button.addEventListener('click', () => saveAiEquipment(item.name));
  return button;
}

function renderLocalInventoryPanel() {
  const grid = node('div', 'inventory-grid');
  const actions = getLocalPanelActions(state, 'inventory');
  for (const [name, amount] of Object.entries(state.inventory.items).filter(([, count]) => count > 0)) {
    const item = ITEMS[name];
    const card = node('section', 'inventory-card');
    const heading = node('header');
    heading.append(node('h3', '', name), node('b', '', `×${amount}`));
    card.append(heading, node('p', '', item?.description || '尚未录入图鉴。'));
    const action = actions.find((candidate) => candidate.id.endsWith(`:${name}`));
    if (action) card.append(actionButton(action));
    grid.append(card);
  }
  if (!grid.childElementCount) grid.append(panelCard('背包为空', ['有些因果无法装进储物袋。']));
  dom.panelContent.append(grid);
  const recipes = getLocalPanelActions(state, 'alchemy');
  const alchemy = panelCard('可炼丹方', recipes.length ? ['材料已齐，可以开炉。'] : ['回春丹：止血草×2、凝露花×1；聚气丹：凝露花×2、赤焰果×1。']);
  for (const recipe of recipes) alchemy.append(actionButton(recipe));
  dom.panelContent.append(alchemy);
}

function renderInventoryPanel() {
  if (state.mode === 'local') return renderLocalInventoryPanel();
  const grid = node('div', 'inventory-grid');
  for (const item of buildInventoryView(state)) {
    const { name, amount } = item;
    const card = node('section', 'inventory-card');
    const heading = node('header');
    heading.append(node('h3', '', name), node('b', '', `×${amount}`));
    card.append(heading, node('p', '', item.description));
    if (isOnlineMode() && ITEMS[name]?.slot) card.append(aiEquipmentAction(item));
    grid.append(card);
  }
  if (!grid.childElementCount) grid.append(panelCard('背包为空', ['有些因果无法装进储物袋。']));
  dom.panelContent.append(grid);
}

function renderLocalMapPanel() {
  const grid = node('div', 'map-grid');
  const actions = getLocalPanelActions(state, 'travel');
  for (const [name, location] of Object.entries(LOCATIONS)) {
    const unlocked = state.story.act >= location.act && state.player.realm >= location.realm;
    const card = node('section', `map-card${unlocked ? '' : ' locked'}`);
    card.append(node('h3', '', `${location.icon} ${name}${name === state.story.location ? ' · 当前' : ''}`));
    card.append(node('p', '', unlocked ? location.description : `需要第 ${location.act} 幕、${REALMS[location.realm].name}`));
    const action = actions.find((candidate) => candidate.id === `travel:${name}`);
    if (action) card.append(actionButton(action));
    grid.append(card);
  }
  dom.panelContent.append(grid);
}

function renderMapPanel() {
  if (state.mode === 'local') return renderLocalMapPanel();
  const grid = node('div', 'map-grid');
  for (const location of buildMapView(state)) {
    const card = node('section', 'map-card');
    card.append(node('h3', '', `${location.icon} ${location.name}${location.current ? ' · 当前' : ''}`));
    card.append(node('p', '', location.description));
    grid.append(card);
  }
  dom.panelContent.append(grid);
}

function renderLocalCodexPanel() {
  const grid = node('div', 'codex-grid');
  grid.append(panelCard('人物', state.codex.characters.length ? state.codex.characters.map((name) => `${name} · ${NPCS[name]?.role || '旅途相逢'}`) : ['尚未结识']));
  grid.append(panelCard('地点', state.codex.locations.length ? state.codex.locations : ['尚未踏足']));
  grid.append(panelCard('物品', state.codex.items.length ? state.codex.items : ['尚无记录']));
  grid.append(panelCard('成就', state.achievements.unlocked.length
    ? state.achievements.unlocked.map((id) => ACHIEVEMENTS[id]?.title || id)
    : [`0/${Object.keys(ACHIEVEMENTS).length} · 尚待落笔`]));
  grid.append(panelCard('结局', state.endings.unlocked.length
    ? state.endings.unlocked.map((id) => ENDINGS[id]?.title || id)
    : ['五种结局仍藏在命数之后']), 'wide');
  dom.panelContent.append(grid);
}

function renderCodexPanel() {
  if (state.mode === 'local') return renderLocalCodexPanel();
  const view = buildCodexView(state);
  const grid = node('div', 'codex-grid');
  const sections = [
    ['人物', view.characters.length ? view.characters.map((entry) => `${entry.name} · ${entry.role}`) : ['尚未结识可辨认人物。']],
    ['地点', view.locations.length ? view.locations.map((entry) => entry.name) : ['尚未踏足可辨认地点。']],
    ['物品', view.items.length ? view.items.map((entry) => `${entry.name} · ${entry.description}`) : ['尚无已知物品。']],
    ['成就', view.achievements.length ? view.achievements.map((entry) => `${entry.title} · ${entry.description}`) : ['尚无已记录成就。']],
    ['结局', view.endings.length ? view.endings.map((entry) => `${entry.title} · ${entry.description}`) : ['尚无已知结局。']]
  ];
  for (const [title, lines] of sections) grid.append(panelCard(title, lines));
  dom.panelContent.append(grid);
}

async function renderLocalHistoryPanel() {
  const marker = node('p', 'modal-note', '正在翻阅完整命簿……');
  dom.panelContent.append(marker);
  const turns = await transcriptStore.allTurns(state.journeyId);
  marker.remove();
  const shown = turns.slice(-historyVisible);
  if (!shown.length) return dom.panelContent.append(panelCard('尚无记录', ['成功的回合才会写进这里。失败的 AI 请求不会留下半句。']));
  if (turns.length > historyVisible) {
    const more = node('button', 'secondary-button small', `加载更早记录（尚有 ${turns.length - historyVisible} 回合）`);
    more.addEventListener('click', () => { historyVisible += 30; renderPanel('history'); });
    dom.panelContent.append(more);
  }
  for (const turn of shown) {
    const card = node('section', 'panel-card wide');
    card.append(node('h3', '', `${turn.kind === 'system' ? '时停问答' : '世界回合'} · ${turn.provider || '本地'}`));
    if (turn.userText) card.append(node('p', '', `你：${turn.userText}`));
    for (const block of turn.blocks || []) card.append(node('p', '', `${block.name ? `${block.name}：` : ''}${block.text}`));
    dom.panelContent.append(card);
  }
}

async function renderHistoryPanel() {
  if (state.mode === 'local') return renderLocalHistoryPanel();
  const marker = node('p', 'modal-note', '正在翻阅完整命簿……');
  dom.panelContent.append(marker);
  const turns = await transcriptStore.allTurns(state.journeyId);
  marker.remove();
  const shown = turns.slice(-historyVisible);
  const history = buildHistoryView(state);
  if (!shown.length && !history.summaries.length && !history.facts.length) return dom.panelContent.append(panelCard('尚无记录', ['成功的回合才会写进这里。失败的 AI 请求不会留下半句。']));
  if (history.summaries.length || history.facts.length) {
    const traces = node('section', 'panel-card history-traces');
    traces.append(node('h3', '', '已知脉络'));
    for (const line of [...history.summaries, ...history.facts]) traces.append(node('p', '', String(line)));
    dom.panelContent.append(traces);
  }
  if (turns.length > historyVisible) {
    const more = node('button', 'secondary-button small', `加载更早记录（尚有 ${turns.length - historyVisible} 回合）`);
    more.addEventListener('click', () => { historyVisible += 30; renderPanel('history'); });
    dom.panelContent.append(more);
  }
  for (const turn of shown) {
    const card = node('section', 'panel-card wide');
    card.append(node('h3', '', `${turn.kind === 'system' ? '时停问答' : '世界回合'} · ${turn.provider || 'AI'}`));
    if (turn.userText) card.append(node('p', '', `你：${turn.userText}`));
    for (const block of turn.blocks || []) card.append(node('p', '', `${block.name ? `${block.name}：` : ''}${block.text}`));
    dom.panelContent.append(card);
  }
}

async function renderPanel(tab = activePanel) {
  activePanel = tab;
  dom.panelContent.replaceChildren();
  for (const button of dom.panelTabs.querySelectorAll('button')) button.classList.toggle('active', button.dataset.tab === tab);
  const titles = { character: '人物', quests: '任务', inventory: '背包', map: '地图', codex: '图鉴', history: '完整历史' };
  dom.panelTitle.textContent = titles[tab] || '命簿';
  if (tab === 'character') renderCharacterPanel();
  else if (tab === 'quests') renderQuestPanel();
  else if (tab === 'inventory') renderInventoryPanel();
  else if (tab === 'map') renderMapPanel();
  else if (tab === 'codex') renderCodexPanel();
  else await renderHistoryPanel();
}

async function openPanel(tab) {
  if (!state) return;
  if (tab === 'history' && activePanel !== 'history') historyVisible = 30;
  dom.panelLayer.hidden = false;
  updatePauseBadge();
  await renderPanel(tab);
}

function renderSaveDialog() {
  dom.saveModeNote.textContent = `当前只显示并操作「${mode === 'v13' ? 'v13.5 本地线上' : '云端线上'}」存档，另一版本不会被覆盖。`;
  dom.saveSlots.replaceChildren();
  for (let number = 1; number <= 3; number += 1) {
    const slot = `slot${number}`;
    const meta = storage.getSlotMeta(mode, slot);
    const card = node('section', 'save-slot');
    const header = node('header');
    header.append(node('h3', '', `命簿 ${number}`), node('span', '', meta ? (meta.mode === 'v13' ? 'v13.5' : '云端') : '空白'));
    card.append(header, node('p', '', meta
      ? `${meta.name} · ${REALMS[meta.realm]?.name || '凡人'} · 第${meta.act}幕 · ${meta.location} · 第${meta.day}日\n${new Date(meta.savedAt).toLocaleString()}`
      : '这一页尚未落笔。'));
    const actions = node('div', 'slot-actions');
    const save = node('button', '', meta ? '覆盖保存' : '保存');
    save.addEventListener('click', async () => {
      save.disabled = true;
      try {
        await storage.saveJourneySlot(mode, slot, state, transcriptStore);
        renderSaveDialog();
        showToast(`已保存到命簿 ${number}`);
      } catch (error) {
        save.disabled = false;
        showToast(`保存失败：${error.message}`);
      }
    });
    actions.append(save);
    if (meta) {
      const load = node('button', '', '读取');
      load.addEventListener('click', async () => {
        try {
          const loaded = storage.activateSlotAsAuto(mode, slot);
          closeAllLayers();
          await enterGame(loaded, { skipOpening: true });
        } catch (error) { showToast(`读取失败：${error.message}`); }
      });
      const remove = node('button', 'danger', '删除');
      remove.addEventListener('click', async () => {
        if (globalThis.confirm?.(`删除命簿 ${number}？自动存档不会删除。`)) {
          try {
            await storage.deleteJourneySlot(mode, slot, transcriptStore);
            renderSaveDialog();
          } catch (error) { showToast(`删除失败：${error.message}`); }
        }
      });
      actions.append(load, remove);
    }
    card.append(actions);
    dom.saveSlots.append(card);
  }
}

function openSaveDialog() {
  if (!state) return;
  renderSaveDialog();
  dom.saveLayer.hidden = false;
  updatePauseBadge();
}

function populateProviderSelect(select, selected) {
  select.replaceChildren();
  const recommended = node('optgroup');
  recommended.label = '推荐';
  const advanced = node('optgroup');
  advanced.label = '高级 / 测试';
  for (const [id, provider] of Object.entries(PROVIDERS)) {
    const option = node('option', '', provider.label);
    option.value = id;
    option.selected = id === selected;
    if (provider.recommended) recommended.append(option);
    else advanced.append(option);
  }
  select.append(recommended, advanced);
}

function syncAiFields(resetModel = false) {
  const id = dom.providerSelect.value;
  const provider = PROVIDERS[id];
  const none = provider.credentialMode === 'none';
  const siteCapable = provider.siteCapable;
  if (resetModel && editingProvider && editingProvider !== id) {
    runtimeKeys.set(editingProvider, dom.apiKeyInput.value.trim());
    dom.apiKeyInput.value = runtimeKeys.get(id) || '';
    dom.credentialSelect.value = provider.credentialMode;
  }
  editingProvider = id;
  if (!siteCapable && !none) dom.credentialSelect.value = 'personal';
  dom.credentialSelect.querySelector('option[value="site"]').disabled = !siteCapable;
  dom.credentialField.hidden = none;
  dom.keyField.hidden = none || dom.credentialSelect.value !== 'personal';
  dom.baseField.hidden = false;
  dom.baseUrlInput.readOnly = id !== 'custom';
  if (resetModel) dom.modelInput.value = provider.model;
  dom.modelOptions.replaceChildren(...modelsForProvider(id).map((model) => {
    const option = document.createElement('option');
    option.value = model;
    return option;
  }));
  const siteMode = siteCapable && dom.credentialSelect.value === 'site';
  dom.modelInput.disabled = false;
  dom.modelInput.title = siteMode
    ? `网站模式可切换允许的模型：${(provider.models || [provider.model]).join('、')}`
    : '';
  dom.baseUrlInput.value = id === 'custom' ? (resetModel ? '' : aiSettings.baseUrl || dom.baseUrlInput.value) : provider.baseUrl || '';
  dom.providerTip.textContent = `${provider.tip}${siteMode ? ' 网站模式可切换允许的模型。' : ' 官方地址已填好，只需填写 Key 和模型。'}${id === 'groq' ? ' Qwen 3.8 优先第一人称、兼容完整第三人称，使用精简上下文和单次生成以减少免费额度消耗。' : id === 'gemini' ? ' 使用 Google 原生接口，模型路径由游戏自动补全。' : ''}`;
}

function openAiDialog() {
  populateProviderSelect(dom.providerSelect, aiSettings.provider);
  dom.credentialSelect.value = aiSettings.credentialMode;
  dom.apiKeyInput.value = runtimeKeys.get(aiSettings.provider) || '';
  editingProvider = aiSettings.provider;
  dom.modelInput.value = aiSettings.model || PROVIDERS[aiSettings.provider]?.model || '';
  populateProviderSelect(dom.trialProviderA, 'groq');
  populateProviderSelect(dom.trialProviderB, 'mistral');
  dom.connectionStatus.textContent = '';
  syncAiFields();
  dom.aiLayer.hidden = false;
  updatePauseBadge();
}

function collectAiSettings() {
  return {
    provider: dom.providerSelect.value,
    credentialMode: dom.credentialSelect.value,
    key: dom.apiKeyInput.value.trim(),
    baseUrl: dom.baseUrlInput.value.trim(),
    model: dom.modelInput.value.trim()
  };
}

function saveAiSettings() {
  const collected = collectAiSettings();
  const siteModels = collected.credentialMode === 'site' ? modelsForProvider(collected.provider) : [];
  if (siteModels.length && !siteModels.includes(collected.model)) {
    dom.connectionStatus.textContent = '这个模型不在网站允许列表中，请从模型建议中选择。';
    return;
  }
  runtimeKeys.set(collected.provider, collected.key);
  aiSettings = aiClient.saveSettings(collected);
  // A newly selected provider/key may have independent quota; the client still
  // enforces any existing cooldown for the exact credential/model combination.
  clearInterval(retryTicker); retryTicker = null;
  dom.retryButton.disabled = false;
  dom.retryButton.textContent = '用当前设置重试';
  renderTopbar();
  dom.connectionStatus.textContent = '已保存。下一次 AI 请求立即使用这个提供商；当前旅程与记忆保持不变。';
  showToast('AI 模型已切换');
}

async function testAiConnection() {
  dom.connectionStatus.textContent = '正在消耗 1 次请求测试连接……';
  dom.testAiButton.disabled = true;
  try {
    const result = await aiClient.testConnection(collectAiSettings());
    dom.connectionStatus.textContent = result.message;
  } catch (error) {
    dom.connectionStatus.textContent = `连接失败：${error.message}`;
  } finally {
    dom.testAiButton.disabled = false;
  }
}

function settingsForTrial(providerId) {
  const provider = PROVIDERS[providerId];
  const same = providerId === dom.providerSelect.value;
  return {
    provider: providerId,
    credentialMode: same ? dom.credentialSelect.value : provider.credentialMode,
    key: same ? dom.apiKeyInput.value.trim() : runtimeKeys.get(providerId) || '',
    model: same ? dom.modelInput.value.trim() : provider.model,
    baseUrl: provider.baseUrl || ''
  };
}

function renderTrialResult(providerId, result) {
  const card = node('article', 'trial-result');
  card.append(node('h4', '', PROVIDERS[providerId]?.label || providerId));
  const badges = node('div', 'trial-badges');
  for (const [label, passed] of [['JSON', result.parsePassed], ['推进', result.progressPassed]]) {
    badges.append(node('span', passed ? '' : 'bad', `${label} ${passed ? '通过' : '失败'}`));
  }
  badges.append(node('span', '', `${result.latencyMs}ms`), node('span', result.repetitionScore > .35 ? 'bad' : '', `重复 ${result.repetitionScore}`));
  const output = node('pre');
  output.textContent = result.output || result.error || '没有输出';
  const score = node('label', 'fun-score');
  score.append(document.createTextNode('好玩度 1'));
  const input = document.createElement('input');
  input.type = 'range'; input.min = '1'; input.max = '5'; input.value = '3';
  score.append(input, document.createTextNode('5'));
  card.append(badges, output, score);
  return card;
}

async function runTrials() {
  const first = dom.trialProviderA.value;
  const second = dom.trialProviderB.value;
  dom.trialResults.replaceChildren(node('p', 'modal-note', '两个模型正在独立答题，各消耗 1 次请求……'));
  dom.runTrialButton.disabled = true;
  const [a, b] = await Promise.all([
    aiRunner.runTrial({ settings: settingsForTrial(first), trial: dom.trialPrompt.value }),
    aiRunner.runTrial({ settings: settingsForTrial(second), trial: dom.trialPrompt.value })
  ]);
  dom.runTrialButton.disabled = false;
  dom.trialResults.replaceChildren(renderTrialResult(first, a), renderTrialResult(second, b));
}

function resizeComposer() {
  dom.playerInput.style.height = '48px';
  dom.playerInput.style.height = `${Math.min(128, Math.max(48, dom.playerInput.scrollHeight))}px`;
}

async function importLegacy(targetMode) {
  try {
    const imported = storage.importLegacy(targetMode);
    await transcriptStore.appendTurn(imported.journeyId, {
      id: 'legacy-import', kind: 'system',
      blocks: [{ type: 'sys', text: `旧版旅程已复制到${targetMode === 'ai' ? ' AI 版' : '本地版'}；旧存档仍安全保留。` }],
      createdAt: new Date().toISOString()
    });
    await enterGame(imported, { skipOpening: true });
  } catch (error) {
    showToast(error.message);
  }
}

dom.newV13Button.addEventListener('click', () => { window.location.href = './v4/'; });
dom.newAiButton.addEventListener('click', () => startNew('ai'));
dom.continueV13Button.addEventListener('click', () => continueMode('v13'));
dom.continueAiButton.addEventListener('click', () => continueMode('ai'));
dom.titleAiSettingsButton.addEventListener('click', openAiDialog);
dom.legacyAiButton.addEventListener('click', () => importLegacy('ai'));
dom.titleButton.addEventListener('click', renderTitle);
dom.worldChannel.addEventListener('click', () => { channel = 'world'; updateChannelUi(); dom.playerInput.focus(); });
dom.systemChannel.addEventListener('click', () => { channel = 'system'; updateChannelUi(); dom.playerInput.focus(); });
dom.aiInputForm.addEventListener('submit', submitAiInput);
byId('readingSpeed').value = String(readingDelay);
byId('readingSpeed').addEventListener('change', event => {
  readingDelay = Number(event.target.value);
  try { localStorage.setItem('wanxiang-reading-speed', String(readingDelay)); } catch {}
});
byId('revealAllButton').addEventListener('click', () => { revealEpoch++; });
byId('advanceButton').addEventListener('click', async () => {
  if (pending || revealPending) return;
  const draft = dom.playerInput.value;
  await runAiWorld(ADVANCE_INPUT);
  if (dom.playerInput.value === ADVANCE_INPUT) dom.playerInput.value = draft;
});
dom.systemInputForm.addEventListener('submit', submitSystemCompanion);
dom.playerInput.addEventListener('input', resizeComposer);
dom.retryButton.addEventListener('click', () => {
  if (!retryContext) return;
  if (retryContext.type === 'opening') runAiOpening(retryContext.transactionId);
  else if (retryContext.type === 'world') runAiWorld(retryContext.input, retryContext.transactionId);
  else runAiSystem(retryContext.input);
});
dom.switchProviderButton.addEventListener('click', () => {
  const usePersonalGroq = dom.switchProviderButton.dataset.recoveryKind === 'personal-groq';
  openAiDialog();
  if (!usePersonalGroq) return;
  const draft = personalGroqRecoveryDraft(runtimeKeys.get('groq'));
  dom.providerSelect.value = draft.provider;
  // Run the normal provider transition first: it moves the old provider's
  // value back to its own runtime slot and replaces the field with Groq's.
  syncAiFields(true);
  dom.credentialSelect.value = draft.credentialMode;
  dom.modelInput.value = draft.model;
  dom.apiKeyInput.value = draft.key;
  syncAiFields();
  dom.connectionStatus.textContent = '网站共用 Groq 额度正在冷却。填入你自己的 Groq Key 后保存；它只留在本页运行内存，不会写入存档。';
  dom.apiKeyInput.focus();
});
dom.editRetryButton.addEventListener('click', () => {
  dom.retryPanel.hidden = true;
  if (retryContext?.type === 'system') { dom.systemInput.value = retryContext.input || dom.systemInput.value; dom.systemInput.focus(); return; }
  dom.playerInput.value = retryContext?.input || dom.playerInput.value;
  resizeComposer(); dom.playerInput.focus();
});
dom.retryTitleButton.addEventListener('click', renderTitle);
dom.saveButton.addEventListener('click', openSaveDialog);
dom.aiButton.addEventListener('click', openAiDialog);
dom.providerSelect.addEventListener('change', () => { syncAiFields(true); });
dom.credentialSelect.addEventListener('change', () => syncAiFields());
dom.saveAiButton.addEventListener('click', saveAiSettings);
dom.testAiButton.addEventListener('click', testAiConnection);
dom.clearCredentialButton.addEventListener('click', () => {
  runtimeKeys.clear();
  dom.apiKeyInput.value = '';
  localStorage.removeItem('luoying_ai_v3');
  aiSettings = aiClient.loadSettings();
  dom.connectionStatus.textContent = '游戏 AI 设置与本页个人 Key 已清除；网站共享额度与游戏存档不会受影响。';
});
dom.runTrialButton.addEventListener('click', runTrials);
dom.newGamePlusButton.addEventListener('click', renderTitle);

for (const button of document.querySelectorAll('[data-open-panel]')) button.addEventListener('click', () => openPanel(button.dataset.openPanel));
for (const button of dom.panelTabs.querySelectorAll('[data-tab]')) button.addEventListener('click', () => renderPanel(button.dataset.tab));
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => {
  const layer = button.dataset.close === 'panel' ? dom.panelLayer : button.dataset.close === 'save' ? dom.saveLayer : dom.aiLayer;
  layer.hidden = true;
  updatePauseBadge();
});
for (const layer of [dom.panelLayer, dom.saveLayer, dom.aiLayer]) layer.addEventListener('click', (event) => {
  if (event.target === layer) { layer.hidden = true; updatePauseBadge(); }
});

dom.exportButton.addEventListener('click', async () => {
  try {
    const blob = await storage.exportJourney(mode, state, transcriptStore);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `落樱仙途-${mode}-${state.player.name}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { showToast(error.message); }
});
dom.importButton.addEventListener('click', () => dom.importInput.click());
dom.importInput.addEventListener('change', async () => {
  const file = dom.importInput.files?.[0];
  if (!file) return;
  try {
    const imported = await storage.importJourney(mode, file, transcriptStore);
    closeAllLayers();
    await enterGame(imported, { skipOpening: true });
    showToast('旅程与完整文字记录已导入');
  } catch (error) { showToast(error.message); }
  finally { dom.importInput.value = ''; }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeAllLayers();
  const target = event.target;
  if (event.key !== 'Enter' || event.isComposing || !isOnlineMode() || dom.game.hidden
    || ![dom.playerInput, dom.systemInput].includes(target)) return;
  event.preventDefault();
  if (event.ctrlKey || event.metaKey || event.shiftKey) {
    target.setRangeText('\n', target.selectionStart, target.selectionEnd, 'end');
    target.dispatchEvent(new Event('input'));
  } else if (!pending) (target === dom.systemInput ? dom.systemInputForm : dom.aiInputForm).requestSubmit();
});
dom.systemInput.addEventListener('focus', updatePauseBadge);
dom.systemInput.addEventListener('blur', updatePauseBadge);

spawnPetals();
renderTitle();
