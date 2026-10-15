import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Calibrator, STEPS, calibrationDue, CALIBRATION_VERSION } from '../js/pose/calibration.js';
import { frame, jitter } from './helpers/synthetic.js';

const STEP = 1000 / 30;

function run(cal, ms, make, t0) {
  let t = t0;
  const events = [];
  for (const end = t0 + ms; t < end; t += STEP) {
    const r = cal.update({ t, ...make(t) });
    if (r.event) events.push(r.event);
  }
  return { t, events };
}

function calibrate({ swapLabels = false, stance = 'orthodox', jabs = 3 } = {}) {
  const cal = new Calibrator();
  let t = 0;
  // Idle, then raise the real left hand.
  ({ t } = run(cal, 500, () => frame({ swapLabels, stance }), t));
  assert.equal(cal.step, STEPS.HANDEDNESS);
  ({ t } = run(cal, 1300, () => frame({ swapLabels, stance, raise: 'left' }), t));
  assert.equal(cal.step, STEPS.STANCE);

  // Hold the stance (with a little tracking jitter).
  let i = 0;
  ({ t } = run(cal, 2600, () => jitter(frame({ swapLabels, stance }), 0.004, ++i), t));
  assert.equal(cal.step, STEPS.CONFIRM_STANCE);
  const proposal = cal.proposal;
  cal.confirmStance(proposal.stance);
  assert.equal(cal.step, STEPS.REACH);

  // Three slow jabs: 0.4 s out, 0.4 s back, 0.3 s in guard.
  for (let k = 0; k < jabs; k++) {
    ({ t } = run(cal, 400, tt => frame({ swapLabels, stance, jab: Math.min(1, (tt % 1100) / 400) }), t));
    ({ t } = run(cal, 400, () => frame({ swapLabels, stance, jab: 1 }), t));
    ({ t } = run(cal, 300, () => frame({ swapLabels, stance }), t));
  }
  return { cal, proposal, t };
}

test('handedness: raising the real left hand keeps MediaPipe labels', () => {
  const { cal } = calibrate();
  assert.equal(cal.result.swapSides, false);
  assert.equal(cal.result.handednessChecked, true);
});

test('handedness: swapped labels are detected and recorded', () => {
  const { cal } = calibrate({ swapLabels: true });
  assert.equal(cal.result.swapSides, true);
});

test('stance proposal: orthodox and southpaw, with high confidence when cues agree', () => {
  const o = calibrate({ stance: 'orthodox' });
  assert.equal(o.proposal.stance, 'orthodox');
  assert.equal(o.proposal.confidence, 'high');
  const s = calibrate({ stance: 'southpaw' });
  assert.equal(s.proposal.stance, 'southpaw');
  const sw = calibrate({ stance: 'southpaw', swapLabels: true });
  assert.equal(sw.proposal.stance, 'southpaw');
});

test('stance measurements are stored in body units', () => {
  const { cal } = calibrate();
  const r = cal.result;
  assert.ok(Math.abs(r.shoulderWidthM - 0.38) < 0.02, `shoulder ${r.shoulderWidthM}`);
  assert.ok(r.stanceWidth > 1 && r.stanceWidth < 2.5, `stanceWidth ${r.stanceWidth}`);
  assert.ok(Math.abs(r.guard.lead.height + 0.16) < 0.05, `guard ${r.guard.lead.height}`);
  assert.ok(Math.abs(r.guard.rear.height + 0.16) < 0.05);
  assert.ok(Number.isFinite(r.torsoLean));
  assert.ok(Number.isFinite(r.elbows.lead.out));
});

test('reach: three jabs give the full-extension reach', () => {
  const { cal } = calibrate();
  assert.equal(cal.step, STEPS.DONE);
  // Synthetic arm reaches 0.584 m with 0.38 m shoulders → ~1.54 units.
  assert.ok(Math.abs(cal.result.reach.lead - 1.54) < 0.08, `reach ${cal.result.reach.lead}`);
  assert.ok(cal.result.reach.elbowAngle > 150);
  assert.equal(cal.result.version, CALIBRATION_VERSION);
});

test('reach can be skipped and times out on its own', () => {
  const { cal, t } = calibrate({ jabs: 1 });
  assert.equal(cal.step, STEPS.REACH);
  run(cal, 31000, () => frame(), t);
  assert.equal(cal.step, STEPS.DONE);
  assert.equal(cal.result.reach, null);
});

test('handedness: both hands up does not count; other hand in a high guard does', () => {
  const both = new Calibrator();
  run(both, 2000, () => frame({ raise: 'left', move: { 16: [0, -0.55, 0.25] } }), 0);
  assert.equal(both.step, STEPS.HANDEDNESS);

  const highGuard = new Calibrator();
  // Right glove at eyebrow height (above the nose) while the left hand is raised.
  run(highGuard, 1500, () => frame({ raise: 'left', move: { 16: [0, -0.1, 0] } }), 0);
  assert.equal(highGuard.step, STEPS.STANCE);
  assert.equal(highGuard.result.swapSides, false);
});

test('moving around does not complete the stance step', () => {
  const cal = new Calibrator();
  cal.skipHandedness();
  run(cal, 4000, t => frame({ jab: (Math.sin(t / 150) + 1) / 2 }), 0);
  assert.equal(cal.step, STEPS.STANCE);
});

test('calibration is due when missing, outdated or older than 7 days', () => {
  const now = Date.now();
  assert.equal(calibrationDue(null, now), true);
  assert.equal(calibrationDue({ version: CALIBRATION_VERSION, createdAt: now - 1000 }, now), false);
  assert.equal(calibrationDue({ version: CALIBRATION_VERSION, createdAt: now - 8 * 86400e3 }, now), true);
  assert.equal(calibrationDue({ version: 0, createdAt: now }, now), true);
});
