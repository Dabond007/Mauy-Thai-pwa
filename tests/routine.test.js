import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Routine } from '../js/coach/routine.js';

const est = () => 1000;   // every line "takes" 1 s → lead-in 1.8 s

function runTo(r, ms, step = 50) {
  const out = [];
  for (let t = 0; t <= ms; t += step) out.push(...r.update(t).map(a => ({ ...a, t })));
  return out;
}

test('hold, reps and a final line run in order with lead-ins', () => {
  const r = new Routine([
    { id: 'hold', say: 'Hold', holdMs: 2000 },
    { id: 'jab', say: 'Jabs', reps: { count: 3, intervalMs: 1000, label: 'Jab' } },
    { id: 'end', say: 'Done' },
  ], est);
  const out = runTo(r, 20000);
  const cues = out.filter(a => a.type === 'cue');
  assert.deepEqual(cues.map(c => c.rep), [1, 2, 3]);
  // Hold step: 1.8 s lead-in + 2 s hold → jabs start at 3.8 s, first cue after another 1.8 s.
  assert.ok(Math.abs(cues[0].t - 5600) <= 50, `first cue at ${cues[0].t}`);
  assert.ok(Math.abs(cues[1].t - cues[0].t - 1000) <= 50);
  assert.deepEqual(out.filter(a => a.type === 'say').map(a => a.text), ['Hold', 'Jabs', 'Done']);
  assert.equal(out.at(-1).type, 'done');
  assert.equal(r.done, true);
});

test('time not passed in (user out of frame) pauses the routine', () => {
  const r = new Routine([{ id: 'jab', say: 'Jabs', reps: { count: 4, intervalMs: 1000, label: 'Jab' } }], est);
  runTo(r, 2900);                       // lead-in 1.8 s, cues at 1.8 and 2.8
  // Frozen at 2900 for a while: nothing new.
  assert.deepEqual(r.update(2900), []);
  const later = r.update(3800);
  assert.equal(later.filter(a => a.type === 'cue').length, 1);
});

test('walkout step waits for walkoutDone()', () => {
  const r = new Routine([
    { id: 'walk', say: 'Walk out', walkout: true },
    { id: 'end', say: 'Done' },
  ], est);
  runTo(r, 10000);
  assert.equal(r.step.id, 'walk');
  r.walkoutDone();
  const out = r.update(10050);
  assert.ok(out.some(a => a.type === 'say' && a.text === 'Done'));
});

test('remainingMs counts down to zero', () => {
  const r = new Routine([{ id: 'hold', say: 'Hold', holdMs: 2000 }], est);
  r.update(0);
  assert.equal(r.remainingMs(0), 3800);
  assert.equal(r.remainingMs(3000), 800);
});
