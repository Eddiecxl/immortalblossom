// Detect the invocation, not punctuation inside the requested result. Quoted
// names and negative outcomes are valid operands of an explicit command.
export function explicitRealityStatement(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(?:(?:我|本人)?\s*(?:(?:现在|此刻|立刻)\s*)?(?:(?:要|将|决定)\s*)?(?:用|使用|发动|施展|施放|启用|动用|以)\s*)?言出法随\s*(?:[:：，,]\s*|(?=让|使|将|把|令|创造|变出|制造|改写|重写|改变|复活|杀死|抹杀|毁灭|治愈|恢复|传送|瞬移))([\s\S]+)$/u);
  if (!match) return null;
  const result = match[1].trim();
  // A question ABOUT invoking the ability is not an invocation. A conditional
  // rule ("如果…就…") or "不要让…" describes the desired world instead.
  const unquoted = result.replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"\n]*"/gu, '');
  if (/^(?:我|本人)\s*(?:不想|不打算|不准备|不会|不能|没有)|^(?:是什么|怎么用|如何使用|能否|是否|会不会|假设|假如|要是)|(?:会怎样|怎么办|可以吗)[？?]?$/u.test(unquoted)
    || /(?:[？?]|(?:吗|么)[。！!]?)$/u.test(unquoted)) return null;
  return result ? '言出法随：' + result : null;
}
