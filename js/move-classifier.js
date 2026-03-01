/**
 * js/move-classifier.js — Move Classifier
 *
 * Classifies incoming pose landmarks against an expected move.
 * Uses joint-angle computation and wrist/ankle velocity thresholds.
 *
 * Landmark indices (MediaPipe Pose, 33 points):
 *   0  nose          11 left shoulder   12 right shoulder
 *   13 left elbow    14 right elbow     15 left wrist     16 right wrist
 *   23 left hip      24 right hip       25 left knee      26 right knee
 *   27 left ankle    28 right ankle
 *
 * MIRROR CORRECTION (front-facing camera):
 *   The raw video is mirrored for display, so anatomical left/right in
 *   the raw MediaPipe space is SWAPPED relative to the displayed image.
 *   From MediaPipe's POV (raw image, unmirrored):
 *     "left"  landmarks have HIGHER x  → user's right side of body
 *     "right" landmarks have LOWER x   → user's left side of body
 *
 *   For ORTHODOX stance (left foot forward, lead = user's left):
 *     lead  = MediaPipe "right" indices (12,14,16,24,26,28)
 *     rear  = MediaPipe "left"  indices (11,13,15,23,25,27)
 *
 *   For SOUTHPAW stance (right foot forward, lead = user's right):
 *     lead  = MediaPipe "left"  indices (11,13,15,23,25,27)
 *     rear  = MediaPipe "right" indices (12,14,16,24,26,28)
 */

// Landmark index constants
const LM = {
  NOSE:           0,
  L_SHOULDER:    11,  R_SHOULDER:    12,
  L_ELBOW:       13,  R_ELBOW:       14,
  L_WRIST:       15,  R_WRIST:       16,
  L_HIP:         23,  R_HIP:         24,
  L_KNEE:        25,  R_KNEE:        26,
  L_ANKLE:       27,  R_ANKLE:       28,
};

// Stance check cooldown — minimum ms between stance alerts
const STANCE_CHECK_COOLDOWN_MS = 4000;

// Number of consecutive bad-stance frames before alerting (~500ms at 30fps)
const STANCE_BAD_FRAMES_THRESHOLD = 15;

export class MoveClassifier {
  /**
   * @param {EventBus} bus
   * @param {'orthodox'|'southpaw'} stance
   */
  constructor(bus, stance = 'orthodox') {
    this._bus    = bus;
    this._stance = stance;

    // The move currently being waited for (set by ComboEngine)
    this._expectedMoveId = null;
    this._windowOpen     = false;

    // Baseline y positions for anchor calculations (set from first frames)
    this._baselineHipY   = null;

    // Stance checking state
    this._stanceCheckEnabled   = true;
    this._lastStanceAlertTime  = 0;
    this._badStanceFrames      = 0;
    this._lastStanceIssues     = [];

    bus.on('combo:callout', ({ moveId }) => {
      this._expectedMoveId = moveId;
      this._windowOpen     = true;
    });

    bus.on('combo:windowClose', () => {
      this._windowOpen     = false;
      this._expectedMoveId = null;
    });
  }

  /** Set stance (called from settings or auto-detection). */
  setStance(stance) {
    this._stance = stance;
  }

  /** Enable or disable stance checking. */
  setStanceCheckEnabled(enabled) {
    this._stanceCheckEnabled = enabled;
  }

  /**
   * Process new landmarks. Called on every pose:landmarks event.
   * @param {{ landmarks, velocities, timestamp }} poseData
   * @returns {{ detected: boolean, moveId: string, confidence: number }|null}
   */
  classify(poseData) {
    if (!this._windowOpen || !this._expectedMoveId) return null;

    const { landmarks, velocities } = poseData;

    // Update hip baseline for normalisation
    const hipY = avg(landmarks[LM.L_HIP]?.y, landmarks[LM.R_HIP]?.y);
    if (this._baselineHipY === null) this._baselineHipY = hipY;

    // Get lead/rear landmark indices for current stance
    const idx = this._stanceIndices();

    const result = this._detectMove(this._expectedMoveId, landmarks, velocities, idx);

    if (result?.detected) {
      this._windowOpen = false;
      return result;
    }
    return null;
  }

  // ── Stance checking ─────────────────────────────────────────

  /**
   * Check the user's stance quality. Should be called every frame during
   * training (even between move detections). Returns an array of issues,
   * or an empty array if stance looks good.
   *
   * Checks performed:
   *   1. Guard position — are hands up near face?
   *   2. Foot position — is the correct foot forward for the declared stance?
   *   3. Stance width — are feet a reasonable distance apart?
   *
   * @param {{ landmarks, velocities, timestamp }} poseData
   * @returns {{ issues: string[], alert: string|null }}
   *   issues: list of all current problems (for HUD display)
   *   alert:  a single TTS-speakable alert, or null if no alert is due
   */
  checkStance(poseData) {
    if (!this._stanceCheckEnabled) return { issues: [], alert: null };

    const { landmarks, timestamp } = poseData;
    const idx = this._stanceIndices();
    const issues = [];

    // Skip checks during active move execution (classifier window is open)
    if (this._windowOpen) {
      this._badStanceFrames = 0;
      return { issues: [], alert: null };
    }

    // 1. Guard check — both wrists should be near chin/face level
    const guardIssue = this._checkGuard(landmarks, idx);
    if (guardIssue) issues.push(guardIssue);

    // 2. Foot position — lead ankle should be forward (lower x in raw
    //    MediaPipe space for orthodox front-facing camera)
    const footIssue = this._checkFootPosition(landmarks, idx);
    if (footIssue) issues.push(footIssue);

    // 3. Stance width — feet shouldn't be too close together
    const widthIssue = this._checkStanceWidth(landmarks, idx);
    if (widthIssue) issues.push(widthIssue);

    // Decide whether to alert
    let alert = null;
    if (issues.length > 0) {
      this._badStanceFrames++;
      if (this._badStanceFrames >= STANCE_BAD_FRAMES_THRESHOLD) {
        const now = timestamp ?? performance.now();
        if (now - this._lastStanceAlertTime > STANCE_CHECK_COOLDOWN_MS) {
          this._lastStanceAlertTime = now;
          // Pick the most important issue to speak
          alert = this._pickAlertMessage(issues);
        }
      }
    } else {
      this._badStanceFrames = 0;
    }

    this._lastStanceIssues = issues;
    return { issues, alert };
  }

  _checkGuard(lm, idx) {
    const nose   = lm[LM.NOSE];
    const lWrist = lm[idx.leadWrist];
    const rWrist = lm[idx.rearWrist];

    if (!visible(nose, lWrist, rWrist)) return null;

    // Wrists should be roughly at chin level or above. In a proper Muay Thai
    // guard the hands are at chin height, which is well below the nose.
    // In normalized coords, lower y = higher on screen.
    const guardThreshold = nose.y + 0.22; // chin level ≈ nose + ~20% of frame
    const leadDown = lWrist.y > guardThreshold;
    const rearDown = rWrist.y > guardThreshold;

    if (leadDown && rearDown) return 'hands_down';
    if (leadDown) return 'lead_hand_down';
    if (rearDown) return 'rear_hand_down';
    return null;
  }

  _checkFootPosition(lm, idx) {
    const leadAnkle = lm[idx.leadAnkle];
    const rearAnkle = lm[idx.rearAnkle];

    if (!visible(leadAnkle, rearAnkle)) return null;

    // In a proper stance, lead foot is forward.
    // For a front-facing mirrored camera:
    //   "Forward" in the room = closer to camera = larger Y value
    //   But also the feet should show the correct left/right positioning.
    // We primarily check that the lead hip is forward of the rear hip
    // (y position: in normalized coords this means lead hip has higher y
    //  if the person is bladed toward the camera, but this varies).
    // More reliable: check ankle x-spread matches expected stance.
    // For orthodox (left foot forward) with mirrored front camera:
    //   Lead ankle (MediaPipe right = index 28) should have lower x in raw space
    //   because it's the user's left foot which appears on the right side of the
    //   mirrored display, but in RAW (unmirrored) space it has lower x.
    // Actually the simplest check: lead ankle should NOT be behind rear ankle
    // in the z-axis. But z from MediaPipe is noisy. Let's use a combined check:
    // Lead hip should be at least slightly in front (lower z or different x position).

    // Simplified: check that lead and rear ankles aren't swapped in x-position
    // (which would indicate the wrong foot is forward).
    const leadX = leadAnkle.x;
    const rearX = rearAnkle.x;

    // For orthodox: lead = MP right indices (lower x), rear = MP left (higher x)
    // So lead.x should be < rear.x in raw coords
    // For southpaw: lead = MP left (higher x), rear = MP right (lower x)
    // So lead.x should be > rear.x in raw coords
    const isOrthodox = this._stance === 'orthodox';
    const wrongFoot = isOrthodox
      ? (leadX > rearX + 0.05)  // lead should have lower x
      : (leadX < rearX - 0.05); // lead should have higher x

    return wrongFoot ? 'wrong_foot_forward' : null;
  }

  _checkStanceWidth(lm, idx) {
    const leadAnkle = lm[idx.leadAnkle];
    const rearAnkle = lm[idx.rearAnkle];

    if (!visible(leadAnkle, rearAnkle)) return null;

    const dx = Math.abs(leadAnkle.x - rearAnkle.x);

    // Feet too close together. A bladed Muay Thai stance looks narrow from
    // the front camera, so only flag when feet are nearly touching (~3%).
    if (dx < 0.03) return 'stance_too_narrow';

    return null;
  }

  /**
   * Pick the most important stance issue to speak as a TTS alert.
   * @param {string[]} issues
   * @returns {string}
   */
  _pickAlertMessage(issues) {
    // Priority order
    if (issues.includes('hands_down'))         return 'Hands up!';
    if (issues.includes('lead_hand_down'))      return 'Lead hand up!';
    if (issues.includes('rear_hand_down'))      return 'Rear hand up!';
    if (issues.includes('wrong_foot_forward'))  return 'Check your stance!';
    if (issues.includes('stance_too_narrow'))   return 'Widen your stance!';
    return 'Fix your stance!';
  }

  // ── Stance index mapping ──────────────────────────────────

  _stanceIndices() {
    // See mirror-correction explanation at top of file
    if (this._stance === 'orthodox') {
      return {
        leadShoulder: LM.R_SHOULDER, rearShoulder: LM.L_SHOULDER,
        leadElbow:    LM.R_ELBOW,    rearElbow:    LM.L_ELBOW,
        leadWrist:    LM.R_WRIST,    rearWrist:    LM.L_WRIST,
        leadHip:      LM.R_HIP,      rearHip:      LM.L_HIP,
        leadKnee:     LM.R_KNEE,     rearKnee:     LM.L_KNEE,
        leadAnkle:    LM.R_ANKLE,    rearAnkle:    LM.L_ANKLE,
      };
    }
    // southpaw
    return {
      leadShoulder: LM.L_SHOULDER, rearShoulder: LM.R_SHOULDER,
      leadElbow:    LM.L_ELBOW,    rearElbow:    LM.R_ELBOW,
      leadWrist:    LM.L_WRIST,    rearWrist:    LM.R_WRIST,
      leadHip:      LM.L_HIP,      rearHip:      LM.R_HIP,
      leadKnee:     LM.L_KNEE,     rearKnee:     LM.R_KNEE,
      leadAnkle:    LM.L_ANKLE,    rearAnkle:    LM.R_ANKLE,
    };
  }

  // ── Move dispatch ─────────────────────────────────────────

  _detectMove(moveId, lm, vel, idx) {
    switch (moveId) {
      case 'jab':          return this._detectJab(lm, vel, idx);
      case 'cross':        return this._detectCross(lm, vel, idx);
      case 'lead_hook':    return this._detectHook(lm, vel, idx, 'lead');
      case 'rear_hook':    return this._detectHook(lm, vel, idx, 'rear');
      case 'lead_uppercut':return this._detectUppercut(lm, vel, idx, 'lead');
      case 'rear_uppercut':return this._detectUppercut(lm, vel, idx, 'rear');
      case 'lead_teep':    return this._detectTeep(lm, vel, idx);
      case 'rear_roundhouse': return this._detectRoundhouse(lm, vel, idx);
      case 'high_guard':   return this._detectHighGuard(lm, vel, idx);
      case 'check':        return this._detectCheck(lm, vel, idx);
      default:             return { detected: false, moveId, confidence: 0 };
    }
  }

  // ── Individual move detectors ─────────────────────────────

  _detectJab(lm, vel, idx) {
    const shoulder = lm[idx.leadShoulder];
    const elbow    = lm[idx.leadElbow];
    const wrist    = lm[idx.leadWrist];
    const wristVel = vel[idx.leadWrist];

    if (!visible(shoulder, elbow, wrist)) return miss('jab');

    const elbowAngle = angle3(shoulder, elbow, wrist);
    const extended   = elbowAngle > 145;
    const fast       = wristVel > 0.010;

    const confidence = scoreConf([extended ? 0.6 : 0, fast ? 0.4 : 0]);
    return { detected: confidence > 0.5, moveId: 'jab', confidence };
  }

  _detectCross(lm, vel, idx) {
    const shoulder = lm[idx.rearShoulder];
    const elbow    = lm[idx.rearElbow];
    const wrist    = lm[idx.rearWrist];
    const wristVel = vel[idx.rearWrist];

    if (!visible(shoulder, elbow, wrist)) return miss('cross');

    const elbowAngle = angle3(shoulder, elbow, wrist);
    // Detect torso rotation: rear shoulder moves forward (lower x in raw space)
    const lShoulder  = lm[LM.L_SHOULDER];
    const rShoulder  = lm[LM.R_SHOULDER];
    const shoulderDx = Math.abs(lShoulder.x - rShoulder.x);
    const rotated    = shoulderDx < 0.25; // shoulders are more aligned = rotated

    const extended   = elbowAngle > 145;
    const fast       = wristVel > 0.012;

    const confidence = scoreConf([
      extended ? 0.5 : 0,
      fast     ? 0.35 : 0,
      rotated  ? 0.15 : 0,
    ]);
    return { detected: confidence > 0.45, moveId: 'cross', confidence };
  }

  _detectHook(lm, vel, idx, side) {
    const sIdx = side === 'lead' ? idx.leadShoulder : idx.rearShoulder;
    const eIdx = side === 'lead' ? idx.leadElbow    : idx.rearElbow;
    const wIdx = side === 'lead' ? idx.leadWrist    : idx.rearWrist;

    const shoulder = lm[sIdx];
    const elbow    = lm[eIdx];
    const wrist    = lm[wIdx];
    const wristVel = vel[wIdx];

    if (!visible(shoulder, elbow, wrist)) return miss(`${side}_hook`);

    const elbowAngle = angle3(shoulder, elbow, wrist);
    // Hook: elbow bent at ~70-120°, lateral motion
    const hookAngle  = elbowAngle >= 60 && elbowAngle <= 130;
    const fast       = wristVel > 0.012;

    const confidence = scoreConf([hookAngle ? 0.55 : 0, fast ? 0.45 : 0]);
    return { detected: confidence > 0.5, moveId: `${side}_hook`, confidence };
  }

  _detectUppercut(lm, vel, idx, side) {
    const eIdx = side === 'lead' ? idx.leadElbow : idx.rearElbow;
    const wIdx = side === 'lead' ? idx.leadWrist : idx.rearWrist;

    const elbow    = lm[eIdx];
    const wrist    = lm[wIdx];
    const wristVel = vel[wIdx];

    if (!visible(elbow, wrist)) return miss(`${side}_uppercut`);

    // Uppercut: wrist moves upward (decreasing y) while elbow is bent
    const wristUp = elbow.y - wrist.y; // positive = wrist above elbow
    const upward  = wristUp > 0.04;
    const fast    = wristVel > 0.010;

    const confidence = scoreConf([upward ? 0.55 : 0, fast ? 0.45 : 0]);
    return { detected: confidence > 0.5, moveId: `${side}_uppercut`, confidence };
  }

  _detectTeep(lm, vel, idx) {
    const hip    = lm[idx.leadHip];
    const knee   = lm[idx.leadKnee];
    const ankle  = lm[idx.leadAnkle];
    const ankleVel = vel[idx.leadAnkle];

    if (!visible(hip, knee, ankle)) return miss('lead_teep');

    // Knee raised: ankle y significantly above hip y (lower y = higher on screen)
    const ankleRise = hip.y - ankle.y;
    const raised    = ankleRise > 0.12;
    const fast      = ankleVel > 0.015;

    const confidence = scoreConf([raised ? 0.55 : 0, fast ? 0.45 : 0]);
    return { detected: confidence > 0.5, moveId: 'lead_teep', confidence };
  }

  _detectRoundhouse(lm, vel, idx) {
    const hip    = lm[idx.rearHip];
    const knee   = lm[idx.rearKnee];
    const ankle  = lm[idx.rearAnkle];
    const ankleVel = vel[idx.rearAnkle];

    if (!visible(hip, knee, ankle)) return miss('rear_roundhouse');

    const ankleRise = hip.y - ankle.y;
    const raised    = ankleRise > 0.08;
    const fast      = ankleVel > 0.016;

    // Lateral ankle movement (x velocity component)
    const prevAnkle = this._prevAnkle;
    const lateral   = prevAnkle
      ? Math.abs(ankle.x - prevAnkle.x) > 0.05
      : false;
    this._prevAnkle = ankle;

    const confidence = scoreConf([
      raised  ? 0.4  : 0,
      fast    ? 0.4  : 0,
      lateral ? 0.2  : 0,
    ]);
    return { detected: confidence > 0.45, moveId: 'rear_roundhouse', confidence };
  }

  _detectHighGuard(lm, vel, idx) {
    const nose  = lm[LM.NOSE];
    const lWrist = lm[LM.L_WRIST];
    const rWrist = lm[LM.R_WRIST];

    if (!visible(nose, lWrist, rWrist)) return miss('high_guard');

    // Both wrists above nose (lower y = higher on screen)
    const bothUp = lWrist.y < nose.y && rWrist.y < nose.y;

    return { detected: bothUp, moveId: 'high_guard', confidence: bothUp ? 1.0 : 0.0 };
  }

  _detectCheck(lm, vel, idx) {
    const hip    = lm[idx.leadHip];
    const knee   = lm[idx.leadKnee];
    const ankle  = lm[idx.leadAnkle];

    if (!visible(hip, knee, ankle)) return miss('check');

    const kneeAngle = angle3(hip, knee, ankle);
    const kneeRaise = hip.y - knee.y;

    // Shin block: knee raises (hip-knee y difference decreases = knee moves up)
    const checking = kneeRaise > 0.10 && kneeAngle < 140;

    return { detected: checking, moveId: 'check', confidence: checking ? 0.9 : 0 };
  }
}

// ── Helpers ──────────────────────────────────────────────────

/** Compute angle (degrees) at point b, between vectors b→a and b→c. */
function angle3(a, b, c) {
  if (!a || !b || !c) return 0;
  const ax = a.x - b.x, ay = a.y - b.y;
  const cx = c.x - b.x, cy = c.y - b.y;
  const dot = ax * cx + ay * cy;
  const mag = Math.sqrt(ax * ax + ay * ay) * Math.sqrt(cx * cx + cy * cy);
  if (mag === 0) return 0;
  return (Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180) / Math.PI;
}

/** Check that all landmarks have reasonable visibility. */
function visible(...lms) {
  return lms.every(lm => lm && (lm.visibility ?? 1) > 0.4);
}

/** Weighted sum of component scores → single confidence score. */
function scoreConf(components) {
  return components.reduce((a, b) => a + b, 0);
}

/** Convenience miss result. */
function miss(moveId) {
  return { detected: false, moveId, confidence: 0 };
}

/** Average of two numbers. */
function avg(a, b) {
  return (a + b) / 2;
}
