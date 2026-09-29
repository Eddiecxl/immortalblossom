// The local-online release is a replaceable gameplay profile. Future supplied
// versions can update this module without replacing the established UI shell,
// storage implementation or provider client.
export const LOCAL_ONLINE_PROFILE = Object.freeze({
  mode: 'v13',
  version: '13.5',
  label: '本地线上 · v13.5',
  prompt: '这是落仙v13.5本地线上内核：先处理玩家输入；硬连续性高于文风，人物认知、精确地点和持有物只按已提交事实变化；不因第一/第三人称混用拒绝有效回合。'
});
