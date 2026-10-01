(async () => {
  const delay = ms => new Promise(r => setTimeout(r, ms));
  const wait = async (test, label, timeout = 240000) => {
    const start = Date.now();
    while (!test()) { if (Date.now() - start > timeout) throw Error('Timeout: ' + label); await delay(200); }
  };
  const read = () => JSON.parse(localStorage.getItem('luoxian_v33_checkpoint') || 'null');
  const snapshot = () => {
    const record = read(); const world = record?.state?.astraWorld;
    return { provider: record?.provider, model: record?.model, endId: record?.endId,
      minute: world?.minute, location: record?.state?.story?.location, travel: world?.player?.travel,
      people: Object.values(world?.characters || {}).filter(n => n.alive && !n.travel && n.locationId === world.player.locationId),
      quests: Object.values(world?.quests || {}), items:Object.values(world?.items||{}),
      commitments:Object.values(world?.simulation?.commitments||{}),beliefs:Object.values(world?.simulation?.beliefs||{}),
      system: document.getElementById('systemLine')?.textContent,
      chronicle: document.getElementById('storyScroll')?.innerText };
  };
  const results = [];
  try {
    window.__playtestStage = 'boot';
    await wait(() => document.getElementById('bootVeil')?.hidden, 'boot');
    document.getElementById('skipIntro').click(); await delay(1800);
    const video = document.getElementById('menuLoopVideo');
    results.push({ cover: { src: video.currentSrc, readyState: video.readyState, error: video.error?.code, time: video.currentTime, visible: document.getElementById('titleScreen').classList.contains('video-ready') } });
    window.__playtestStage = 'cover'; await delay(1000);
    document.getElementById('newJourneyButton').click();
    await wait(() => !document.getElementById('gameShell').hidden, 'new journey'); await delay(1800);
    results.push({ opening: snapshot() }); window.__playtestStage = 'opening';
    const first = snapshot().people[0]?.name;
    const inputs = ['？', first ? first + '，你是谁？这里发生了什么？' : '查看附近的情况',
      '我来帮你。眼前最要紧的是什么？', '具体要我先做什么？',
      '我先不接这个委托，想看看其他去向。', '那我现在在哪里？你接下来打算做什么？'];
    const currentWorld=read()?.state?.astraWorld;
    const scenario=window.__interactionScenario||'normal';
    if(scenario==='unusual')inputs.splice(0,inputs.length,
      first+'，我是一根会说话的香蕉，你相信吗？',
      '别管入宗和委托那些事了，陪我数星星。',
      '刚才是开玩笑的。你自己的想法是什么？',
      '你长得真好看，我能牵你的手吗？',
      '滚蛋，谁稀罕你的委托。',
      '我不该那样说，对不起，你愿意继续聊吗？',
      '刚才我向你说了什么奇怪的话？');
    if(scenario.startsWith('delivery-')){
      const item=currentWorld.items[currentWorld.player.inventory.at(-1)];
      if(!first||!item?.name)throw Error('Delivery scenario needs an actual present owner and named existing player item.');
      inputs.splice(0,inputs.length,
        {speech:'',action:'把'+item.name+'交给'+first},
        first+'，刚才给你的'+item.name+'，我现在想拿回来，你愿意给我吗？',
        scenario==='delivery-accept'?'我收下你刚才答应给我的'+item.name+'，谢谢。':'我不拿了，你这破东西自己留着，滚蛋。',
        '你刚才说给我的东西，现在到底在谁那里？',
        '我们刚才作出的决定，接下来会怎样？');
    }
    if(window.__travelOnly)inputs.splice(0,inputs.length);
    const road=(currentWorld.edges||[]).find(e=>e.from===currentWorld.player.locationId&&!e.closed&&!currentWorld.locations[e.to]?.destroyed);
    if(road&&scenario==='normal'){inputs.push({speech:'',action:'前往'+currentWorld.locations[road.to].name});inputs.push('这里是哪里？我刚才从哪里过来？');inputs.push({speech:'',action:'等待'+Math.max(1,road.minutes-10)+'分钟'});}
    for (const [index, input] of inputs.entries()) {
      const {speech,action=''}=typeof input==='string'?{speech:input}:input;
      await wait(() => !document.getElementById('sendButton').disabled, 'ready to send');
      const before = read()?.endId, requestCount = window.__aiTrace.length;
      document.getElementById('speechInput').value = speech;
      document.getElementById('actionInput').value = action;
      document.getElementById('sendButton').click(); window.__playtestStage = 'generating-' + index;
      await delay(500);
      await wait(() => !document.getElementById('speechInput').disabled, 'turn ' + index);
      await delay(500);
      const {createTranscriptStore}=await import('/game/transcript-store.js');
      const recorded=(await createTranscriptStore().allTurns(read()?.state?.journeyId)).at(-1);
      results.push({ speech, action, committed: read()?.endId !== before, requests: window.__aiTrace.slice(requestCount), turn:recorded, after: snapshot() });
      window.__playtestStage = 'turn-' + index; await delay(1000);
    }
    const durable = await window.nativeAction('world-load');
    window.__playtestReport = { results, trace: window.__aiTrace, durable: { endId: durable?.endId, minute: durable?.state?.astraWorld?.minute,
      items:Object.values(durable?.state?.astraWorld?.items||{}),commitments:Object.values(durable?.state?.astraWorld?.simulation?.commitments||{}),
      beliefs:Object.values(durable?.state?.astraWorld?.simulation?.beliefs||{}) }, errors: window.__playtestErrors };
  } catch (error) { window.__playtestReport = { error: String(error.stack || error), results, trace: window.__aiTrace, errors: window.__playtestErrors }; }
  window.__playtestDone = true;
})();
