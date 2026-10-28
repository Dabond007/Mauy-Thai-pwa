/**
 * js/pose/landmarks.js — MediaPipe Pose landmark indices and side mapping.
 *
 * MediaPipe labels landmarks anatomically ("left" = the person's left) on the
 * frames it analyses. Those frames are NOT mirrored (only the on-screen
 * <video> is, via CSS), so index 15 should be the user's real left wrist.
 * We never assume that: calibration asks the user to raise their left hand
 * and records `swapSides` if MediaPipe's "right" wrist rose instead.
 */

export const NUM_LANDMARKS = 33;

export const LM = Object.freeze({
  NOSE: 0,
  L_SHOULDER: 11, R_SHOULDER: 12,
  L_ELBOW: 13,    R_ELBOW: 14,
  L_WRIST: 15,    R_WRIST: 16,
  L_HIP: 23,      R_HIP: 24,
  L_KNEE: 25,     R_KNEE: 26,
  L_ANKLE: 27,    R_ANKLE: 28,
  L_HEEL: 29,     R_HEEL: 30,
  L_FOOT: 31,     R_FOOT: 32,
});

const MP_LEFT = Object.freeze({
  shoulder: LM.L_SHOULDER, elbow: LM.L_ELBOW, wrist: LM.L_WRIST,
  hip: LM.L_HIP, knee: LM.L_KNEE, ankle: LM.L_ANKLE, heel: LM.L_HEEL, foot: LM.L_FOOT,
});
const MP_RIGHT = Object.freeze({
  shoulder: LM.R_SHOULDER, elbow: LM.R_ELBOW, wrist: LM.R_WRIST,
  hip: LM.R_HIP, knee: LM.R_KNEE, ankle: LM.R_ANKLE, heel: LM.R_HEEL, foot: LM.R_FOOT,
});

/**
 * Landmark indices for the user's real left/right and lead/rear sides.
 * @param {boolean} swapSides  true if MediaPipe's "right" is the user's left
 * @param {'orthodox'|'southpaw'} stance  orthodox = left foot forward
 */
export function sideMap(swapSides = false, stance = 'orthodox') {
  const left  = swapSides ? MP_RIGHT : MP_LEFT;
  const right = swapSides ? MP_LEFT  : MP_RIGHT;
  const leadIsLeft = stance !== 'southpaw';
  return {
    left, right,
    lead: leadIsLeft ? left : right,
    rear: leadIsLeft ? right : left,
  };
}

/**
 * A foot counts as seen if any of its ankle, heel or toe landmarks is.
 * From a front camera the heel is often hidden behind the foot, and models
 * is not equally confident about each point.
 */
const L_FOOT_ANY = Object.freeze([LM.L_ANKLE, LM.L_HEEL, LM.L_FOOT]);
const R_FOOT_ANY = Object.freeze([LM.R_ANKLE, LM.R_HEEL, LM.R_FOOT]);

/**
 * Landmarks that must be visible for presence, per drill type (§3.4).
 * Each entry is an index, or an array meaning "any one of these".
 */
export const REQUIRED = Object.freeze({
  // Core torso only: wrists are deliberately excluded so a fast punch that
  // blurs a wrist can never trigger "Out of frame".
  upper: [LM.NOSE, LM.L_SHOULDER, LM.R_SHOULDER, LM.L_HIP, LM.R_HIP],
  full:  [LM.NOSE, LM.L_SHOULDER, LM.R_SHOULDER, LM.L_HIP, LM.R_HIP,
          LM.L_KNEE, LM.R_KNEE, L_FOOT_ANY, R_FOOT_ANY],
});

/** Landmarks the framing check needs for "whole body visible" (§3.3). */
export const FRAMING_LANDMARKS = REQUIRED.full;

/** The most visible landmark of a REQUIRED entry (index or any-of array). */
export function bestOf(landmarks, entry) {
  if (!Array.isArray(entry)) return landmarks[entry];
  let best = landmarks[entry[0]];
  for (const i of entry) {
    if ((landmarks[i]?.visibility ?? 0) > (best?.visibility ?? 0)) best = landmarks[i];
  }
  return best;
}

/** Lowest visibility across REQUIRED-style entries. */
export function minEntryVisibility(landmarks, entries) {
  if (!landmarks) return 0;
  let m = 1;
  for (const e of entries) m = Math.min(m, bestOf(landmarks, e)?.visibility ?? 0);
  return m;
}

/** Entries that are visible below `minVis` (for logging: first index of a group). */
export function missingEntries(landmarks, entries, minVis) {
  return entries
    .filter(e => (bestOf(landmarks, e)?.visibility ?? 0) < minVis)
    .map(e => (Array.isArray(e) ? e[0] : e));
}
