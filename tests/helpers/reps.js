/**
 * tests/helpers/reps.js — timed synthetic strike sequences as pipeline-like frames.
 */
import { computeBody } from '../../js/pose/body-model.js';
import { frame, jitter } from './synthetic.js';

export const CALIB = Object.freeze({
  version: 1, swapSides: false, stance: 'orthodox', shoulderWidthM: 0.38,
  stanceWidth: 1.58, guard: { lead: { height: -0.16 }, rear: { height: -0.16 } },
  elbows: { lead: { out: -0.05 }, rear: { out: -0.05 } },
  guardReach: { lead: 0.75, rear: 0.75 }, guardElbow: { lead: 67, rear: 67 },
  torsoLean: 0, shoulderYaw: 180, hipYaw: 180, reach: { lead: 1.54, elbowAngle: 175 },
});

/**
 * @param {Array<[ms:number, (u:number)=>object]>} segments  duration and pose(u∈0..1) per segment
 * @param {object} [o] { fps, jitter, calib, t0 }
 */
export function sequence(segments, { fps = 30, jitterAmt = 0, calib = CALIB, t0 = 0 } = {}) {
  const out = [];
  let t = t0;
  let prev = null;
  let seed = 1;
  for (const [ms, pose] of segments) {
    const n = Math.max(1, Math.round((ms / 1000) * fps));
    for (let i = 0; i < n; i++) {
      let f = frame(pose(i / Math.max(1, n - 1)));
      if (jitterAmt) f = jitter(f, jitterAmt, ++seed);
      const body = computeBody({ t, ...f }, calib, prev);
      prev = body;
      out.push({ t, image: f.image, world: f.world, body, glitch: false });
      t += 1000 / fps;
    }
  }
  return out;
}

const ease = u => 0.5 - Math.cos(Math.PI * u) / 2;
export const guardHold = ms => [ms, () => ({})];
export const jabRep = (extra = {}) => [
  [200, u => ({ jab: ease(u), ...extra })],
  [100, () => ({ jab: 1, ...extra })],
  [250, u => ({ jab: 1 - ease(u), ...extra })],
];
export const crossRep = (extra = {}) => [
  [250, u => ({ cross: ease(u), ...extra })],
  [100, () => ({ cross: 1, ...extra })],
  [300, u => ({ cross: 1 - ease(u), ...extra })],
];
