/**
 * tests/helpers/synthetic.js — synthetic MediaPipe-style landmark frames.
 *
 * World coordinates follow MediaPipe's convention: metres, origin between the
 * hips, x toward the image's right (the person's anatomical LEFT when facing
 * the camera), y down, z smaller = closer to the camera. Image landmarks are
 * produced with a simple pinhole projection of a portrait 720×1280 camera at
 * waist height, `distance` metres in front of the hips.
 */

import { LM, NUM_LANDMARKS } from '../../js/pose/landmarks.js';

const W = 720;
const H = 1280;
const FOCAL = 1300;
const CAM_Y = -0.05;

const L = 1;   // anatomical left → +x
const R = -1;

function basePose({ stance = 'orthodox', guard = true } = {}) {
  const leadSign = stance === 'southpaw' ? R : L;
  const p = {};
  p[LM.NOSE] = [0, -0.68, -0.1];
  p[LM.L_SHOULDER] = [0.19 * L, -0.5, 0];
  p[LM.R_SHOULDER] = [0.19 * R, -0.5, 0];
  p[LM.L_HIP] = [0.12 * L, 0, 0];
  p[LM.R_HIP] = [0.12 * R, 0, 0];

  for (const side of [L, R]) {
    const isLead = side === leadSign;
    const fz = isLead ? -0.25 : 0.2;   // lead foot closer to the camera
    const idx = side === L
      ? { elbow: LM.L_ELBOW, wrist: LM.L_WRIST, knee: LM.L_KNEE, ankle: LM.L_ANKLE, heel: LM.L_HEEL, foot: LM.L_FOOT }
      : { elbow: LM.R_ELBOW, wrist: LM.R_WRIST, knee: LM.R_KNEE, ankle: LM.R_ANKLE, heel: LM.R_HEEL, foot: LM.R_FOOT };
    if (guard) {
      p[idx.elbow] = [0.17 * side, -0.35, -0.15];
      p[idx.wrist] = [0.12 * side, -0.62, -0.25];
    } else {
      p[idx.elbow] = [0.22 * side, -0.25, 0];
      p[idx.wrist] = [0.22 * side, 0.0, 0];
    }
    p[idx.knee] = [0.17 * side, 0.45, fz * 0.6 - 0.03];
    p[idx.ankle] = [0.2 * side, 0.88, fz];
    p[idx.heel] = [0.2 * side, 0.93, fz + 0.05];
    p[idx.foot] = [0.21 * side, 0.94, fz - 0.15];
  }
  return p;
}

/** Fill the face/hand landmarks we don't model with plausible neighbours. */
function fillRest(p) {
  const near = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0,
    17: 15, 19: 15, 21: 15, 18: 16, 20: 16, 22: 16 };
  for (let i = 0; i < NUM_LANDMARKS; i++) {
    if (!p[i]) p[i] = [...p[near[i] ?? 0]];
  }
  return p;
}

function project([x, y, z], { distance, offsetX }) {
  const depth = distance + z;
  return {
    x: 0.5 + (FOCAL * (x + offsetX)) / (depth * W),
    y: 0.5 + (FOCAL * (y - CAM_Y)) / (depth * H),
    z: z / 2,
  };
}

/** Rotate the whole body about the vertical axis (degrees; turning the torso). */
function rotateY(p, deg) {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  for (const k of Object.keys(p)) {
    const [x, y, z] = p[k];
    p[k] = [x * c - z * s, y, x * s + z * c];
  }
}

/**
 * Build one frame.
 * @param {object} o
 * @param {'orthodox'|'southpaw'} [o.stance]
 * @param {boolean} [o.guard]           hands up at the cheeks
 * @param {'left'|'right'|null} [o.raise]  anatomical hand raised above the head
 * @param {number} [o.jab]              0..1 extension of the lead hand toward the camera
 * @param {number} [o.distance]         metres from the camera
 * @param {number} [o.offsetX]          metres sideways (toward the person's left)
 * @param {number} [o.yaw]              body rotation in degrees
 * @param {number} [o.visibility]
 * @param {Object<number, number>} [o.vis]  per-landmark visibility overrides
 * @param {boolean} [o.swapLabels]      emulate a device whose L/R labels are swapped
 * @param {Object<number, number[]>} [o.move]  per-landmark world offsets [dx,dy,dz]
 * @param {number} [o.cross]            0..1 rear hand to the target, with shoulder turn
 * @param {number} [o.pivot]            rear-foot pivot in degrees (scaled by cross)
 * @param {number} [o.turn]             shoulder/hip turn in degrees at full cross (default 45)
 * @param {number} [o.dropRear]         0..1 rear hand drops from guard to the hip
 */
export function frame(o = {}) {
  const {
    stance = 'orthodox', guard = true, raise = null, jab = 0,
    distance = 2.8, offsetX = 0, yaw = 0, visibility = 0.95, vis = {},
    swapLabels = false, move = {}, cross = 0, pivot = 0, turn = 45, dropRear = 0,
  } = o;

  const p = basePose({ stance, guard });

  if (raise) {
    const side = raise === 'left' ? L : R;
    const [e, w] = side === L ? [LM.L_ELBOW, LM.L_WRIST] : [LM.R_ELBOW, LM.R_WRIST];
    p[e] = [0.22 * side, -0.85, 0];
    p[w] = [0.22 * side, -1.15, 0];
  }

  if (jab > 0) {
    const leadSign = stance === 'southpaw' ? R : L;
    const [e, w] = leadSign === L ? [LM.L_ELBOW, LM.L_WRIST] : [LM.R_ELBOW, LM.R_WRIST];
    const g = p[w];
    const ext = [0.12 * leadSign, -0.5, -0.584];
    p[w] = g.map((v, i) => v + (ext[i] - v) * jab);
    const sh = p[leadSign === L ? LM.L_SHOULDER : LM.R_SHOULDER];
    const bend = 0.12 * (1 - jab);
    p[e] = [(sh[0] + p[w][0]) / 2 + 0.03 * leadSign * (1 - jab), (sh[1] + p[w][1]) / 2 + bend, (sh[2] + p[w][2]) / 2];
  }

  const leadSign = stance === 'southpaw' ? R : L;
  const rearSign = -leadSign;
  const rearIdx = rearSign === L
    ? { sh: LM.L_SHOULDER, e: LM.L_ELBOW, w: LM.L_WRIST, a: LM.L_ANKLE, h: LM.L_HEEL, t: LM.L_FOOT }
    : { sh: LM.R_SHOULDER, e: LM.R_ELBOW, w: LM.R_WRIST, a: LM.R_ANKLE, h: LM.R_HEEL, t: LM.R_FOOT };

  if (dropRear > 0) {
    const low = { w: [0.24 * rearSign, -0.05, -0.05], e: [0.24 * rearSign, -0.28, 0] };
    p[rearIdx.w] = p[rearIdx.w].map((v, i) => v + (low.w[i] - v) * dropRear);
    p[rearIdx.e] = p[rearIdx.e].map((v, i) => v + (low.e[i] - v) * dropRear);
  }

  if (cross > 0) {
    // Upper body turns (rear shoulder forward), rear arm extends to the target.
    const upper = [LM.NOSE, LM.L_SHOULDER, LM.R_SHOULDER, LM.L_ELBOW, LM.R_ELBOW, LM.L_WRIST, LM.R_WRIST];
    const a = (-rearSign * turn * cross * Math.PI) / 180;
    for (const k of upper) {
      const [x, y, z] = p[k];
      p[k] = [x * Math.cos(a) - z * Math.sin(a), y, x * Math.sin(a) + z * Math.cos(a)];
    }
    const sh = p[rearIdx.sh];
    const ext = [0.02 * rearSign, -0.5, sh[2] - 0.6];
    const g = p[rearIdx.w];
    p[rearIdx.w] = g.map((v, i) => v + (ext[i] - v) * cross);
    const bend = 0.12 * (1 - cross);
    p[rearIdx.e] = [(sh[0] + p[rearIdx.w][0]) / 2 + 0.03 * rearSign * (1 - cross), (sh[1] + p[rearIdx.w][1]) / 2 + bend, (sh[2] + p[rearIdx.w][2]) / 2];
    // Rear foot pivots about its ankle.
    if (pivot) {
      const b = (pivot * cross * Math.PI) / 180;
      const an = p[rearIdx.a];
      for (const k of [rearIdx.h, rearIdx.t]) {
        const dx = p[k][0] - an[0];
        const dz = p[k][2] - an[2];
        p[k] = [an[0] + dx * Math.cos(b) - dz * Math.sin(b), p[k][1], an[2] + dx * Math.sin(b) + dz * Math.cos(b)];
      }
    }
  }

  for (const [k, d] of Object.entries(move)) {
    p[k] = p[k].map((v, i) => v + d[i]);
  }

  if (yaw) rotateY(p, yaw);
  fillRest(p);

  let world = [];
  let image = [];
  for (let i = 0; i < NUM_LANDMARKS; i++) {
    const v = vis[i] ?? visibility;
    world[i] = { x: p[i][0], y: p[i][1], z: p[i][2], visibility: v };
    image[i] = { ...project(p[i], { distance, offsetX }), visibility: v };
  }

  if (swapLabels) {
    world = swapLR(world);
    image = swapLR(image);
  }
  return { image, world };
}

const PAIRS = [[1, 4], [2, 5], [3, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16],
  [17, 18], [19, 20], [21, 22], [23, 24], [25, 26], [27, 28], [29, 30], [31, 32]];

export function swapLR(arr) {
  const out = arr.slice();
  for (const [a, b] of PAIRS) {
    out[a] = arr[b];
    out[b] = arr[a];
  }
  return out;
}

/** Add deterministic pseudo-random jitter (metres / normalised units). */
export function jitter(f, amount, seed = 1) {
  let s = seed;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return (s / 2147483647) - 0.5;
  };
  const j = lm => ({ ...lm, x: lm.x + rnd() * amount, y: lm.y + rnd() * amount, z: lm.z + rnd() * amount });
  return { image: f.image.map(j), world: f.world.map(j) };
}

/** Generate a timed sequence: [{t, image, world}] at `fps` for `ms`. */
export function sequence(ms, fps, makeFrame, startT = 0) {
  const out = [];
  const step = 1000 / fps;
  for (let t = 0; t <= ms; t += step) {
    out.push({ t: startT + t, ...makeFrame(t) });
  }
  return out;
}
