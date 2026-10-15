import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFraming, FramingMonitor } from '../js/pose/framing.js';
import { LM } from '../js/pose/landmarks.js';
import { frame } from './helpers/synthetic.js';

test('well-placed user is green', () => {
  const f = frame();
  const r = evaluateFraming(f.image, f.world);
  assert.equal(r.status, 'green', JSON.stringify(r.issues));
  assert.equal(r.tip, null);
});

test('no person is red', () => {
  const r = evaluateFraming(null, null);
  assert.equal(r.status, 'red');
  assert.equal(r.issues[0].id, 'no_person');
});

test('feet not visible is red with "step back" tip', () => {
  const low = 0.2;
  const f = frame({ vis: { [LM.L_ANKLE]: low, [LM.R_ANKLE]: low, [LM.L_HEEL]: low, [LM.R_HEEL]: low } });
  const r = evaluateFraming(f.image, f.world);
  assert.equal(r.status, 'red');
  assert.equal(r.tip, 'Step back until I can see your feet');
});

test('too far away asks to come closer', () => {
  const f = frame({ distance: 4.5 });
  const r = evaluateFraming(f.image, f.world);
  assert.equal(r.status, 'amber');
  assert.equal(r.issues[0].id, 'too_far');
  assert.equal(r.tip, 'Come a little closer');
});

test('too close asks to step back', () => {
  const f = frame({ distance: 2.0 });
  const r = evaluateFraming(f.image, f.world);
  assert.ok(['too_close', 'edge'].includes(r.issues[0]?.id), JSON.stringify(r.issues));
  assert.match(r.tip, /step back/i);
});

test('off-centre directions match what the user sees in the mirrored preview', () => {
  // +offsetX moves the person toward their own left, i.e. the left of the
  // mirrored screen, so they should move to their right.
  const toLeft = frame({ offsetX: 0.45 });
  const r1 = evaluateFraming(toLeft.image, toLeft.world);
  assert.equal(r1.tip, 'Move a little to your right');

  const toRight = frame({ offsetX: -0.45 });
  const r2 = evaluateFraming(toRight.image, toRight.world);
  assert.equal(r2.tip, 'Move a little to your left');
});

test('turned side-on asks the user to face the phone', () => {
  const f = frame({ yaw: 70 });
  const r = evaluateFraming(f.image, f.world);
  assert.ok(r.issues.some(i => i.id === 'facing'), JSON.stringify(r.issues));
});

test('normal fighting-stance rotation does not trigger the facing tip', () => {
  const f = frame({ yaw: 30 });
  const r = evaluateFraming(f.image, f.world);
  assert.ok(!r.issues.some(i => i.id === 'facing'));
});

test('lighting tip needs 2 s of low visibility', () => {
  const m = new FramingMonitor();
  const f = frame({ visibility: 0.65 });
  let r = m.update(f.image, f.world, 0);
  assert.ok(!r.issues.some(i => i.id === 'lighting'));
  r = m.update(f.image, f.world, 1900);
  assert.ok(!r.issues.some(i => i.id === 'lighting'));
  r = m.update(f.image, f.world, 2100);
  assert.ok(r.issues.some(i => i.id === 'lighting'));
  assert.equal(r.status, 'amber');
});

test('spoken tips are throttled to one per 5 s', () => {
  const m = new FramingMonitor();
  const f = frame({ distance: 4.5 });
  assert.equal(m.update(f.image, f.world, 0).speak, 'Come a little closer');
  assert.equal(m.update(f.image, f.world, 2000).speak, null);
  assert.equal(m.update(f.image, f.world, 4999).speak, null);
  assert.equal(m.update(f.image, f.world, 5000).speak, 'Come a little closer');
});

test('greenForMs counts continuous green time', () => {
  const m = new FramingMonitor();
  const good = frame();
  const bad = frame({ distance: 4.5 });
  m.update(good.image, good.world, 0);
  assert.equal(m.update(good.image, good.world, 1000).greenForMs, 1000);
  m.update(bad.image, bad.world, 1100);
  assert.equal(m.update(good.image, good.world, 1200).greenForMs, 0);
});
