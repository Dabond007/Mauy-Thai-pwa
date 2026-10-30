import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RepDetector } from '../js/technique/rep-detector.js';
import { evaluateRep, evaluateHold, RATING } from '../js/technique/form-eval.js';
import { sequence, guardHold, jabRep, crossRep, CALIB } from './helpers/reps.js';

const def = id => JSON.parse(readFileSync(new URL(`../data/techniques/${id}.json`, import.meta.url), 'utf8'));
const JAB = def('jab');
const CROSS = def('cross');
const GUARD = def('guard');
const STANCE = def('stance');

function firstRep(segments) {
  const det = new RepDetector(CALIB);
  for (const f of sequence(segments)) {
    const r = det.update(f);
    if (r?.type === 'rep') return r;
  }
  return null;
}

test('a clean jab is rated clean', () => {
  const rep = firstRep([guardHold(600), ...jabRep(), guardHold(400)]);
  const ev = evaluateRep(JAB, rep, CALIB);
  assert.equal(ev.checks.other_hand_guard.result, 'pass');
  assert.equal(ev.checks.return_to_guard.result, 'pass');
  assert.equal(ev.rating, RATING.CLEAN, JSON.stringify(ev.checks));
});

test('dropping the rear hand on a jab is a major fault (Fix)', () => {
  const rep = firstRep([guardHold(600), ...jabRep({ dropRear: 0.8 }), guardHold(400)]);
  const ev = evaluateRep(JAB, rep, CALIB);
  assert.equal(ev.checks.other_hand_guard.result, 'fail');
  assert.equal(ev.rating, RATING.FIX);
  assert.deepEqual(ev.faults, ['other_hand_guard']);
});

test('a slow return to guard is a fault', () => {
  const rep = firstRep([guardHold(600), [200, u => ({ jab: u })], [900, () => ({ jab: 1 })], [250, u => ({ jab: 1 - u })], guardHold(400)]);
  const ev = evaluateRep(JAB, rep, CALIB);
  assert.equal(ev.checks.return_to_guard.result, 'fail');
});

test('a cross with turn and pivot is clean; without pivot it is Good (minor fault)', () => {
  const good = evaluateRep(CROSS, firstRep([guardHold(600), ...crossRep({ pivot: 60 }), guardHold(400)]), CALIB);
  assert.equal(good.checks.rotation.result, 'pass', JSON.stringify(good.checks.rotation));
  assert.equal(good.checks.pivot.result, 'pass', JSON.stringify(good.checks.pivot));
  assert.equal(good.rating, RATING.CLEAN, JSON.stringify(good.checks));

  const flat = evaluateRep(CROSS, firstRep([guardHold(600), ...crossRep({ pivot: 0 }), guardHold(400)]), CALIB);
  assert.equal(flat.checks.pivot.result, 'fail');
  assert.equal(flat.rating, RATING.GOOD);
});

test('a cross without shoulder turn fails rotation (major)', () => {
  const ev = evaluateRep(CROSS, firstRep([guardHold(600), ...crossRep({ turn: 5, pivot: 60 }), guardHold(400)]), CALIB);
  assert.equal(ev.checks.rotation.result, 'fail');
  assert.equal(ev.rating, RATING.FIX);
});

test('wrong technique counts as missed', () => {
  const ev = evaluateRep(JAB, firstRep([guardHold(600), ...crossRep(), guardHold(400)]), CALIB);
  assert.equal(ev.rating, RATING.MISSED);
  assert.equal(ev.wrongTechnique, true);
});

test('hidden landmarks make a check unknown, never a silent pass', () => {
  const rep = firstRep([guardHold(600), ...jabRep({ dropRear: 0.8, vis: { 16: 0.2 } }), guardHold(400)]);
  const ev = evaluateRep(JAB, rep, CALIB);
  assert.equal(ev.checks.other_hand_guard.result, 'unknown');
  assert.equal(ev.rating, RATING.CLEAN);   // unknown checks are ignored
});

test('extension is unknown until reach is calibrated', () => {
  const det = new RepDetector({ ...CALIB, reach: null });
  let rep;
  for (const f of sequence([guardHold(600), ...jabRep(), guardHold(400)], { calib: { ...CALIB, reach: null } })) {
    const r = det.update(f); if (r?.type === 'rep') rep = r;
  }
  assert.equal(evaluateRep(JAB, rep, { ...CALIB, reach: null }).checks.extension.result, 'unknown');
});

test('guard hold: hands up passes, hands down fails', () => {
  const up = evaluateHold(GUARD, sequence([guardHold(2000)]), CALIB);
  assert.equal(up.rating, RATING.CLEAN, JSON.stringify(up.checks));
  const down = evaluateHold(GUARD, sequence([[2000, () => ({ guard: false })]]), CALIB);
  assert.equal(down.checks.hands_up.result, 'fail');
  assert.equal(down.rating, RATING.FIX);
});

test('stance hold: right foot forward fails for an orthodox fighter', () => {
  const ok = evaluateHold(STANCE, sequence([guardHold(2000)]), CALIB);
  assert.equal(ok.checks.lead_foot_forward.result, 'pass');
  const wrong = evaluateHold(STANCE, sequence([[2000, () => ({ stance: 'southpaw' })]]), CALIB);
  assert.equal(wrong.checks.lead_foot_forward.result, 'fail');
});
