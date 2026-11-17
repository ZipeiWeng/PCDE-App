/**
 * Only explicit requests to save a note should bypass AI for a local draft.
 * A mention of “records” / “记录” is not an instruction to create one.
 */
export function isHealthNoteRequest(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  const clean = text.replace(/^(?:hello|hi|hey)[,!.\s]+/i, '').replace(/^(?:你好|您好|嗨)[，,！!。\s]*/, '');

  const english = clean.match(/^(?:(?:please|kindly)\s+)?(?:(?:can|could|would|will)\s+you(?:\s+please)?\s+|i(?:'d like| would like| want| need)(?:\s+you)?\s+to\s+)?(?:please\s+)?(log|record|save|note down|add|create)\b\s*([\s\S]*)$/i);
  if (english) {
    const verb = english[1].toLowerCase(), content = english[2].trim();
    // Keep ability, explanation, search and deletion requests in conversation.
    if (/^(?:how|why|when|where|whether|which|what(?:\s+(?:can|does|is|are|should|kind|information|data|fields))?|the difference)\b/i.test(content)) return false;
    if (/^(?:(?:a|an|the)\s+)?(?:video|audio|movie|screen|song|password|file|document|image|photo)\b/i.test(content)) return false;
    if (/\b(?:what|which)\s+(?:information|data|fields|details)\b|\b(?:can|could|should)\s+(?:be|i|we|you)\s+(?:recorded|saved|logged|record|save|log)\b/i.test(content)) return false;
    // “Add …” and “Create …” need an explicit health-note destination/type.
    if (/^(?:add|create)$/.test(verb) && !/\b(?:note|record|observation|health card|vaccination|vaccine|medication|parasite|deworming)\b/i.test(content)) return false;
    return true;
  }

  const chinese = clean.match(/^(?:(?:请|麻烦)(?:你)?\s*)?(?:(?:能否|可不可以|可以|能)(?:请)?(?:你)?\s*|我(?:想|要|需要)(?:你)?\s*)?(?:(?:帮我|替我)\s*)?(?:记下|记一下|记录|录入|保存|添加|新增)([\s\S]*)$/);
  if (chinese) {
    const content = chinese[1].replace(/^(?:一下|下来|下|一条|一个)\s*/, '');
    if (/^(?:什么|哪些|哪种|如何|怎么|怎样|为什么|是否|能否|能不能|可不可以|可以|能做|功能|方式|方法|的(?:内容|方法|方式|功能|信息)|了什么|过什么|有什么)/.test(content)) return false;
    if (/^(?:视频|音频|录音|屏幕|密码|文件|图片|照片)/.test(content)) return false;
    if (/(?:能|可以|应该)(?:记录|保存|录入)(?:什么|哪些)|(?:记录|保存|录入)(?:哪些|什么)(?:信息|内容|数据)/.test(content)) return false;
    return true;
  }
  // Both common Chinese word orders: “把 X 记到健康卡” and “X，帮我记一下”.
  if (/^(?:(?:请|麻烦)(?:你)?)?(?:帮我|替我)?(?:把|将)[\s\S]+(?:记到|记录到|录入|保存到|添加到)(?:我的|它的|狗狗的|宠物的)?(?:健康卡|健康记录|病历)(?:里|中|里面)?[。.!！]?$/u.test(clean)) return true;
  return /[，,。;；\n]\s*(?:(?:请|麻烦)(?:你)?)?(?:帮我|替我)(?:记一下|记下|记录|录入|保存)(?:一下|下来|下)?(?:到健康卡|到健康记录|到病历)?[。.!！]?$/u.test(clean);
}
