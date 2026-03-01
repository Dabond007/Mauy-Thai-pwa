/**
 * js/pose-engine.js — MediaPipe Pose Landmarker wrapper
 *
 * Loads the MediaPipe Tasks Vision bundle, initialises PoseLandmarker,
 * processes video frames, applies temporal smoothing (EMA), computes
 * per-landmark velocities, and emits 'pose:landmarks' events via the bus.
 *
 * Mirror correction note:
 *   The front-facing camera produces a mirrored image. MediaPipe labels
 *   landmarks anatomically (left/right from the person's perspective), but
 *   since the image is flipped, MediaPipe's "left" shoulder appears on the
 *   RIGHT side of the raw frame (high x) and vice-versa.
 *   The renderer handles display flipping. The classifier receives raw
 *   landmark coordinates and maps lead/rear correctly per stance.
 */

const MEDIAPIPE_VERSION = '0.10.14';
const VISION_BUNDLE_URL =
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/vision_bundle.mjs`;
const WASM_BASE_URL =
  `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';

// Smoothing factor for exponential moving average (0 = no smoothing, 1 = frozen)
const EMA_ALPHA = 0.4;

// Velocity window (frames)
const VEL_WINDOW = 3;

// MediaPipe landmark count
const NUM_LANDMARKS = 33;

export class PoseEngine {
  constructor(bus) {
    this._bus            = bus;
    this._landmarker     = null;
    this._rafId          = null;
    this._videoEl        = null;

    // EMA state — array of {x,y,z,visibility} or null
    this._smoothed       = new Array(NUM_LANDMARKS).fill(null);

    // Ring buffer for velocity calculation: last VEL_WINDOW frames
    this._history        = [];

    this._lastTimestamp  = -1;
    this._running        = false;
  }

  /**
   * Load the MediaPipe model. Should be called once during app init.
   * Emits progress events so the loading bar can update.
   */
  async init() {
    // Dynamic import to avoid blocking the main parse
    const { PoseLandmarker, FilesetResolver } = await import(VISION_BUNDLE_URL);

    const vision = await FilesetResolver.forVisionTasks(WASM_BASE_URL);

    this._landmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate: 'GPU',        // falls back to CPU automatically
      },
      runningMode:                'VIDEO',
      numPoses:                   1,
      minPoseDetectionConfidence: 0.6,
      minPosePresenceConfidence:  0.6,
      minTrackingConfidence:      0.6,
    });
  }

  /**
   * Start the detection loop.
   * @param {HTMLVideoElement} videoEl  Must be playing.
   */
  startProcessing(videoEl) {
    this._videoEl = videoEl;
    this._running = true;
    this._loop();
  }

  stopProcessing() {
    this._running = false;
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._smoothed = new Array(NUM_LANDMARKS).fill(null);
    this._history  = [];
  }

  // ── Internal ─────────────────────────────────────────────

  _loop() {
    if (!this._running) return;
    this._rafId = requestAnimationFrame(() => this._loop());

    const video = this._videoEl;
    if (!video || video.readyState < 2) return;

    // Deduplicate — only process new frames
    if (video.currentTime === this._lastTimestamp) return;
    this._lastTimestamp = video.currentTime;

    const timestamp = performance.now();
    let results;
    try {
      results = this._landmarker.detectForVideo(video, timestamp);
    } catch {
      return; // model not ready yet
    }

    if (!results?.landmarks?.length) return;

    const rawLandmarks = results.landmarks[0]; // 33 normalised {x,y,z,visibility}

    // Apply EMA smoothing
    const smoothed = this._smooth(rawLandmarks);

    // Compute velocities
    const velocities = this._computeVelocities(smoothed);

    this._bus.emit('pose:landmarks', { landmarks: smoothed, velocities, timestamp });
  }

  /**
   * Apply exponential moving average to each landmark coordinate.
   */
  _smooth(raw) {
    const out = [];
    for (let i = 0; i < NUM_LANDMARKS; i++) {
      const r = raw[i];
      const s = this._smoothed[i];

      if (!s || r.visibility < 0.3) {
        // Bootstrap or low-confidence: use raw directly
        out[i] = { ...r };
      } else {
        out[i] = {
          x:          EMA_ALPHA * r.x          + (1 - EMA_ALPHA) * s.x,
          y:          EMA_ALPHA * r.y          + (1 - EMA_ALPHA) * s.y,
          z:          EMA_ALPHA * r.z          + (1 - EMA_ALPHA) * s.z,
          visibility: EMA_ALPHA * r.visibility + (1 - EMA_ALPHA) * s.visibility,
        };
      }
    }
    this._smoothed = out;
    return out;
  }

  /**
   * Compute frame-to-frame Euclidean velocity for each landmark.
   * Returns an array of speed values (0-based) in normalised units/frame.
   */
  _computeVelocities(current) {
    // Maintain history ring buffer
    this._history.push(current);
    if (this._history.length > VEL_WINDOW) this._history.shift();

    if (this._history.length < 2) {
      return new Array(NUM_LANDMARKS).fill(0);
    }

    const prev = this._history[this._history.length - 2];
    return current.map((lm, i) => {
      const p = prev[i];
      if (!lm || !p) return 0;
      const dx = lm.x - p.x;
      const dy = lm.y - p.y;
      return Math.sqrt(dx * dx + dy * dy);
    });
  }
}
