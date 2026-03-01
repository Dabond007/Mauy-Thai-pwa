/**
 * js/camera.js — Camera Manager
 * Acquires and manages the front-facing camera stream via getUserMedia.
 * Attaches the stream to a <video> element and handles lifecycle.
 */

export class CameraManager {
  constructor() {
    this.stream    = null;
    this.videoEl   = null;
    this._active   = false;
  }

  /**
   * Start the camera and attach the stream to videoEl.
   * @param {HTMLVideoElement} videoEl
   * @returns {Promise<void>}
   */
  async start(videoEl) {
    if (this._active) return;
    this.videoEl = videoEl;

    const constraints = {
      video: {
        facingMode: 'user',       // front-facing camera
        width:      { ideal: 640 },
        height:     { ideal: 480 },
        frameRate:  { ideal: 30 },
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

    await new Promise((resolve, reject) => {
      videoEl.onloadedmetadata = resolve;
      videoEl.onerror = reject;
    });

    await videoEl.play();
    this._active = true;
  }

  /** Stop the camera stream and release resources. */
  stop() {
    if (!this._active) return;
    this.stream?.getTracks().forEach(t => t.stop());
    if (this.videoEl) {
      this.videoEl.srcObject = null;
    }
    this.stream  = null;
    this._active = false;
  }

  get isActive() { return this._active; }

  /**
   * Actual video dimensions (may differ from requested due to hardware).
   * @returns {{ width: number, height: number }}
   */
  get videoSize() {
    return {
      width:  this.videoEl?.videoWidth  ?? 640,
      height: this.videoEl?.videoHeight ?? 480,
    };
  }
}

export class CameraPermissionError extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'CameraPermissionError';
  }
}
