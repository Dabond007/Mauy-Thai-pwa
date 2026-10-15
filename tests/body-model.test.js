import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBody } from '../js/pose/body-model.js';
import { frame } from './helpers/synthetic.js';

const body = (f, calib = null, prev = null, t = 0) => computeBody({ t, ...f }, calib, prev);

test('invalid without landmarks', () => {
  assert.equal(computeBody({ t: 0, image: null, world: null }).valid, false);
});

test('orthodox: lead (left) foot is forward', () => {
  const b = body(frame({ stance: 'orthodox' }), { swapSides: false, stance: 'orthodox' });
  assert.ok(b.stance.leadForward > 0.5, `leadForward ${b.stance.leadForward}`);
});

test('southpaw: lead (right) foot is forward', () => {
  const b = body(frame({ stance: 'southpaw' }), { swapSides: false, stance: 'southpaw' });
  assert.ok(b.stance.leadForward > 0.5);
});

test('swapSides undoes a device that labels left/right the other way round', () => {
  const normal = body(frame(), { swapSides: false, stance: 'orthodox' });
  const swapped = body(frame({ swapLabels: true }), { swapSides: true, stance: 'orthodox' });
  assert.ok(Math.abs(normal.stance.leadForward - swapped.stance.leadForward) < 1e-9);
  assert.ok(Math.abs(normal.joints.lead.wrist.x - swapped.joints.lead.wrist.x) < 1e-9);
  // Without the flag the lead/rear mapping would be wrong:
  const wrong = body(frame({ swapLabels: true }), { swapSides: false, stance: 'orthodox' });
  assert.ok(wrong.stance.leadForward < 0);
});

test('units are shoulder widths', () => {
  const b = body(frame());
  assert.ok(Math.abs(b.liveShoulderWidth - 0.38) < 1e-6);
  assert.ok(Math.abs(b.joints.lead.shoulder.x - 0.5) < 1e-6);
});

test('calibrated shoulder width is the unit when present', () => {
  const b = body(frame(), { shoulderWidthM: 0.76 });
  assert.ok(Math.abs(b.joints.lead.shoulder.x - 0.25) < 1e-6);
});

test('elbow angle uses 3D world landmarks: a jab straight at the camera reads as straight', () => {
  const guard = body(frame());
  const jab = body(frame({ jab: 1 }));
  assert.ok(guard.angles.lead.elbow < 100, `guard elbow ${guard.angles.lead.elbow}`);
  assert.ok(jab.angles.lead.elbow > 150, `jab elbow ${jab.angles.lead.elbow}`);
  assert.ok(jab.reach.lead > guard.reach.lead + 0.5);
});

test('guard height is relative to the nose and to calibration', () => {
  const up = body(frame({ guard: true }), { guard: { lead: { height: -0.16 }, rear: { height: -0.16 } } });
  const down = body(frame({ guard: false }), { guard: { lead: { height: -0.16 }, rear: { height: -0.16 } } });
  assert.ok(Math.abs(up.guard.lead.delta) < 0.05);
  assert.ok(down.guard.lead.delta < -1);
});

test('speeds are per second, independent of frame rate', () => {
  const speedAt = fps => {
    const dt = 1000 / fps;
    const a = body(frame({ jab: 0.2 }), null, null, 0);
    const b = body(frame({ jab: 0.2 + 0.3 * (dt / 100) }), null, a, dt);
    return b.speed.lead.wrist;
  };
  const s30 = speedAt(30);
  const s60 = speedAt(60);
  assert.ok(s30 > 1, `speed ${s30}`);
  assert.ok(Math.abs(s30 - s60) / s30 < 0.05, `30fps ${s30} vs 60fps ${s60}`);
});

test('facing angle reflects torso rotation', () => {
  assert.ok(body(frame()).facing < 1);
  assert.ok(Math.abs(body(frame({ yaw: 40 })).facing - 40) < 1);
});

test('confidence reports the weakest landmark used', () => {
  const b = body(frame({ vis: { 15: 0.3 } }));
  assert.equal(b.confidence.lead.arm, 0.3);
  assert.equal(b.guard.lead.conf, 0.3);
});
