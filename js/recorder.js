/* ==========================================================================
   recorder.js — export the model animation as a video file (animatic)
   --------------------------------------------------------------------------
   The model is rendered a second time into an off-screen canvas at a fixed
   video size (e.g. 1920×1080), independent of the browser window. That
   canvas is captured with canvas.captureStream() and encoded by the
   browser's MediaRecorder — WebM (VP9/VP8) in Chrome, Edge and Firefox.
   ========================================================================== */

const TYPES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4', // Safari fallback
];

export class Recorder {
  static supported() {
    return typeof MediaRecorder !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype;
  }

  constructor() {
    this.active = false;
    this.type = '';
  }

  /**
   * @param {number} w  video width in px
   * @param {number} h  video height in px
   * @param {number} fps
   * @param {(ctx: CanvasRenderingContext2D, w: number, h: number) => void} draw
   */
  start(w, h, fps, draw) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d');
    this.w = w; this.h = h; this.draw = draw;
    this.draw(this.ctx, w, h);

    this.type = TYPES.find((t) => MediaRecorder.isTypeSupported(t)) || '';
    const stream = this.canvas.captureStream(fps);
    this.rec = new MediaRecorder(stream, {
      mimeType: this.type || undefined,
      videoBitsPerSecond: w * h > 2.5e6 ? 40e6 : 16e6,
    });
    this.type = this.rec.mimeType || this.type || 'video/webm';
    this.chunks = [];
    this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.rec.start(500);
    this.t0 = performance.now();
    this.active = true;
  }

  /** Called once per animation frame while recording. */
  frame() {
    if (this.active) this.draw(this.ctx, this.w, this.h);
  }

  elapsed() {
    return this.active ? (performance.now() - this.t0) / 1000 : 0;
  }

  /** @returns {Promise<Blob>} */
  stop() {
    return new Promise((resolve) => {
      this.rec.onstop = () => {
        this.active = false;
        resolve(new Blob(this.chunks, { type: this.type }));
      };
      this.rec.stop();
    });
  }
}
