import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RepDetector } from '../js/technique/rep-detector.js';
import { evaluateRep } from '../js/technique/form-eval.js';
import { GuardMonitor, summarizeSet, pickFocus, PraiseTracker } from '../js/coach/coach.js';
import { sequence, guardHold, jabRep, CALIB } from './helpers/reps.js';

const JAB = JSON.parse(readFileSync(new URL('../data/techniques/jab.json', import.meta.url), 'utf8'));

function jabSet(dropOn) {
  const segs = [guardHold(800)];
  for (let i = 0; i < 8; i++) segs.push(...jabRep(dropOn.includes(i) ? { dropRear: 0.8 } : {}), guardHold(900));
  const det = new RepDetector(CALIB);
  const results = [];
  for (const f of sequence(segs)) {
    const r = det.update(f);
    if (r?.type === 'rep') results.push(evaluateRep(JAB, r, CALIB));
  }
  return results;
}

test('exit criterion: dropping the rear hand on 5 of 8 jabs gives that focus cue', () => {
  const results = jabSet([0, 2, 3, 5, 7]);
  assert.equal(results.length, 8);
  const s = summarizeSet({ def: JAB, results });
  assert.equal(s.focus.id, 'other_hand_guard');
  assert.match(s.lines.at(-1), /rear glove glued to your cheek/i);
  assert.equal(s.lines[0], 'Three of eight clean.');
  assert.ok(s.lines.length <= 3);
});

test('a clean set praises and says "same again"', () => {
  const s = summarizeSet({ def: JAB, results: jabSet([]) });
  assert.equal(s.lines[0], 'All eight clean.');
  assert.equal(s.focus, null);
  assert.match(s.lines.at(-1), /same again/i);
  assert.ok(s.positive);
});

test('bandwidth: one guard slip in eight is left alone', () => {
  assert.equal(pickFocus(JAB, jabSet([4])), null);
});

test('summary sentences stay short (≤ 12 words)', () => {
  for (const drops of [[], [1, 2], [0, 1, 2, 3, 4, 5, 6, 7]]) {
    for (const line of summarizeSet({ def: JAB, results: jabSet(drops) }).lines) {
      assert.ok(line.split(/\s+/).length <= 12, line);
    }
  }
});

test('wrong technique twice is called out', () => {
  const wrong = { rating: 'missed', wrongTechnique: true, technique: 'cross', checks: {} };
  const s = summarizeSet({ def: JAB, results: [wrong, wrong, ...jabSet([]).slice(0, 6)] });
  assert.ok(s.lines.some(l => /asked for a jab/i.test(l)), s.lines.join(' | '));
});

test('sharp mastery: summaries are not spoken', () => {
  assert.equal(summarizeSet({ def: JAB, results: jabSet([]), mastery: 'sharp' }).speak, false);
});

test('"Hands up" fires within 2 s of hands dropping between reps, then respects limits', () => {
  const m = new GuardMonitor();
  const frames = sequence([guardHold(500), [6000, () => ({ guard: false })], guardHold(500), [6000, () => ({ guard: false })], [20000, () => ({ guard: false })]]);
  const fired = [];
  for (const f of frames) if (m.update(f, false)) fired.push(f.t);
  assert.ok(fired[0] - 500 <= 2000, `first at ${fired[0]}`);
  assert.equal(fired.length, 2, 'max 2 per set');
  assert.ok(fired[1] - fired[0] >= 10000, '10 s cooldown');
});

test('"Hands up" never fires during a strike', () => {
  const m = new GuardMonitor();
  const frames = sequence([[4000, () => ({ guard: false })]]);
  assert.equal(frames.filter(f => m.update(f, true)).length, 0);
});

test('"That\'s it" once after the focused fault is fixed', () => {
  const p = new PraiseTracker(1);
  p.setFocus('other_hand_guard');
  const good = jabSet([])[0];
  assert.equal(p.onRep(good), true);
  assert.equal(p.onRep(good), false);
});
