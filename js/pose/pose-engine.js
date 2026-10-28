/**
 * js/pose/pose-engine.js — MediaPipe Pose Landmarker wrapper.
 *
 * Everything is served from this app's own origin (vendor/mediapipe/): no CDN,
 * works offline, no third-party requests (§7.1, §10). Returns both image
 * landmarks (normalised to the unmirrored camera frame) and world landmarks
 * (metres, hip-centred) with real timestamps.
 */

const VENDOR = new URL('../../vendor/mediapipe/', import.meta.url);

// Heavy was benchmarked on the Pixel 9 (Phase A): ~16 fps, 57 ms inference,
// and lower knee/heel visibility than Full — below the 25 fps bar, so only
// Full ships (spec §7.1).
export const MODELS = Object.freeze({
  full: 'models/pose_landmarker_full.task',
});

export class PoseEngine {
  constructor() {
    this._landmarker = null;
    this._model = null;
    this._video = null;
    this._onFrame = null;
    this._running = false;
    this._handle = null;
    this._lastVideoTime = -1;
    this._lastTs = 0;
    this.delegate = null;
  }

  get model() { return this._model; }

  /**
   * Load (or switch) the model. Safe to call again with a different model.
   * @param {'full'} model
   */
  async init(model = 'full') {
    if (!MODELS[model]) model = 'full';
    if (this._landmarker && this._model === model) return;
    const { PoseLandmarker } = await import(new URL('vision_bundle.mjs', VENDOR).href);

    // Explicit fileset (SIMD build only; every current Chrome on Android has
    // WASM SIMD) instead of FilesetResolver, which would probe for both.
    const fileset = {
      wasmLoaderPath: new URL('wasm/vision_wasm_internal.js', VENDOR).href,
      wasmBinaryPath: new URL('wasm/vision_wasm_internal.wasm', VENDOR).href,
    };

    const options = delegate => ({
      baseOptions: {
        modelAssetPath: new URL(MODELS[model] ?? MODELS.full, VENDOR).href,
        delegate,
      },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputSegmentationMasks: false,
    });

    let landmarker;
    try {
      landmarker = await PoseLandmarker.createFromOptions(fileset, options('GPU'));
      this.delegate = 'GPU';
    } catch (e) {
      console.warn('[PoseEngine] GPU delegate failed, using CPU:', e);
      landmarker = await PoseLandmarker.createFromOptions(fileset, options('CPU'));
      this.delegate = 'CPU';
    }

    this._landmarker?.close();
    this._landmarker = landmarker;
    this._model = model;
  }

  /**
   * Start processing frames from a playing <video>.
   * @param {HTMLVideoElement} video
   * @param {(raw:{t, image, world, inferenceMs, videoWidth, videoHeight}) => void} onFrame
   */
  start(video, onFrame) {
    this.stop();
    this._video = video;
    this._onFrame = onFrame;
    this._running = true;
    this._lastVideoTime = -1;
    this._schedule();
  }

  stop() {
    this._running = false;
    if (this._handle !== null && this._video) {
      if ('cancelVideoFrameCallback' in this._video) this._video.cancelVideoFrameCallback(this._handle);
      else cancelAnimationFrame(this._handle);
    }
    this._handle = null;
  }

  _schedule() {
    if (!this._running) return;
    const v = this._video;
    this._handle = 'requestVideoFrameCallback' in v
      ? v.requestVideoFrameCallback(() => this._tick())
      : requestAnimationFrame(() => this._tick());
  }

  _tick() {
    if (!this._running) return;
    try {
      this._process();
    } finally {
      this._schedule();
    }
  }

  _process() {
    const v = this._video;
    if (!this._landmarker || v.readyState < 2 || v.currentTime === this._lastVideoTime) return;
    this._lastVideoTime = v.currentTime;

    // MediaPipe requires strictly increasing timestamps.
    let t = performance.now();
    if (t <= this._lastTs) t = this._lastTs + 1;
    this._lastTs = t;

    const t0 = performance.now();
    let result;
    try {
      result = this._landmarker.detectForVideo(v, t);
    } catch (e) {
      console.warn('[PoseEngine] detect failed:', e);
      return;
    }
    const inferenceMs = performance.now() - t0;

    this._onFrame?.({
      t,
      image: result?.landmarks?.[0] ?? null,
      world: result?.worldLandmarks?.[0] ?? null,
      inferenceMs,
      videoWidth: v.videoWidth,
      videoHeight: v.videoHeight,
    });
  }
}
