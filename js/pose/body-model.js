/**
 * js/pose/body-model.js — per-frame, body-relative features (§7.3).
 *
 * Pure function of the filtered landmarks plus calibration. Distances are in
 * "body units" (shoulder widths), angles and rotations come from MediaPipe
 * world landmarks (metres, hip-centred, y pointing down, z toward/away from
 * the camera), and every feature carries a confidence (minimum visibility of
 * the landmarks it used).
 */

import { LM, sideMap } from './landmarks.js';
import { sub, mid, len, dist, angleAt, yawDeg, angleDiff, RAD2DEG } from './geometry.js';

const SIDES = ['lead', 'rear'];
const JOINTS = ['shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle', 'heel', 'foot'];
const SPEED_JOINTS = ['wrist', 'elbow', 'knee', 'ankle'];

/** Gap above which speeds are not computed (stale previous frame). */
const MAX_SPEED_DT_SEC = 0.25;

/**
 * Vertical extent of the body in the image, in normalised frame units.
 * The top of the head is estimated from the nose and shoulder line
 * (the nose sits roughly mid-head; the crown is ~0.55 × nose→shoulder above it).
 */
export function imageBodyExtent(image) {
  if (!image) return null;
  const nose = image[LM.NOSE];
  const shY = (image[LM.L_SHOULDER].y + image[LM.R_SHOULDER].y) / 2;
  const headTop = nose.y - 0.55 * Math.max(0, shY - nose.y);
  const heelsY = (image[LM.L_HEEL].y + image[LM.R_HEEL].y) / 2;
  return { headTop, heelsY, height: heelsY - headTop };
}

/**
 * @param {{t:number, image:Array|null, world:Array|null}} frame  filtered landmarks; t in ms
 * @param {object|null} calib  calibration record (see calibration.js) or null
 * @param {object|null} prev   previous body frame (for speeds)
 */
export function computeBody(frame, calib = null, prev = null) {
  const { t, image, world } = frame;
  if (!world || !image) return { t, valid: false };

  const sides = sideMap(calib?.swapSides ?? false, calib?.stance ?? 'orthodox');
  const vis = i => image[i]?.visibility ?? 0;
  const conf = (...idx) => Math.min(...idx.map(vis));

  const liveShoulderWidth = dist(world[LM.L_SHOULDER], world[LM.R_SHOULDER]);
  const unit = calib?.shoulderWidthM || liveShoulderWidth || 0.38;
  const hipC = mid(world[LM.L_HIP], world[LM.R_HIP]);
  const rel = i => {
    const v = sub(world[i], hipC);
    return { x: v.x / unit, y: v.y / unit, z: v.z / unit };
  };

  const joints = {};
  const imageJoints = {};   // normalised image positions (for depth cues and drawing)
  for (const s of SIDES) {
    joints[s] = {};
    imageJoints[s] = {};
    for (const j of JOINTS) {
      joints[s][j] = rel(sides[s][j]);
      imageJoints[s][j] = image[sides[s][j]];
    }
  }
  const nose = rel(LM.NOSE);

  // Angles (world landmarks → true 3D angles, not their 2D projection).
  const angles = {};
  for (const s of SIDES) {
    const m = sides[s];
    angles[s] = {
      elbow: angleAt(world[m.shoulder], world[m.elbow], world[m.wrist]),
      knee:  angleAt(world[m.hip], world[m.knee], world[m.ankle]),
    };
  }

  // Rotations of the shoulder and hip lines, user's left → right.
  const shoulderYaw = yawDeg(world[sides.left.shoulder], world[sides.right.shoulder]);
  const hipYaw      = yawDeg(world[sides.left.hip], world[sides.right.hip]);
  let facing = Math.abs(shoulderYaw);
  if (facing > 90) facing = 180 - facing;

  // Guard: wrist height above the nose in body units (positive = above).
  const guard = {};
  for (const s of SIDES) {
    const height = nose.y - joints[s].wrist.y;
    const ref = calib?.guard?.[s]?.height;
    guard[s] = {
      height,
      delta: Number.isFinite(ref) ? height - ref : null,
      conf: conf(LM.NOSE, sides[s].wrist),
    };
  }

  // Torso lean: shoulder midpoint relative to hip midpoint.
  const shMid = mid(world[LM.L_SHOULDER], world[LM.R_SHOULDER]);
  const torso = sub(shMid, hipC);
  const torsoLean = Math.atan2(torso.z, -torso.y) * RAD2DEG;      // + = leaning back (away from camera)
  const torsoSideLean = Math.atan2(torso.x, -torso.y) * RAD2DEG;

  // Reach: wrist distance from its own shoulder.
  const reach = {};
  for (const s of SIDES) {
    reach[s] = dist(joints[s].wrist, joints[s].shoulder);
  }

  // Stance geometry.
  const stance = {
    width: dist(joints.lead.ankle, joints.rear.ankle),
    lateral: Math.abs(joints.lead.ankle.x - joints.rear.ankle.x),
    // Positive when the lead ankle is closer to the camera than the rear ankle.
    leadForward: joints.rear.ankle.z - joints.lead.ankle.z,
    conf: conf(sides.lead.ankle, sides.rear.ankle),
  };

  // Speeds in body units per second, from timestamps (not per frame).
  const speed = { lead: {}, rear: {} };
  const dtSec = prev?.valid ? (t - prev.t) / 1000 : 0;
  for (const s of SIDES) {
    for (const j of SPEED_JOINTS) {
      speed[s][j] = dtSec > 0 && dtSec <= MAX_SPEED_DT_SEC
        ? len(sub(joints[s][j], prev.joints[s][j])) / dtSec
        : 0;
    }
  }

  const confidence = {
    lead: {
      arm: conf(sides.lead.shoulder, sides.lead.elbow, sides.lead.wrist),
      leg: conf(sides.lead.hip, sides.lead.knee, sides.lead.ankle),
    },
    rear: {
      arm: conf(sides.rear.shoulder, sides.rear.elbow, sides.rear.wrist),
      leg: conf(sides.rear.hip, sides.rear.knee, sides.rear.ankle),
    },
    shoulders: conf(LM.L_SHOULDER, LM.R_SHOULDER),
    hips: conf(LM.L_HIP, LM.R_HIP),
  };

  return {
    t,
    valid: true,
    unit,
    liveShoulderWidth,
    sides,
    joints,
    imageJoints,
    nose,
    angles,
    shoulderYaw,
    hipYaw,
    shoulderTurn: angleDiff(shoulderYaw, calib?.shoulderYaw ?? 0),
    hipTurn: angleDiff(hipYaw, calib?.hipYaw ?? 0),
    facing,
    guard,
    torsoLean,
    torsoSideLean,
    reach,
    stance,
    extent: imageBodyExtent(image),
    speed,
    confidence,
  };
}
