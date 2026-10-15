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

/** Landmarks that must be visible for presence, per drill type (§3.4). */
export const REQUIRED = Object.freeze({
  // Core torso only: wrists are deliberately excluded so a fast punch that
  // blurs a wrist can never trigger "Out of frame".
  upper: [LM.NOSE, LM.L_SHOULDER, LM.R_SHOULDER, LM.L_HIP, LM.R_HIP],
  full:  [LM.NOSE, LM.L_SHOULDER, LM.R_SHOULDER, LM.L_HIP, LM.R_HIP,
          LM.L_KNEE, LM.R_KNEE, LM.L_ANKLE, LM.R_ANKLE],
});

/** Landmarks the framing check needs for "whole body visible" (§3.3). */
export const FRAMING_LANDMARKS = Object.freeze([
  ...REQUIRED.full, LM.L_HEEL, LM.R_HEEL,
]);
