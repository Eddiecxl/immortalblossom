import {createSaveSession} from '../beta4/save-session.js';
import {createAstraOpening} from '../astra-opening.js';
import {realmLabel} from '../astra-rules.js';
import {recentEchoSummary} from '../turn-summary.js';
import {createTurnFlow} from '../turn-flow.js';
import {campaignGuidance} from '../campaign.js';
import {createSaveUI} from '../beta4/save-ui.js';
import { ensureV31Canon, v31Snapshot } from '../v4-engine.js';
import { QUESTS, NPCS, LOCATIONS, getAvailableActions } from '../game-engine.js';
import { createGameState } from '../game-state.js';
import { createStorage } from '../storage.js';
import { createTranscriptStore } from '../transcript-store.js';
import { createAiTurnRunner } from '../ai-turn.js';
import { createV31HybridClient, V31_PROVIDER_DEFAULTS } from '../v4-hybrid-client.js';
import { normalizePlayerTurnInput, playerTurnIsEmpty, serializePlayerTurn, playerTurnDisplay } from '../player-turn.js';
import { inventoryRows, questRows, characterRows } from '../beta4/rpg-view.js';
import { commitInventoryAction } from '../beta4/inventory-command.js';
import { createExperience } from '../beta4/experience.js';
const $ = (id) => document.getElementById(id);

const dom = Object.fromEntries([
  'titleScreen','gameShell','newJourneyButton','continueJourneyButton','sceneTitle','playerName','realmValue','hpValue','hpBar',
  'spiritValue','spiritBar','qiValue','goldValue','timeValue','lawCount','systemLine','locationValue','weatherValue','turnValue',
  'dangerText','dangerBar','storyLocation','scenePeriod','sceneWeather','sceneThreat','storyScroll','suggestionStrip','composer',
  'speechInput','actionInput','sendButton','questHeadline','questDetail','characterChips','memoryPreview','echoList','saveButton','titleButton',
  'exitGameButton','systemChatButton','systemChatLayer','systemInput','systemChatResponse','sendSystemButton','closeSystemChat','systemFeed','systemDockInput','systemDockSend','audioButton',
  'lawInvokeButton','lawLayer','lawInput','lawCostHint','lawSubmitButton','lawCloseButton','lawCancelButton',
  'toast','worldDrawer','drawerBackdrop','drawerTitle','drawerContent','closeDrawer','petalField','worldImage'
].map(id => [id, $(id)]));

const stateStore = createStorage();
const transcriptStore = createTranscriptStore();
const aiClient = createV31HybridClient();
const aiRunner = createAiTurnRunner({ aiClient, transcriptStore, stateStore });

let state = null;
let transcript = [];
let systemTranscript=[];
let activeDrawer = 'world';
let toastTimer;
const cpuCores = Number(navigator.hardwareConcurrency || 8);
const deviceRam = Number(navigator.deviceMemory || 0);
const lowSpecUI = cpuCores <= 8 || (deviceRam > 0 && deviceRam <= 8);
if (lowSpecUI) document.documentElement.classList.add('low-spec-ui');
let turnBusy = false;
const turnFlow = createTurnFlow({ cooldownMs: 1500 });
let menuBusy = false;
let experience;let saveUI;
const saveSession=createSaveSession({stateStore,transcriptStore});
const audioEngine = {unlock:()=>experience?.audio.unlock(),sfx:(...args)=>experience?.audio.sfx(...args),setIntensity:(...args)=>experience?.audio.setIntensity(...args),isEnabled:()=>experience?.audio.isEnabled()??true,setEnabled:(v)=>experience?.audio.setEnabled(v)};

function safeLoad() {
  try {
    const loaded = saveSession.peek();
    if (!loaded) return null;
    const clean = ensureV31Canon(loaded, 'ai');
    const snap = v31Snapshot(clean);
    return snap?.player?.name ? clean : null;
  } catch {
    return null;
  }
}

async function loadTranscript(journeyId) {
  try {
    const turns = await transcriptStore.allTurns(journeyId);
    systemTranscript=systemArchive(turns);
    transcript = turns.slice(-240).filter(turn => turn.kind !== 'system').map(turn => ({
      input: turn.userText || '',
      speech: turn.speech || '',
      action: turn.actionText || '',
      blocks: turn.blocks || [],
      summary: turn.summary || '',
      at: turn.createdAt || '',
      turn: 0,
      provider: turn.provider || '',
      model: turn.model || ''
    }));
  } catch {
    transcript = [];
  }
}

function persist() {
  if (!state) return;
  state = stateStore.saveAuto('ai', ensureV31Canon(state, 'ai')) || state;
}

function runnerSettings() {
  const settings = aiClient.loadSettings();
  const mode = settings.mode || 'local';
  const profileProvider = mode === 'auto-stable'
    ? (settings.preferred || 'groq')
    : mode === 'hybrid-assist' ? 'local' : mode;
  return {
    ...settings,
    provider: profileProvider,
    model: settings.models?.[profileProvider] || V31_PROVIDER_DEFAULTS[profileProvider]?.model || '',
    journeyId: state?.journeyId || ''
  };
}

function showToast(message) {
  clearTimeout(toastTimer);
  dom.toast.textContent = message;
  dom.toast.hidden = false;
  toastTimer = setTimeout(() => { dom.toast.hidden = true; }, 1800);
}

function absoluteMinutes(value) {
  return (Number(value.story.day || 1) - 1) * 1440 + Number(value.story.minuteOfDay || 0);
}

function formatClock(value) {
  const minute = Number(value.story.minuteOfDay || 0);
  const h = String(Math.floor(minute / 60)).padStart(2, '0');
  const m = String(minute % 60).padStart(2, '0');
  return `第 ${value.story.day} 日 · ${value.story.period} · ${h}:${m}`;
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function appendBlock(block, { player = false, animate = true } = {}) {
  const wrap = node('article', `story-block ${player ? 'player' : block.type || 'narr'}`);
  if (!animate) wrap.style.animation = 'none';
  if (player) {
    wrap.textContent = block.text;
  } else if (block.type === 'dlg') {
    wrap.append(node('b', '', block.name || '身份未知'), node('p', '', block.text));
  } else {
    wrap.textContent = block.text;
  }
  dom.storyScroll.append(wrap);
}

function appendPlayerTurn(turn, { animate = true } = {}) {
  const normalized = normalizePlayerTurnInput({
    speech: turn?.speech || '',
    action: turn?.action || ''
  });
  const rows = playerTurnDisplay(normalized);
  if (!rows.length && turn?.input) {
    appendBlock({ type: 'player', text: turn.input }, { player: true, animate });
    return;
  }
  const wrap = node('article', 'story-block player player-turn-block');
  if (!animate) wrap.style.animation = 'none';
  for (const row of rows) {
    const line = node('div', 'player-turn-line ' + row.kind);
    line.append(node('b', '', row.label), node('span', '', row.text));
    wrap.append(line);
  }
  dom.storyScroll.append(wrap);
}

function rebuildStory() {
  experience.clear();
  const opening = dom.storyScroll.querySelector('.story-opening');
  dom.storyScroll.replaceChildren();
  if (opening && !transcript.length) {opening.textContent=`你身在${state.story.location}。此生命簿已接续，请沿眼前目标继续。`;dom.storyScroll.append(opening);}
  for (const turn of transcript.slice(-60)) {
    experience.renderBlocks(turn.blocks || [], turn.speech, {animate:false});
  }
  dom.storyScroll.scrollTop = dom.storyScroll.scrollHeight;
}

function renderSuggestions(suggestions = []) {
  dom.suggestionStrip.replaceChildren();
  if (state.astraWorld && !state.astraWorld.flags?.legacyMigration) {
    const world = state.astraWorld;
    const roads = world.edges.filter(edge => edge.from === world.player.locationId && !edge.closed && !world.locations[edge.to]?.destroyed)
      .slice(0, 3).map(edge => ({ label: `前往${world.locations[edge.to].name}`, command: `前往${world.locations[edge.to].name}` }));
    suggestions = [
      { label: '观察周围', command: '观察周围的人和道路' },
      { label: '打听消息', command: '向在场的人打听最近的消息' },
      ...roads,
      { label: '等待片刻', command: '在此等待一小时' }
    ];
  } else suggestions=state.campaign?.status==='active'?[...campaignGuidance(state).options,...suggestions]:[];
  for (const suggestion of suggestions.slice(0, 7)) {
    const button = node('button', '', suggestion.label || suggestion.command || '行动');
    button.type = 'button';
    button.addEventListener('click', () => {
      dom.actionInput.value = suggestion.command || suggestion.label || '';
      const details = document.getElementById('actionDetails');
      if (details) details.open = true;
      dom.actionInput.focus();
    });
    dom.suggestionStrip.append(button);
  }
}

function activeQuest() {
  if (state.astraWorld && !state.astraWorld.flags?.legacyMigration) {
    const quest = Object.values(state.astraWorld.quests || {}).find(entry => ['active','accepted'].includes(entry.state));
    if (quest) return { quest: { title: quest.title || quest.name || '眼前之事', description: quest.summary || quest.objective || '此事会随世界时间变化。' } };
    return { quest: { title: '此世由你起笔', description: '世间人物各有去处，机缘与危机按时发生。先观察、交谈，或自行上路。' } };
  }
  const first=questRows(state).find(q=>q.status==='进行中');if(first)return {quest:first};const thread=(state.journeyWorld?.threads||[]).find(t=>!['resolved','completed','failed','closed'].includes(t.status));if(thread)return {quest:{title:thread.title,description:thread.evidence||'沿着此事留下的线索继续。'}};
  if (state.story.location.includes('赵府')) return { quest: { title: '柴门之外', description: '离开赵府，救下被牵连的人，并找到真正进入修行世界的路。' } };
  return { quest: { title: '此世未完', description: '世界会根据行动、人物、线索与时间继续产生后果。' } };
}

function renderHud() {
  const snap = v31Snapshot(state);
  dom.gameShell.dataset.scene = state.astraWorld ? 'world' : state.story.location.includes('柴房') ? 'woodshed' : 'world';
  dom.playerName.textContent = snap.player.name;
  dom.realmValue.textContent = state.astraWorld?.player?.cultivation?.realm
    ? realmLabel(state.astraWorld, state.astraWorld.player.cultivation.realm) : snap.player.realm;
  dom.hpValue.textContent = `${state.player.hp} / ${state.player.maxHp}`;
  dom.spiritValue.textContent = `${state.player.spirit} / ${state.player.maxSpirit}`;
  dom.qiValue.textContent = String(state.player.qi);
  dom.goldValue.textContent = String(state.player.gold);
  const dead = Boolean(state.story.flags?.playerDead || state.astraWorld?.terminal?.ended || state.astraWorld?.player?.alive === false)
    || (!state.astraWorld && state.campaign?.status==='complete');
  dom.hpBar.style.width = dead ? '0%' : `${Math.max(2, state.player.hp / state.player.maxHp * 100)}%`;
  dom.spiritBar.style.width = `${Math.max(2, state.player.spirit / state.player.maxSpirit * 100)}%`;
  dom.timeValue.textContent = formatClock(state);
  dom.sceneTitle.textContent = state.story.location;
  dom.storyLocation.textContent = state.story.location;
  dom.locationValue.textContent = state.story.location;
  dom.scenePeriod.textContent = formatClock(state);
  dom.weatherValue.textContent = state.worldState.weather || '未知';
  dom.sceneWeather.textContent = state.worldState.weather || '未知';
  dom.turnValue.textContent = String(state.memory.turnCount || 0);
  dom.lawCount.textContent = `已兑现 ${state.journeyWorld?.laws?.length || 0} 条`;

  const danger = state.astraWorld ? Math.ceil(Number(state.astraWorld.locations?.[state.astraWorld.player.locationId]?.risk || 0) / 25)
    : Number(state.director?.dangerClocks?.zhaoPursuit || 0);
  const arrived = !state.astraWorld && Boolean(state.story.flags?.zhaoPursuitArrived);
  dom.dangerBar.style.width = `${Math.min(100, danger / 4 * 100)}%`;
  dom.dangerText.textContent = state.astraWorld ? `当地风险 ${state.astraWorld.locations?.[state.astraWorld.player.locationId]?.risk || 0}/100`
    : arrived ? '已经抵达' : danger >= 3 ? '近在咫尺' : danger >= 2 ? '正在逼近' : danger ? '已有动静' : '尚未逼近';
  dom.sceneThreat.textContent = dead ? '命途已断' : state.astraWorld ? '世界自行运转中'
    : arrived ? '追兵已至' : danger >= 2 ? '危机逼近' : '局势流动中';
  const locked = turnFlow.state() !== 'idle';
  dom.sendButton.disabled = dead || locked;
  dom.speechInput.disabled = dead || (locked && turnFlow.state() !== 'cooldown');
  dom.actionInput.disabled = dead || (locked && turnFlow.state() !== 'cooldown');

  const guidance = state.astraWorld && !state.astraWorld.flags?.legacyMigration
    ? { title: activeQuest().quest.title, objective: activeQuest().quest.description, why: '' }
    : campaignGuidance(state);
  dom.questHeadline.textContent = guidance.title;
  dom.questDetail.textContent = `${guidance.objective}　${guidance.why}`;
  dom.characterChips.replaceChildren();
  const known = state.codex.characters?.slice(-5) || [];
  if (!known.length) dom.characterChips.append(node('span', '', '尚未确认'));
  for (const name of known) dom.characterChips.append(node('span', '', name));

  const recent = (state.memory.facts || []).slice().reverse().find(f => f.predicate === 'turn-outcome' || f.predicate === 'moved');
  dom.memoryPreview.textContent = recent?.object || (state.astraWorld
    ? `此世始于${state.story.location}；人物、时辰与因果均在命簿中持续记录。`
    : '醒来于赵府柴房；前世记忆、系统与言出法随均已记录。');
}

function renderEchoes() {
  dom.echoList.replaceChildren();
  const turns = transcript.slice(-6).reverse();
  if (!turns.length) turns.push({ input: '此世开始', at: '第 1 日 · 清晨' });
  for (const turn of turns) {
    const li = node('li');
    li.append(node('i'));
    li.append(node('p', '', recentEchoSummary(turn)));
    li.append(node('small', '', turn.at || '已记录'));
    dom.echoList.append(li);
  }
}

function ledgerSection(title, rows) {
  const section = node('section', 'ledger-section');
  section.append(node('h3', '', title));
  for (const [label, value] of rows) {
    const row = node('div', 'ledger-row');
    row.append(node('span', '', label), node('b', '', String(value)));
    section.append(row);
  }
  return section;
}

function renderDrawer(tab = activeDrawer) {
  activeDrawer = tab;
  for (const button of document.querySelectorAll('[data-drawer-tab]')) button.classList.toggle('active', button.dataset.drawerTab === tab);
  dom.drawerContent.replaceChildren();
  const snap = v31Snapshot(state);

  if (tab === 'world') {
    dom.drawerTitle.textContent = '世界脉络';
    dom.drawerContent.append(
      ledgerSection('此刻', [
        ['地点', state.story.location], ['天时', formatClock(state)], ['天气', state.worldState.weather || '未知'],
        ['回合', state.memory.turnCount], ['世界分钟', absoluteMinutes(state)]
      ]),
      ledgerSection('规则锚点', [
        ['来历', '带着前世记忆穿越而来'], ['系统', '规则层持续存在'], ['言出法随', `已兑现 ${snap.laws.length} 条`],
        ['叙事原则', '游戏状态优先，叙事不得覆盖事实']
      ]),
      ledgerSection('危险', Object.entries(snap.threats).map(([key, value]) => [key, value]))
    );
  } else if (tab === 'inventory') {
    dom.drawerTitle.textContent='乾坤行囊';
    dom.drawerContent.append(node('p','local-ledger-note','持有物品与护命规则保存在命簿。翻阅不请求 AI；使用或装备会立即结算。'));
    const rows=inventoryRows(state);
    if(!rows.length)dom.drawerContent.append(ledgerSection('行囊空空',[['此刻','尚无持有物品']]));
    for(const item of rows){
      const details=[['数量',item.amount],['作用',item.description]];
      if(item.asset){details.push(['护命余次',item.asset.charges??0]);const source=item.asset.provenance?.source||item.asset.provenance?.sourceId||item.asset.sourceId; if(source)details.push(['来历',source]);}
      const card=ledgerSection(item.name,details);
      if(item.usable||item.equippable){const controls=node('div','item-controls');const button=node('button','',item.equippable?'装备':'使用');button.type='button';button.dataset.inventoryAction=item.equippable?'equip':'use';button.dataset.itemName=item.name;button.disabled=turnBusy||experience.isWriting()||Boolean(state.story.flags?.playerDead)||state.campaign?.status==='complete';button.addEventListener('click',()=>applyInventoryAction(item.name,button.dataset.inventoryAction));controls.append(button);card.append(controls);}
      dom.drawerContent.append(card);
    }
    for(const asset of Object.values(state.rpg?.assets||{}).filter(a=>a.kind==='skill'||a.kind==='system'))dom.drawerContent.append(ledgerSection(asset.name,[['类别',asset.kind==='skill'?'保命技能':'系统护佑'],['余次',asset.charges],['规则',asset.description||'致命时自动判定']]));
  } else if (tab === 'causality') {
    dom.drawerTitle.textContent='因果命簿';
    const entries=[...(state.rpg?.ledger||[])].reverse();
    dom.drawerContent.append(node('p','local-ledger-note','这里记录实际结算的获得、消耗与生死因果。过去获得的护命能力不会因为聊天记录变长而失效。'));
    if(!entries.length)dom.drawerContent.append(ledgerSection('尚无结算',[['此世','重要物品与生死事件将在这里留痕']]));
    for(const event of entries.slice(0,100))dom.drawerContent.append(ledgerSection(event.name||({death:'此世归寂',revival:'绝境逢生',acquired:'因缘所得',consumed:'物品消耗'}[event.kind]||'因果落定'),[['经过',event.text||event.cause||event.kind],['回合',event.turn??'已记录'],...(event.chargesRemaining!==undefined?[['剩余次数',event.chargesRemaining]]:[])]));
  } else if (tab === 'character') {
    dom.drawerTitle.textContent = '人物与修行';const mine=characterRows(state);dom.drawerContent.append(ledgerSection(state.player.name,[['境界',mine.realm],['气血',state.player.hp+' / '+state.player.maxHp],['灵力',state.player.spirit+' / '+state.player.maxSpirit],['灵石',state.player.gold],['装备',mine.equipment.map(([,v])=>Array.isArray(v)?v.join('、'):v).join('、')||'无']]));for(const tech of mine.techniques)dom.drawerContent.append(ledgerSection(tech.name,[['功法',tech.description],['状态',tech.equipped?'已装配':'已习得']]));
    const names = snap.knownCharacters.length ? snap.knownCharacters : state.astraWorld ? [] : ['林小满'];
    for (const name of names) {
      const relation = state.relationshipStates?.[name] || {};
      const entity = Object.values(state.memory.entities || {}).find(e => e.name === name);
      dom.drawerContent.append(ledgerSection(name, [
        ['身份', NPCS[name]?.role || entity?.purpose || '旅途中认识的人'],
        ['记录地点', entity?.location || NPCS[name]?.location || '未知'],
        ['信任', relation.trust ?? state.relationships?.[name] ?? 0],
        ['亲近', relation.closeness ?? 0],
        ['戒心', relation.wariness ?? 0],
        ['最近事件', relation.lastEvent || '暂无']
      ]));
    }
  } else if (tab === 'quests') {
    dom.drawerTitle.textContent = '任务与牵挂';
    let count=0;
    if (state.astraWorld) for (const quest of Object.values(state.astraWorld.quests || {})) {
      count++;
      dom.drawerContent.append(ledgerSection(`${quest.state} · ${quest.title}`, [
        ['目标', quest.primaryGoals?.join('；') || '尚未确定'], ['期限', `第 ${Math.floor(quest.deadline / 1440) + 1} 日`],
        ['报酬', quest.state === 'completed' ? quest.earnedRewards?.join('、') : quest.lostRewards?.length ? '已经失去' : quest.rewards?.join('、')]
      ]));
    }
    else for(const q of questRows(state)){count++;dom.drawerContent.append(ledgerSection(q.status+' · '+q.title,[['说明',q.description],['进度',q.progress]]));}
    for (const thread of state.journeyWorld?.threads || []) {
      count++;
      dom.drawerContent.append(ledgerSection(`${thread.kind} · ${thread.title}`, [['状态', thread.status], ['依据', thread.evidence]]));
    }
    if (!count) dom.drawerContent.append(ledgerSection(state.astraWorld ? '此世未有已接任务' : '柴门之外', [['类型','当前'],['说明',state.astraWorld ? '人物与组织会自行行动；机缘随时间开启，也可能错过。' : '先活着走出赵府，再决定此世要怎么活。']]));
  } else if (tab === 'map') {
    dom.drawerTitle.textContent = '山河地图';
    const known = snap.knownLocations.length ? snap.knownLocations : [state.story.location];
    for (const name of known) {
      const entity = Object.values(state.memory.entities || {}).find(e => e.kind === 'location' && e.name === name);
      const info = LOCATIONS[name];
      const row = node('div', `map-node ${name === state.story.location ? 'current' : ''}`);
      row.append(node('i'), node('div'));
      row.lastChild.append(node('b', '', name), node('p', '', info?.description || entity?.description || `记录于 ${entity?.location || '旅途'}`));
      dom.drawerContent.append(row);
    }
  } else {
    dom.drawerTitle.textContent = '记忆';
    const facts = [...(state.memory.facts || [])].reverse();
    if (!facts.length) dom.drawerContent.append(node('p', 'memory-card', '尚无记忆。'));
    for (const fact of facts.slice(0, 50)) {
      const card = node('div', 'memory-card', fact.object || fact.predicate || '已记录');
      if (fact.locked) card.dataset.locked = 'true';
      dom.drawerContent.append(card);
    }
  }
}

function openDrawer(tab = 'world') {
  renderDrawer(tab);
  dom.drawerBackdrop.hidden = false;
  dom.worldDrawer.hidden = false;
}

function closeDrawer() {
  dom.drawerBackdrop.hidden = true;
  dom.worldDrawer.hidden = true;
}

async function applyInventoryAction(name,action){
  if(!state||turnBusy||saveUI?.isBusy()||experience.isWriting()||state.story.flags?.playerDead)return;
  const before=structuredClone(state);turnBusy=true;renderDrawer('inventory');
  try{
    const result=await commitInventoryAction(state,{name,action},{stateStore,transcriptStore});
    if(!result.ok){state=result.state;renderAll();showToast(result.error||'当前无法使用此物品');return;}
    state=result.state;
    transcript.push({blocks:result.blocks,summary:result.turn.summary,input:result.turn.userText,at:formatClock(state)});
    await experience.renderBlocks(result.blocks,'',{animate:false});
    renderAll({suggestions:getAvailableActions(state)});
    experience.showEvents(before,state);audioEngine.sfx('quest');
    showToast(result.historyPending?'物品已结算，记录待恢复；下次操作会先重试保存。':result.blocks.map(b=>b.text).join(' '));
  }catch(error){showToast('物品未结算：'+error.message);}
  finally{turnBusy=false;renderDrawer('inventory');}
}

function renderSystemDock() {
  if (!dom.systemFeed || !state) return;
  const memory = systemTranscript.length?systemTranscript.slice(-20):(state.systemCompanion?.dialogueMemory||[]);
  dom.systemFeed.replaceChildren();
  if (!memory.length) {
    dom.systemFeed.append(node('p', 'sys-msg', '系统在线。你继续说，我会盯着时间、人物和局势。'));
  } else {
    for (const entry of memory) {
      const role = entry.role === 'player' ? 'player-msg' : 'sys-msg';
      const p = node('p', role, entry.text || '');
      dom.systemFeed.append(p);
    }
  }
  dom.systemFeed.scrollTop = dom.systemFeed.scrollHeight;
}

function rememberRealtimeSystem(text) {
  if (!state || !text) return;
  state.systemCompanion ||= {};
  const old = Array.isArray(state.systemCompanion.dialogueMemory) ? state.systemCompanion.dialogueMemory : [];
  const last = old.at(-1);
  if (last?.role === 'system' && last?.text === text) return;
  state.systemCompanion.dialogueMemory = [...old, { role: 'system', text }].slice(-12);
}

function realtimeSystemReaction(before, after, blocks = []) {
  if (!before || !after) return '';
  if (after.story.flags?.playerDead && !before.story.flags?.playerDead) return '……宿主。气血归零了。命簿没有替你作弊，这一世到这里。';
  const hpLoss = Number(before.player.hp || 0) - Number(after.player.hp || 0);
  if (hpLoss >= 25) return `宿主，刚才这一回合掉了 ${hpLoss} 点气血。不是演出，继续硬扛真的会死。`;
  if (after.story.flags?.zhaoPursuitArrived && !before.story.flags?.zhaoPursuitArrived) return '宿主，赵天霸已经到了。不是“还在靠近”，人就在附近。';
  if (before.story.location !== after.story.location) return `位置已更新：${after.story.location}。我会继续按这里的人物、时间和危险往下记。`;
  const beforeAbs = absoluteMinutes(before), afterAbs = absoluteMinutes(after);
  const elapsed = Math.max(0, afterAbs - beforeAbs);
  const visible = (blocks || []).map(b => b?.text || '').join('');
  if (!before.story.flags?.playerDead && after.story.flags?.playerDead) return '命簿已确认：你的气血归零，此世结束。';
  const danger = Number(after.director?.dangerClocks?.zhaoPursuit || 0);
  if (danger >= 3) return `外面的威胁已经到临界阶段。${elapsed ? `刚才现实又过去了 ${elapsed} 分钟。` : ''}`;
  if (elapsed >= 10) return `这一回合现实推进了 ${elapsed} 分钟。世界没有停在原地。`;
  return '';
}

function renderAll({ suggestions } = {}) {
  renderHud();
  renderEchoes();
  renderSystemDock();
  audioEngine.setIntensity(Number(state.director?.dangerClocks?.zhaoPursuit || 0), Number(state.player.hp || 0) / Math.max(1, Number(state.player.maxHp || 1)));
  if (suggestions) renderSuggestions(suggestions);
  if (!dom.worldDrawer.hidden) renderDrawer(activeDrawer);
}

async function submitTurn(input) {
  if (!state) return;
  if (turnBusy || saveUI?.isBusy() || experience.isWriting()) return;
  const availability = turnFlow.state();
  if (availability !== 'idle') {
    if (availability === 'cooldown') showToast(`灵机调息中，${(turnFlow.remainingMs() / 1000).toFixed(1)} 秒后可继续；输入已保留。`);
    return;
  }
  if (state.story.flags?.playerDead||state.astraWorld?.terminal?.ended||(!state.astraWorld && state.campaign?.status==='complete')) { showToast('此世已终；系统仍可交谈，返回标题可重新启程'); audioEngine.sfx('death'); return; }
  const beforeState = structuredClone(state);
  const playerTurn = normalizePlayerTurnInput(input);
  if (playerTurnIsEmpty(playerTurn)) {
    showToast('至少填写“说话”或“动作”其中一项');
    return;
  }
  if (!(await experience.requireKey()) || turnBusy) return;
  if (!turnFlow.begin().ok) return;
  turnBusy = true;
  const serialized = serializePlayerTurn(playerTurn);
  experience.pendingSpeech(playerTurn.speech);
  let committedTurn = false;
  audioEngine.unlock();
  audioEngine.sfx('send');
  dom.sendButton.disabled = true;
  dom.speechInput.disabled = true;
  dom.actionInput.disabled = true;
  dom.systemLine.textContent = '正在结算这一回合：说话逐字保留，动作由世界规则判定。';
  // Do not echo raw Speech/Action form fields into the story. Exact Speech is
  // inserted once by the engine; Action is represented only by its resolved result.
  dom.storyScroll.scrollTop = dom.storyScroll.scrollHeight;

  try {
    const result = await aiRunner.runWorld({
      state,
      input: playerTurn,
      settings: runnerSettings(),
      onProgress: (phase) => {
        if (phase === 'generating' || phase === 'repair') turnFlow.phase('ai_running');
        if (phase === 'saving') turnFlow.phase('engine_commit');
        dom.systemLine.textContent = phase === 'validating'
          ? '正在核对人物、地点、时间、记忆与因果…'
          : phase === 'saving' ? '正在写入本地命簿与长期记忆…'
          : phase === 'repair' ? '叙事结构未通过，正在由同一 AI 修正…'
          : '叙事 AI 正在生成这一回合…';
      }
    });

    if (result.ok) {
      state = ensureV31Canon(result.state, 'ai');
      committedTurn = true;
      turnFlow.commit();
      // Persist the committed engine transaction before its visual reveal.
      persist();
      let checkpointSaved = true;
      try { await saveSession.committed(state); }
      catch (error) { checkpointSaved = false; showToast('续玩检查点未更新；自动命簿仍已保存：' + error.message); }
      experience.pendingSpeech('');
      await experience.renderBlocks(result.blocks, playerTurn.speech);
      experience.showEvents(beforeState,state);
      transcript.push({
        input: serialized, speech: playerTurn.speech, action: playerTurn.action,
        blocks: result.blocks, summary: result.turn?.summary || '', at: formatClock(state), turn: state.memory.turnCount,
        provider: result.turn?.provider || '', model: result.turn?.model || ''
      });
      transcript = transcript.slice(-240);
      const liveReaction = realtimeSystemReaction(beforeState, state, result.blocks);
      if (liveReaction) rememberRealtimeSystem(liveReaction);
      persist();
      if (checkpointSaved) showToast('自动命簿已更新');
      audioEngine.sfx(state.story.flags?.playerDead ? 'death' : Number(state.director?.dangerClocks?.zhaoPursuit || 0) >= 3 ? 'danger' : 'turn');
      renderAll({ suggestions: state.story.flags?.playerDead ? [] : getAvailableActions(state) });
      const sticky = aiClient.loadSticky(state.journeyId);
      dom.systemLine.textContent = result.turn?.cloudAssist
        ? `命簿已续 · 本回合使用 ${V31_PROVIDER_DEFAULTS[result.turn.provider]?.label || result.turn.provider} 云端辅助`
        : sticky?.provider
        ? `命簿已续 · ${V31_PROVIDER_DEFAULTS[sticky.provider]?.label || sticky.provider}`
        : 'AI 与游戏规则已同步。';
      return;
    }

    // A fixed cloud route never substitutes another writing engine. If Groq
    // cannot produce a causally valid turn after same-provider retries/repair,
    // leave reality untouched and let the player retry without style-jumping.
    throw Object.assign(new Error(result.error || '本回合尚未完成。'),{code:result.code,retryAfterMs:result.retryAfterMs});
  } catch (error) {
    if (!committedTurn) turnFlow.fail();
    const message = String(error?.message || 'Groq 暂时没有生成可提交的叙事。');
    dom.systemLine.textContent = `回合未提交：${message} · 输入与世界保持原样。`;
    showToast(message);
    audioEngine.sfx('danger');
  } finally {
    turnBusy = false;
    experience.pendingSpeech('');
    const dead = Boolean(state?.story?.flags?.playerDead||state?.astraWorld?.terminal?.ended||(!state?.astraWorld && state?.campaign?.status==='complete'));
    dom.sendButton.disabled = dead || turnFlow.state() !== 'idle';
    dom.speechInput.disabled = dead;
    dom.actionInput.disabled = dead;
    if (committedTurn) {
      dom.speechInput.value = '';
      dom.actionInput.value = '';
      const details = document.getElementById('actionDetails');
      if (details) details.open = false;
    }
    if (!dead) dom.speechInput.focus();
    dom.storyScroll.scrollTop = dom.storyScroll.scrollHeight;
  }
}

setInterval(() => {
  if (!state || turnBusy) return;
  const phase = turnFlow.state();
  if (phase === 'cooldown') {
    dom.sendButton.disabled = true;
    dom.systemLine.textContent = `本回合已保存 · 调息 ${(turnFlow.remainingMs() / 1000).toFixed(1)} 秒后可继续`;
  } else if (dom.sendButton.disabled && !state.story.flags?.playerDead && !state.astraWorld?.terminal?.ended) {
    dom.sendButton.disabled = false;
    dom.systemLine.textContent = '命簿已续 · 可以继续说话。';
    dom.speechInput.focus();
  }
}, 200);

async function enterGame(nextState, { resetLog = false } = {}) {
  if (!(await experience.requireKey()) || turnBusy) return;
  audioEngine.unlock();
  experience.audio.setScene('game');
  state = ensureV31Canon(nextState, 'ai');
  if(state.transactionJournal){try{state=await stateStore.recoverPendingTurn('ai',state,transcriptStore);}catch(error){showToast('上次结算已保存，行记恢复待重试：'+error.message);}}
  if (resetLog) {transcript = [];systemTranscript=[];}
  else await loadTranscript(state.journeyId);
  persist();
  await experience.enter(()=>{dom.titleScreen.hidden=true;dom.gameShell.hidden=false;rebuildStory();renderAll({suggestions:getAvailableActions(state)});});
  refreshAiBadge();
  if (!state.story.flags?.playerDead) dom.speechInput.focus();
}

async function startNew() {
  if (turnBusy || menuBusy || saveUI?.isBusy()) return;
  menuBusy = true;
  try {
    if (!(await experience.requireKey())) return;
    if (safeLoad() && !(await experience.confirmNew())) return;
    const opening = createAstraOpening(ensureV31Canon(createGameState('顾长生', 'ai'), 'ai'));
    const fresh=opening.state;
    await transcriptStore.appendTurn(fresh.journeyId,opening.turn);
    await saveSession.begin(fresh);
    await enterGame(fresh);
    if (state?.journeyId === fresh.journeyId) showToast('新的一世，已落入命簿。');
  } finally { menuBusy = false; }
}

function returnTitle() {
  if (turnBusy) {showToast('这一回合正在落笔，请稍候'); return;}
  experience.skip();
  experience.audio.setScene('title');
  state=null;
  dom.gameShell.hidden = true;
  dom.titleScreen.hidden = false;
  experience.menu();
  const saved = safeLoad();
  dom.continueJourneyButton.hidden = !saved;
}

async function exitGame() {
  try {
    if (typeof window.nativeAction === 'function') {
      await window.nativeAction('close',{confirmed:true});
      return;
    }
  } catch (error) {
    showToast('退出失败：' + error.message);
    return;
  }
  // Browser fallback cannot always close a tab it did not open. Make the exit
  // action visible and deterministic instead of trapping the player silently.
  try { window.close(); } catch {}
  showToast('浏览器后备模式：请关闭此标签页退出游戏');
}

function setSystemLayer(open) {
  dom.systemChatLayer.hidden = !open;
  if (open) {
    renderSystemArchive();
    dom.systemInput.focus();
  }
}

function systemArchive(turns){return turns.slice(-100).flatMap(t=>t.kind==='system'?[...(t.userText?[{role:'player',text:t.userText}]:[]),{role:'system',text:(t.blocks||[]).map(b=>b.text).join('\n')}]:
 (t.blocks||[]).filter(b=>b.type==='sys').map(b=>({role:'system',text:b.text}))); }
function renderSystemArchive(){dom.systemChatResponse.replaceChildren();for(const entry of systemTranscript.length?systemTranscript:(state?.systemCompanion?.dialogueMemory||[])){dom.systemChatResponse.append(node('p',entry.role==='player'?'player-msg':'sys-msg',entry.text||''));}if(!dom.systemChatResponse.childNodes.length)dom.systemChatResponse.textContent='系统在此。外界时间已冻结。';dom.systemChatResponse.scrollTop=dom.systemChatResponse.scrollHeight;}

async function submitSystemChat() {
  if (!state || turnBusy || saveUI?.isBusy() || experience.isWriting()) return;
  const activeInput = !dom.systemChatLayer.hidden ? dom.systemInput?.value : dom.systemDockInput?.value;
  const input = String(activeInput).trim();
  if (!input) return;
  turnBusy = true;
  const beforeDay = state.story.day;
  const beforeMinute = state.story.minuteOfDay;
  if (dom.sendSystemButton) dom.sendSystemButton.disabled = true;
  if (dom.systemDockSend) dom.systemDockSend.disabled = true;
  if (dom.systemChatResponse) dom.systemChatResponse.textContent = '系统正在回应…';
  if (dom.systemDockInput) dom.systemDockInput.disabled = true;
  renderSystemDock();
  try {
    const result = await aiRunner.runSystem({
      state,
      input,
      settings: runnerSettings()
    });
    if (!result.ok) throw new Error(result.error || '系统暂时没有回应');
    state = ensureV31Canon(result.state, 'ai');
    if (state.story.day !== beforeDay || state.story.minuteOfDay !== beforeMinute) {
      throw new Error('系统对话不得推进现实时间');
    }
    persist();
    const answerText = (result.blocks || []).map(block => block.text).join('\n') || '系统没有更多补充。';
    try{systemTranscript=systemArchive(await transcriptStore.allTurns(state.journeyId));}catch{systemTranscript.push({role:'player',text:input},{role:'system',text:answerText});}
    renderSystemArchive();
    if (dom.systemInput) dom.systemInput.value = '';
    if (dom.systemDockInput) dom.systemDockInput.value = '';
    audioEngine.sfx('system');
    renderSystemDock();
  } catch (error) {
    const failureText = `系统暂未回应：${error.message || '连接失败'}。原话已保留，世界时间未推进。`;
    if (dom.systemChatResponse) dom.systemChatResponse.textContent = failureText;
    showToast(failureText);
    renderSystemDock();
  } finally {
    turnBusy = false;
    if (dom.sendSystemButton) dom.sendSystemButton.disabled = false;
    if (dom.systemDockSend) dom.systemDockSend.disabled = false;
    if (dom.systemDockInput) { dom.systemDockInput.disabled = false; dom.systemDockInput.focus(); }
  }
}


function setLawLayer(open) {
  dom.lawLayer.hidden = !open;
  if (open) {
    dom.lawCostHint.textContent = '代价未结算 · 结果必定实现 · 愿望越大，随机代价区间越高';
    dom.lawInput.focus();
  } else {
    dom.lawInput.value = '';
  }
}

function estimateLawScale(text) {
  const value = String(text || '').trim();
  if (!value) return '未写下愿望';
  if (/天道|世界|所有|一切|永远|不死|无敌|渡劫|飞升|复活所有|改变世界/u.test(value)) return '天命级 · 最高因果代价区间';
  if (/复活|元婴|化神|渡劫|逆转|无限|永生|不灭/u.test(value)) return '逆命级 · 高因果代价区间';
  if (/筑基|结丹|金丹|突破|瞬移|传送|成为|治好|恢复/u.test(value)) return '重愿级 · 中等因果代价区间';
  return '凡愿级 · 轻微因果代价区间';
}

async function submitLaw() {
  if (!state) return;
  const wish = String(dom.lawInput.value || '').trim();
  if (!wish) {
    dom.lawCostHint.textContent = '先写下你要此世实现的结果。';
    dom.lawInput.focus();
    return;
  }
  audioEngine.unlock();
  audioEngine.sfx('law');
  dom.lawSubmitButton.disabled = true;
  dom.lawCostHint.textContent = estimateLawScale(wish) + ' · 正在敕令世界…';
  setLawLayer(false);
  try {
    await submitTurn({ speech: '', action: `言出法随：${wish}` });
  } finally {
    dom.lawSubmitButton.disabled = false;
  }
}

function installLawDust() {
  const holder = dom.lawInvokeButton?.querySelector('.law-dust');
  if (!holder) return;
  holder.replaceChildren();
  const count = lowSpecUI ? 5 : 11;
  for (let i = 0; i < count; i++) {
    const mote = node('i', 'law-dust-mote', '✦');
    mote.style.setProperty('--x', `${(i * 17 + 9) % 112 - 6}px`);
    mote.style.setProperty('--delay', `${-(i * .43)}s`);
    mote.style.setProperty('--dur', `${2.6 + (i % 5) * .5}s`);
    holder.append(mote);
  }
}

function installPetals() {
  dom.petalField.replaceChildren();
  const count = lowSpecUI ? 10 : (matchMedia('(max-width: 700px)').matches ? 16 : 30);
  for (let i = 0; i < count; i++) {
    const petal = node('i', 'petal');
    petal.style.left = `${(i * 37 + 11) % 101}%`;
    petal.style.setProperty('--fall', `${9 + (i % 8) * 1.3}s`);
    petal.style.setProperty('--delay', `${-(i % 13) * .9}s`);
    petal.style.setProperty('--drift', `${30 + (i % 7) * 17}px`);
    petal.style.setProperty('--rot', `${i * 29}deg`);
    petal.style.transform = `scale(${.55 + (i % 5) * .12})`;
    dom.petalField.append(petal);
  }
}

function installParallax() {
  if (lowSpecUI || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  addEventListener('pointermove', (event) => {
    const x = (event.clientX / innerWidth - .5) * 8;
    const y = (event.clientY / innerHeight - .5) * 5;
    requestAnimationFrame(() => {
      dom.worldImage.style.transform = `scale(1.045) translate(${-x}px,${-y}px)`;
    });
  }, { passive: true });
}


async function refreshAiBadge() {
  try {
    const info = await aiClient.status(true);
    const settings = aiClient.loadSettings();
    const rawSticky = state ? aiClient.loadSticky(state.journeyId) : null;
    const sticky = rawSticky?.provider === 'local' && !['local','hybrid-assist'].includes(settings.mode) ? null : rawSticky;
    if (sticky?.provider) {
      dom.systemLine.textContent = `叙事 AI：${V31_PROVIDER_DEFAULTS[sticky.provider]?.label || sticky.provider}${sticky.reason === 'cloud-assist' || sticky.reason === 'hybrid-assist' ? ' · 云端辅助已使用' : ' · 路由已固定'}`;
    } else if (['local','hybrid-assist'].includes(settings.mode)) {
      dom.systemLine.textContent = info.local?.modelInstalled && info.local?.runtimeInstalled
        ? `本地 AI 已选定${settings.mode === 'hybrid-assist' ? '；必要时可使用已配置云端辅助' : '；不会自动使用云端'}`
        : '本地 AI 已选定，但模型组件尚未就绪。';
    } else {
      const provider = settings.mode === 'auto-stable' ? (settings.preferred || 'groq') : (settings.mode || 'groq');
      dom.systemLine.textContent = `叙事 AI：${V31_PROVIDER_DEFAULTS[provider]?.label || provider} · Game Engine 独立保存世界状态`;
    }
    return info;
  } catch {
    return null;
  }
}

function installAiSettingsPanel() {
  const top = document.querySelector('.top-actions');
  const button = node('button', 'icon-btn ai-config-button', 'AI');
  button.type = 'button';
  button.title = 'AI 路由与模型';
  top?.prepend(button);

  const layer = node('div', 'ai-config-layer');
  layer.hidden = true;
  layer.innerHTML = `
    <section class="ai-config-card">
      <header><div><small>BETA V1 · HYBRID ENGINE</small><h2>叙事 AI 路由</h2></div><button type="button" class="ai-close">×</button></header>
      <p class="ai-explain">本地模型优先；云端只在你选择辅助或云端模式后使用。模型与世界规则分离，云端调用会在回合记录中标明。</p>
      <label class="ai-field"><span>运行模式</span><select id="v31AiMode">
        <option value="local">本地均衡 · 不用云端</option>
        <option value="hybrid-assist">混合辅助 · 本地优先</option>
        <option value="groq">Groq · 仅云端</option>
        <option value="gemini">Gemini Fixed</option>
        <option value="tokenharbor">Token Harbor Fixed</option>
        <option value="openai">OpenAI Fixed</option>
        <option value="openrouter">OpenRouter Fixed</option>
        <option value="mistral">Mistral Fixed</option>
        <option value="siliconflow">SiliconFlow Fixed</option>
        <option value="custom">Custom OpenAI-Compatible</option>
      </select></label>
      <div class="ai-grid">
        <label class="ai-field"><span>首选外部 AI</span><select id="v31AiPreferred">
          <option value="groq">Groq</option><option value="gemini">Gemini</option><option value="tokenharbor">Token Harbor</option>
          <option value="openai">OpenAI</option><option value="openrouter">OpenRouter</option><option value="mistral">Mistral</option><option value="siliconflow">SiliconFlow</option>
        </select></label>
        <label class="ai-field"><span>模型名称</span><input id="v31AiModel" placeholder="可输入供应商任意模型 ID"></label>
      </div>
      <label class="ai-field custom-url" hidden><span>Custom Base URL</span><input id="v31AiBase" placeholder="https://example.com/v1"></label>
      <section class="ai-credential">
        <div><b>本机加密 API Key</b><small id="v31AiCredentialState">读取状态中…</small></div>
        <input id="v31AiKey" type="password" autocomplete="off" placeholder="只在这里输入一次；不会写入游戏存档或 ZIP">
        <div class="ai-actions"><button type="button" id="v31AiSaveKey">加密保存 Key</button><button type="button" id="v31AiTest">测试连接</button><button type="button" id="v31AiClear">清除 Key</button></div>
      </section>
      <section class="ai-local-status" id="v31AiLocal">本地 AI 状态读取中…</section>
      <footer><button type="button" id="v31AiApply">保存路由设置</button></footer>
    </section>`;
  document.body.append(layer);

  const q = (id) => layer.querySelector('#' + id);
  const mode = q('v31AiMode');
  const preferred = q('v31AiPreferred');
  const model = q('v31AiModel');
  const base = q('v31AiBase');
  const key = q('v31AiKey');
  const credentialState = q('v31AiCredentialState');
  const localState = q('v31AiLocal');
  const customUrl = layer.querySelector('.custom-url');

  const selectedProvider = () => mode.value === 'hybrid-assist' ? 'local' : mode.value === 'auto-stable' ? preferred.value : mode.value;
  const credentialProvider = () => mode.value === 'hybrid-assist' ? preferred.value : selectedProvider();

  function syncModel() {
    const settings = aiClient.loadSettings();
    const provider = selectedProvider();
    model.value = settings.models?.[provider] || V31_PROVIDER_DEFAULTS[provider]?.model || '';
    base.value = settings.customBaseUrl || '';
    customUrl.hidden = provider !== 'custom';
  }

  async function refreshPanelStatus() {
    const info = await aiClient.status(true).catch(() => null);
    const provider = selectedProvider();
    const credential = credentialProvider();
    const configured = provider === 'local' ? true : Boolean(info?.cloud?.configured?.[provider]);
    credentialState.textContent = mode.value === 'hybrid-assist'
      ? `本地无需 Key；辅助 ${V31_PROVIDER_DEFAULTS[credential]?.label || credential} ${info?.cloud?.configured?.[credential] ? '已配置' : '尚未配置'}`
      : provider === 'local' ? '本地模型无需 API Key'
      : configured ? '已安全保存于 Windows 当前用户 DPAPI' : '尚未配置';
    localState.textContent = info?.local?.modelInstalled && info?.local?.runtimeInstalled
      ? `本地 AI：已安装 · ${info.local.profileLabel || 'Qwen'} · ${info.local.contextSize || '?'} ctx · ${info.local.threads || '?'} threads`
      : '本地 AI：组件尚未就绪；云端模式不受影响';
  }

  async function open() {
    const settings = aiClient.loadSettings();
    mode.value = settings.mode || 'local';
    preferred.value = settings.preferred || 'groq';
    syncModel();
    key.value = '';
    layer.hidden = false;
    await refreshPanelStatus();
  }
  function close() { layer.hidden = true; }

  button.addEventListener('click', open);
  window.addEventListener('lx:open-ai', open);
  layer.querySelector('.ai-close').addEventListener('click', close);
  layer.addEventListener('click', (event) => { if (event.target === layer) close(); });
  mode.addEventListener('change', () => { syncModel(); refreshPanelStatus(); });
  preferred.addEventListener('change', () => { syncModel(); refreshPanelStatus(); });

  q('v31AiApply').addEventListener('click', () => {
    const settings = aiClient.loadSettings();
    const provider = selectedProvider();
    const models = { ...settings.models, [provider]: model.value.trim() };
    aiClient.saveSettings({
      mode: mode.value,
      preferred: preferred.value,
      models,
      customBaseUrl: base.value.trim()
    });
    if (state) aiClient.pin(state.journeyId, provider === 'local' ? 'local' : provider, 'user-choice');
    showToast('AI 路由设置已保存');
    refreshAiBadge();
    close();
  });

  q('v31AiSaveKey').addEventListener('click', async () => {
    const provider = credentialProvider();
    if (provider === 'local') return showToast('本地 AI 不需要 Key');
    if (!key.value.trim()) return showToast('请输入 API Key');
    try {
      await aiClient.saveCredential(provider, key.value.trim());
      key.value = '';
      await refreshPanelStatus();
      q('v31AiApply').click();
      showToast('Key 和当前模型设置已保存');
    } catch (error) { showToast('保存失败：' + error.message); }
  });

  q('v31AiClear').addEventListener('click', async () => {
    const provider = credentialProvider();
    if (provider === 'local') return;
    try {
      await aiClient.clearCredential(provider);
      key.value = '';
      await refreshPanelStatus();
      showToast('已清除这个供应商的 Key');
    } catch (error) { showToast('清除失败：' + error.message); }
  });

  q('v31AiTest').addEventListener('click', async () => {
    const provider = selectedProvider();
    if (provider === 'local') {
      try {
        const response = await fetch('/api/ai/generate', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ task:'narrate', messages:[{role:'user',content:'只回复：本地AI正常'}], maxTokens:24, temperature:0 })
        });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        showToast('本地 AI 连接成功');
        await refreshPanelStatus();
      } catch (error) { showToast('本地 AI 测试失败：' + error.message); }
      return;
    }
    try {
      await aiClient.testProvider(provider, model.value.trim(), base.value.trim());
      showToast((V31_PROVIDER_DEFAULTS[provider]?.label || provider) + ' 连接成功');
    } catch (error) { showToast('连接失败：' + error.message); }
  });
}

dom.newJourneyButton.addEventListener('click', startNew);
dom.continueJourneyButton.addEventListener('click', async () => {
  if(menuBusy||turnBusy)return;menuBusy=true;try{if(await experience.requireKey()){const saved=await saveSession.load(null);await enterGame(saved);}}catch(e){showToast(e.message);}finally{menuBusy=false;}
});
dom.exitGameButton.addEventListener('click',()=>saveUI.exit('close'));
dom.titleButton.addEventListener('click',()=>saveUI.exit('title'));
dom.saveButton.addEventListener('click',()=>saveUI.open());
$('loadJourneyButton').onclick=()=>saveUI.open();
dom.composer.addEventListener('submit', (event) => {
  event.preventDefault();
  submitTurn({ speech: dom.speechInput.value, action: dom.actionInput.value });
});
for (const field of [dom.speechInput, dom.actionInput]) {
  field.addEventListener('keydown', (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      dom.composer.requestSubmit();
    }
  });
}
dom.systemChatButton?.addEventListener('click', () => setSystemLayer(true));
document.getElementById('expandSystem')?.addEventListener('click',()=>setSystemLayer(true));
dom.systemDockSend?.addEventListener('click', submitSystemChat);
dom.systemDockInput?.addEventListener('keydown', (event) => {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submitSystemChat(); }
});
dom.closeSystemChat?.addEventListener('click', () => setSystemLayer(false));
dom.systemChatLayer?.addEventListener('click', (event) => { if (event.target === dom.systemChatLayer) setSystemLayer(false); });
dom.sendSystemButton?.addEventListener('click', submitSystemChat);
dom.systemInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    submitSystemChat();
  }
});
dom.lawInvokeButton.addEventListener('click', () => setLawLayer(true));
dom.lawCloseButton.addEventListener('click', () => setLawLayer(false));
dom.lawCancelButton.addEventListener('click', () => setLawLayer(false));
dom.lawLayer.addEventListener('click', (event) => { if (event.target === dom.lawLayer) setLawLayer(false); });
dom.lawSubmitButton.addEventListener('click', submitLaw);
dom.lawInput.addEventListener('input', () => {
  const wish = String(dom.lawInput.value || '').trim();
  dom.lawCostHint.textContent = wish
    ? estimateLawScale(wish) + ' · 最终代价将在实现时从该等级的因果池随机落定'
    : '代价未结算 · 结果必定实现 · 愿望越大，随机代价区间越高';
});
dom.lawInput.addEventListener('keydown', (event) => {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    submitLaw();
  }
});
for (const button of document.querySelectorAll('[data-panel]')) button.addEventListener('click', () => openDrawer(button.dataset.panel));
for (const button of document.querySelectorAll('[data-drawer-tab]')) button.addEventListener('click', () => renderDrawer(button.dataset.drawerTab));
dom.closeDrawer.addEventListener('click', closeDrawer);
dom.drawerBackdrop.addEventListener('click', closeDrawer);

dom.audioButton?.addEventListener('click', async () => {
  await audioEngine.unlock();
  const enabled = audioEngine.setEnabled(!audioEngine.isEnabled());
  dom.audioButton.classList.toggle('muted', !enabled);
  dom.audioButton.querySelector('span').textContent = enabled ? '音' : '静';
  showToast(enabled ? '轻音乐与音效已开启' : '声音已关闭');
});
document.addEventListener('pointerdown', () => audioEngine.unlock(), { once: true, passive: true });
if (dom.audioButton && !audioEngine.isEnabled()) {
  dom.audioButton.classList.add('muted');
  dom.audioButton.querySelector('span').textContent = '静';
}

installPetals();
installLawDust();
installParallax();
installAiSettingsPanel();
experience = createExperience({aiClient,onAiSettings:()=>window.dispatchEvent(new Event('lx:open-ai')),onTitle:returnTitle,onReady:async()=>{await saveSession.initialize();dom.continueJourneyButton.hidden=!safeLoad();},
  onExport:async()=>{
    const current=state||safeLoad();if(!current)throw new Error('尚无可以导出的旅程。');if(turnBusy)throw new Error('请等待当前回合写入。');
    const blob=await stateStore.exportJourney('ai',current,transcriptStore);const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='落仙-命簿-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
  },
  onImport:async(file)=>{
    if(turnBusy)throw new Error('请等待当前回合写入。');if(file.size>64*1024*1024)throw new Error('命簿超过 64 MiB，请保留原档案。');if(!(await experience.requireKey()))throw new Error('请先配置 AI Key。');
    if(safeLoad()&&!(await experience.confirmNew()))throw new Error('已取消导入。');
    const imported=await stateStore.importJourney('ai',file,transcriptStore);await saveSession.begin(imported);await enterGame(imported);
  }
});
$('titleSettingsButton').onclick=()=>experience.openSettings();
$('gameSettingsButton').onclick=()=>experience.openSettings();
window.addEventListener('lx-open-settings',()=>experience.openSettings('ai'));
const savedAtLoad = safeLoad();
dom.continueJourneyButton.hidden = !savedAtLoad;

saveUI=createSaveUI({session:saveSession,stateStore,getState:()=>dom.gameShell.hidden?null:state,isBusy:()=>turnBusy||menuBusy||experience.isWriting()||experience.isTransitioning(),requireKey:()=>experience.requireKey(),onLoad:enterGame,onLeave:async target=>{if(target==='close')await exitGame();else returnTitle();},toast:showToast});
window.addEventListener('lx:close-request',()=>saveUI.exit('close'));
if(window.lxNative)window.nativeAction('close-guard').catch(()=>{});
