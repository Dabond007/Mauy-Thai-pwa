/**
 * js/camera.js — Camera Manager
 * Front camera, portrait, 30 fps, never the microphone (§3.2).
 * Frames are only ever drawn by the <video> element and read by MediaPipe;
 * nothing here records or copies them (§10).
 */

export class CameraManager {
  constructor() {
    this.stream  = null;
    this.videoEl = null;
    this._active = false;
  }

  /**
   * Start the camera and attach the stream to videoEl.
   * @param {HTMLVideoElement} videoEl
   */
  async start(videoEl) {
    if (this._active) return;
    this.videoEl = videoEl;

    const constraints = {
      video: {
        facingMode:  'user',
        width:       { ideal: 720 },
        height:      { ideal: 1280 },
        aspectRatio: { ideal: 9 / 16 },
        frameRate:   { ideal: 30 },
      },
      audio: false,
    };

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        throw new CameraPermissionError('Camera permission denied. Please allow access in browser settings.');
      }
      throw new Error(`Camera error: ${err.message}`);
    }

    videoEl.srcObject = this.stream;
    if (videoEl.readyState < 1) {
      await new Promise((resolve, reject) => {
        videoEl.onloadedmetadata = resolve;
        videoEl.onerror = reject;
      });
    }
    await videoEl.play();
    this._active = true;
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
