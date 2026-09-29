export function checkTerminalWorld(world) {
  world.terminal ||= { ended: false, ending: null, minute: null };
  if (world.terminal.ended) {
    world.eventQueue = [];
    return world.terminal;
  }
  if (!world.player?.alive || Number(world.player?.health) <= 0) {
    world.player.alive = false;
    world.terminal = { ended: true, ending: 'player_dead', minute: world.minute,
      summary: '此世命途归寂；没有未经记录的剧情护甲。' };
    world.eventQueue = [];
  }
  return world.terminal;
}
