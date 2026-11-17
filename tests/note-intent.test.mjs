import test from 'node:test';
import assert from 'node:assert/strict';
import { isHealthNoteRequest } from '../dist/note-intent.js';

for (const text of [
  '你好，请用中文简短说明健康卡可以记录哪些信息。',
  '健康卡可以记录什么？',
  '请告诉我如何记录就诊情况。',
  '我想知道健康卡可以记录哪些信息',
  '记录哪些信息对医生有帮助？',
  '记录的方法是什么？',
  '如何把用药信息记录到健康卡？',
  '帮我了解健康记录',
  '能记录什么？',
  '请问之前记录过哪些症状？',
  '不要记录这些信息。',
  'What information can the health card record?',
  'Can you explain how I record medication?',
  'How do I add a note to the health card?',
  'Show my medical records.',
  'Can you tell me which details are saved?',
  'What did I record yesterday?',
  'Please do not record this.',
  'Record which information can be saved?',
  'Save a photo of Mochi.',
  'Record a video of my dog.',
  'Add some more detail to your answer.',
]) {
  test(`conversation stays with AI: ${text}`, () => assert.equal(isHealthNoteRequest(text), false));
}
for (const text of [
  '请记录：Mochi 今天睡了 7 小时。',
  '帮我记录 Mochi 昨天打了疫苗。',
  '可以帮我记录一下今天服药 5 mg 吗？',
  '我想记录昨天的就诊情况：医生建议休息。',
  '记录一下：今天下午出现咳嗽。',
  '你好，请帮我记录，Mochi 今天走了 4000 步。',
  '请把 Mochi 今天睡了 7 小时记录到健康卡。',
  'Mochi 昨天接种疫苗，帮我记录一下。',
  'Log that Mochi slept 7 hours.',
  'Please record Mochi had a booster yesterday.',
  'Could you please save this note: Mochi coughed three times.',
  'I would like you to record that Mochi took 5 mg at 8 am.',
  'Hi, please note down Mochi’s vaccine appointment yesterday.',
  'Add a vaccination record for Mochi dated 2026-11-13.',
  'Create a health note: rested after a long walk.',
  'Record a note.',
]) {
  test(`explicit save creates a reviewable draft: ${text}`, () => assert.equal(isHealthNoteRequest(text), true));
}
