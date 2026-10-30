import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RepDetector } from '../js/technique/rep-detector.js';
import { sequence, guardHold, jabRep, crossRep, CALIB } from './helpers/reps.js';

function run(frames, calib = CALIB) {
  const det = new RepDetector(calib);
  const out = [];
  for (const f of frames) {
    const r = det.update(f);
    if (r?.type === 'rep') out.push(r);
  }
  return out;
}

test('a jab is detected and identified as a jab', () => {
  const reps = run(sequence([guardHold(600), ...jabRep(), guardHold(600)]));
  assert.equal(reps.length, 1);
  assert.equal(reps[0].technique, 'jab');
  assert.equal(reps[0].arm, 'lead');
  assert.ok(reps[0].tPeak > reps[0].tStart && reps[0].tEnd > reps[0].tPeak);
});

test('a cross is detected and identified as a cross', () => {
  const reps = run(sequence([guardHold(600), ...crossRep(), guardHold(600)]));
  assert.equal(reps.length, 1);
  assert.equal(reps[0].technique, 'cross');
});

test('jab, cross, jab in a row gives three correctly labelled reps', () => {
  const reps = run(sequence([guardHold(500), ...jabRep(), guardHold(500), ...crossRep(), guardHold(500), ...jabRep(), guardHold(500)]));
  assert.deepEqual(reps.map(r => r.technique), ['jab', 'cross', 'jab']);
});

test('60 s of idle stance with tracking jitter produces zero reps', () => {
  const reps = run(sequence([guardHold(60000)], { jitterAmt: 0.01 }));
  assert.equal(reps.length, 0);
});

test('dropping the hands to the hips is not a punch', () => {
  const reps = run(sequence([
    guardHold(500),
    [400, u => ({ dropRear: u })],
    [1000, () => ({ dropRear: 1 })],
    [400, u => ({ dropRear: 1 - u })],
    guardHold(500),
  ]));
  assert.equal(reps.length, 0);
});

test('a half-hearted extension does not count', () => {
  const reps = run(sequence([guardHold(500), [200, u => ({ jab: 0.3 * u })], [300, u => ({ jab: 0.3 * (1 - u) })], guardHold(500)]));
  assert.equal(reps.length, 0);
});

test('works without calibrated reach (fallback scale)', () => {
  const reps = run(sequence([guardHold(500), ...jabRep(), guardHold(500)]), { ...CALIB, reach: null });
  assert.equal(reps.length, 1);
  assert.equal(reps[0].technique, 'jab');
});

test('detection does not depend on frame rate', () => {
  for (const fps of [20, 30, 60]) {
    const reps = run(sequence([guardHold(500), ...jabRep(), guardHold(500), ...crossRep(), guardHold(500)], { fps }));
    assert.deepEqual(reps.map(r => r.technique), ['jab', 'cross'], `at ${fps} fps`);
  }
});

test('striking flag is set during the rep only', () => {
  const det = new RepDetector(CALIB);
  const frames = sequence([guardHold(300), ...jabRep(), guardHold(300)]);
  const flags = frames.map(f => { det.update(f); return det.striking; });
  assert.equal(flags[0], false);
  assert.ok(flags.includes(true));
  assert.equal(flags.at(-1), false);
});
