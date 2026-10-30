import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LearnScreen } from '../js/screens/learn.js';
import { PosePipeline } from '../js/pose/pipeline.js';
import { Progression } from '../js/progression.js';
import { DebugLog } from '../js/debug/log.js';
import { frame } from './helpers/synthetic.js';
import { CALIB } from './helpers/reps.js';

const techniques = Object.fromEntries(['stance', 'guard', 'jab', 'cross'].map(id =>
  [id, JSON.parse(readFileSync(new URL(`../data/techniques/${id}.json`, import.meta.url), 'utf8'))]));

function fakes() {
  const said = [];
  const tones = [];
  const ui = { prompts: [], strips: [] };
  let handler = null;
  const stage = {
    drawOpts: {}, debug: { extra: {} },
    async start(o) { handler = o.onFrame; o.onStarted?.(); return true; },
    stop() {}, setPanel(p) { ui.panel = p; }, setChip() {}, setPrompt(t) { ui.prompts.push(t); },
    setDetail(t) { ui.detail = t; }, setStrip(r) { if (r) ui.strips.push([...r]); }, setTimer() {},
    setActions(a) { ui.actions = a; }, setBanner() {}, showCountdown() {},
  };
  const voice = { busy: false, pending: 0, say(t, o) { said.push(t); }, setHold() {}, cancelAll() {} };
  const toneLog = name => () => tones.push(name);
  const tonesApi = { cue: toneLog('cue'), clean: toneLog('clean'), good: toneLog('good'), fix: toneLog('fix'), bell: toneLog('bell'), count: () => {} };
  return { said, tones, ui, stage, voice, tonesApi, frameHandler: () => handler };
}

/**
 * Drive a Learn session with a simulated user who throws `technique` 400 ms
 * after each cue tick, dropping the rear hand on reps listed in `dropOn`.
 */
async function runSession({ technique, respond = 'jab', dropOn = [], maxMs = 300000 }) {
  const f = fakes();
  let progression = new Progression();
  const screen = new LearnScreen({
    bus: { emit() {} }, stage: f.stage,
    settings: { calibration: CALIB, get: () => 'normal' },
    voice: f.voice, tones: f.tonesApi, log: new DebugLog(), techniques,
    progression: () => progression, saveProgress: async () => {},
  });
  await screen.open({ technique });
  const pipe = new PosePipeline({ calibration: CALIB });
  let strikeAt = null;
  let cueCount = 0;
  const ease = u => 0.5 - Math.cos(Math.PI * Math.min(1, Math.max(0, u))) / 2;
  for (let t = 0; t < maxMs && screen.phase !== 'done'; t += 1000 / 30) {
    const cues = f.tones.filter(x => x === 'cue').length;
    if (cues > cueCount) { cueCount = cues; strikeAt = t + 400; }
    let pose = {};
    if (strikeAt !== null && t >= strikeAt) {
      const u = (t - strikeAt) / 550;
      const e = u < 0.36 ? ease(u / 0.36) : u < 0.55 ? 1 : 1 - ease((u - 0.55) / 0.45);
      pose = { [respond]: Math.max(0, e) };
      if (dropOn.includes(cueCount)) pose.dropRear = Math.min(0.8, e * 1.5);
      if (u >= 1) strikeAt = null;
    }
    const fr = frame(pose);
    f.frameHandler()(pipe.process({ t, image: fr.image, world: fr.world }));
    await null;
  }
  return { ...f, screen, progression };
}

test('Learn jab: 3 sets of 8, all detected, summaries spoken, XP and mastery recorded', async () => {
  const r = await runSession({ technique: 'jab' });
  assert.equal(r.screen.phase, 'done');
  assert.equal(r.tones.filter(x => x === 'cue').length, 24);
  assert.equal(r.tones.filter(x => x === 'clean').length, 24);
  assert.ok(r.said.some(s => /^All eight clean\./.test(s)), r.said.join(' | '));
  assert.equal(r.progression.mastery('jab'), 'solid');
  assert.ok(r.progression.data.xp >= 24 * 10);
});

test('Learn jab with the rear hand dropped on 5 of 8: the summary names it', async () => {
  const r = await runSession({ technique: 'jab', dropOn: [1, 3, 4, 6, 8] });
  const summary = r.said.find(s => /clean\./.test(s));
  assert.match(summary, /rear glove glued to your cheek/i, summary);
  assert.ok(r.tones.includes('fix'));
});

test('throwing crosses when asked for jabs counts as wrong technique', async () => {
  const r = await runSession({ technique: 'jab', respond: 'cross' });
  assert.ok(r.said.some(s => /asked for a jab — that looked like a cross/.test(s)), r.said.join(' | '));
  assert.equal(r.tones.filter(x => x === 'clean').length, 0);
});

test('Learn guard hold: three 20 s sets scored in 2 s windows', async () => {
  const r = await runSession({ technique: 'guard', maxMs: 200000 });
  assert.equal(r.screen.phase, 'done');
  assert.equal(r.progression.data.techniques.guard.sets.length, 3);
  assert.equal(r.progression.mastery('guard'), 'solid');
});
