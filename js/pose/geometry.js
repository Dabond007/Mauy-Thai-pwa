/**
 * js/pose/geometry.js — small vector helpers for landmark maths.
 * All functions take plain {x, y, z} objects and never mutate them.
 */

export const RAD2DEG = 180 / Math.PI;

export function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: (a.z ?? 0) - (b.z ?? 0) };
}

export function mid(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: ((a.z ?? 0) + (b.z ?? 0)) / 2 };
}

export function len(v) {
  return Math.hypot(v.x, v.y, v.z ?? 0);
}

export function dist(a, b) {
  return len(sub(a, b));
}

export function dot(a, b) {
  return a.x * b.x + a.y * b.y + (a.z ?? 0) * (b.z ?? 0);
}

/** Angle at vertex b formed by a-b-c, in degrees (0..180). */
export function angleAt(a, b, c) {
  const u = sub(a, b);
  const v = sub(c, b);
  const lu = len(u);
  const lv = len(v);
  if (lu === 0 || lv === 0) return NaN;
  const cos = Math.min(1, Math.max(-1, dot(u, v) / (lu * lv)));
  return Math.acos(cos) * RAD2DEG;
}

/**
 * Yaw of the line from a to b in the horizontal (x-z) plane, in degrees.
 * 0 = the line runs straight across the camera's view (body square on);
 * positive = b is further from the camera than a.
 */
export function yawDeg(a, b) {
  return Math.atan2(b.z - a.z, b.x - a.x) * RAD2DEG;
}

/** Smallest signed difference between two angles in degrees (-180..180). */
export function angleDiff(a, b) {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

export function median(values) {
  const v = values.filter(Number.isFinite).sort((p, q) => p - q);
  if (!v.length) return NaN;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function mean(values) {
  const v = values.filter(Number.isFinite);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN;
}

export function minVisibility(landmarks, indices) {
  if (!landmarks) return 0;
  let m = 1;
  for (const i of indices) m = Math.min(m, landmarks[i]?.visibility ?? 0);
  return m;
}
