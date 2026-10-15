import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OneEuroFilter, LandmarkFilter } from '../js/pose/filter.js';

function noise(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647 - 0.5;
  };
}

test('first sample passes through unchanged', () => {
  const f = new OneEuroFilter({ minCutoff: 1, beta: 0 });
  assert.equal(f.filter(0.42, 0), 0.42);
});

test('reduces jitter when the signal is still', () => {
  const f = new OneEuroFilter({ minCutoff: 1, beta: 20 });
  const rnd = noise(7);
  let rawVar = 0;
  let outVar = 0;
  const n = 300;
  for (let i = 0; i < n; i++) {
    const raw = 0.5 + rnd() * 0.01;
    const out = f.filter(raw, i / 30);
    if (i > 30) {
      rawVar += (raw - 0.5) ** 2;
      outVar += (out - 0.5) ** 2;
    }
  }
  assert.ok(outVar < rawVar * 0.3, `filtered variance ${outVar} should be well below raw ${rawVar}`);
});

test('tracks a fast movement with little lag (speed raises the cutoff)', () => {
  const adaptive = new OneEuroFilter({ minCutoff: 1, beta: 20 });
  const fixed = new OneEuroFilter({ minCutoff: 1, beta: 0 });
  let a = 0;
  let b = 0;
  // 0 → 0.6 in 200 ms (a punch-like move across the frame), sampled at 30 fps.
  for (let i = 0; i <= 6; i++) {
    const x = Math.min(0.6, i * 0.1);
    a = adaptive.filter(x, i / 30);
    b = fixed.filter(x, i / 30);
  }
  assert.ok(Math.abs(0.6 - a) < 0.1, `adaptive lag ${0.6 - a}`);
  assert.ok(0.6 - a < 0.6 - b, 'adaptive filter must lag less than a fixed low-pass');
});

test('behaviour depends on time, not frame count', () => {
  const run = fps => {
    const f = new OneEuroFilter({ minCutoff: 1, beta: 0 });
    let out = 0;
    for (let t = 0; t <= 0.5 + 1e-9; t += 1 / fps) out = f.filter(t === 0 ? 0 : 1, t);
    return out;
  };
  const at30 = run(30);
  const at60 = run(60);
  assert.ok(Math.abs(at30 - at60) < 0.05, `30fps ${at30} vs 60fps ${at60}`);
});

test('LandmarkFilter restarts after a long gap instead of smearing', () => {
  const lf = new LandmarkFilter({ minCutoff: 0.5, beta: 0, dCutoff: 1 }, 500);
  const lm = x => [{ x, y: 0, z: 0, visibility: 0.9 }];
  lf.filter(lm(0), 0);
  lf.filter(lm(0), 33);
  const after = lf.filter(lm(1), 2000);
  assert.equal(after[0].x, 1);
  assert.equal(after[0].visibility, 0.9);
});
