import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DebugLog, decodeFrame } from '../js/debug/log.js';
import { frame } from './helpers/synthetic.js';

test('frames round-trip through the compact log format', () => {
  const log = new DebugLog();
  log.enabled = true;
  const f = frame({ jab: 0.5 });
  log.frame({ t: 1000, image: f.image, world: f.world, inferenceMs: 12.345 });
  const back = decodeFrame(log.frames[0]);
  assert.equal(back.t, 1000);
  assert.ok(Math.abs(back.image[15].x - f.image[15].x) < 1e-4);
  assert.ok(Math.abs(back.world[15].z - f.world[15].z) < 1e-4);
  assert.ok(Math.abs(back.image[15].visibility - f.image[15].visibility) < 0.01);
});

test('nothing is recorded unless enabled', () => {
  const log = new DebugLog();
  const f = frame();
  log.frame({ t: 0, image: f.image, world: f.world });
  log.event('x');
  assert.equal(log.frames.length, 0);
  assert.equal(log.events.length, 0);
});

test('keeps only the last maxSeconds of frames', () => {
  const log = new DebugLog({ maxSeconds: 2 });
  log.enabled = true;
  for (let t = 0; t <= 5000; t += 100) log.frame({ t, image: null, world: null });
  assert.ok(log.frames[0].t >= 3000);
  assert.ok(log.seconds <= 2);
});
