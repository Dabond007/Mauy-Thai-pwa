/**
 * js/camera.js — Camera Manager
 * Front camera, portrait, 30 fps, never the microphone (§3.2).
 * Frames are only ever drawn by the <video> element and read by MediaPipe;
 * nothing here records or copies them (§10).
 */

const ATTEMPTS = [
  { width: { ideal: 1280 }, height: { ideal: 720 }, resizeMode: { ideal: 'none' } },
  { resizeMode: { ideal: 'none' } },
];

export class CameraManager {
  constructor() {
    this.stream  = null;
    this.videoEl = null;
    this._active = false;
    this.info = null;
  }

  /**
   * Start the camera and attach the stream to videoEl.
   *
   * Phone camera sensors are landscape; Chrome rotates the frames to match the
   * phone. Asking for a portrait size or aspect ratio makes Chrome crop the
   * sensor instead (a narrow, zoomed-in view that cuts off the feet), so we ask
   * for the sensor's own landscape mode with resizeMode 'none' (no cropping)
   * and let the rotation make it portrait. If the frames still come out
   * landscape on a portrait screen, we try once more with no size at all and
   * keep whichever view is taller.
   * @param {HTMLVideoElement} videoEl
   */
  async start(videoEl) {
    if (this._active) return;
    this.videoEl = videoEl;

    const portraitScreen = window.matchMedia?.('(orientation: portrait)').matches ?? true;
    let best = null;

    for (const [i, extra] of ATTEMPTS.entries()) {
      const stream = await this._open(extra);
      const size = await this._attach(videoEl, stream);
      const tallness = size.height / size.width;
      if (!best || tallness > best.tallness) {
        best?.stream.getTracks().forEach(t => t.stop());
        best = { stream, size, tallness, attempt: i };
      } else {
        stream.getTracks().forEach(t => t.stop());
      }
      if (!portraitScreen || tallness >= 1) break;
    }

    this.stream = best.stream;
    if (videoEl.srcObject !== best.stream) await this._attach(videoEl, best.stream);
    await this._widestZoom();
    await videoEl.play();
    this._active = true;

    const track = this.stream.getVideoTracks()[0];
    const st = track?.getSettings?.() ?? {};
    this.info = {
      width: videoEl.videoWidth,
      height: videoEl.videoHeight,
      resizeMode: st.resizeMode ?? '?',
      zoom: st.zoom ?? null,
      attempt: best.attempt,
    };
  }

  async _open(extra) {
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', frameRate: { ideal: 30 }, ...extra },
        audio: false,
      });
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        throw new CameraPermissionError('Camera permission denied. Please allow access in browser settings.');
      }
      throw new Error(`Camera error: ${err.message}`);
    }
  }

  async _attach(videoEl, stream) {
    videoEl.srcObject = stream;
    if (videoEl.readyState < 1) {
      await new Promise((resolve, reject) => {
        videoEl.onloadedmetadata = resolve;
        videoEl.onerror = reject;
      });
    }
    return { width: videoEl.videoWidth || 1, height: videoEl.videoHeight || 1 };
  }

  /** Front cameras that support zoom sometimes start zoomed in; use the widest view. */
  async _widestZoom() {
    const track = this.stream.getVideoTracks()[0];
    const caps = track?.getCapabilities?.();
    const current = track?.getSettings?.().zoom;
    if (!caps?.zoom || !Number.isFinite(current) || caps.zoom.min >= current) return;
    try {
      await track.applyConstraints({ advanced: [{ zoom: caps.zoom.min }] });
    } catch { /* not critical */ }
  }

  /** Stop the camera and release it (the camera indicator turns off, §10.7). */
  stop() {
    this.stream?.getTracks().forEach(t => t.stop());
    if (this.videoEl) this.videoEl.srcObject = null;
    this.stream  = null;
    this._active = false;
  }

  get isActive() { return this._active; }

  get videoSize() {
    return {
      width:  this.videoEl?.videoWidth  || 720,
      height: this.videoEl?.videoHeight || 1280,
    };
  }
}

export class CameraPermissionError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'CameraPermissionError';
  }
}
