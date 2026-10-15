/**
 * js/screens/practice.js — "Stance check": the Phase A on-device test.
 *
 * Hold your stance and guard for a timed set while the presence state machine
 * runs (§3.4): walking out freezes the timer and says "Out of frame"; coming
 * back says "Back in frame", plays 3-2-1 and resumes. The guard is shown on
 * screen only — spoken "Hands up" arrives with the coach in Phase B.
 */

import { PRIORITY } from '../audio/voice.js';

const DURATION_MS = 60000;
const GUARD_DOWN_DELTA = -0.35;   // body units below calibrated guard height
const MAX_FRAME_DT_MS = 100;

const fmt = ms => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export class PracticeScreen {
  constructor({ bus, stage, settings, voice, tones }) {
    this.bus = bus;
    this.stage = stage;
    this.settings = settings;
    this.voice = voice;
    this.tones = tones;
    this._open = false;
  }

  async open() {
    this._open = true;
    this._started = false;
    this._done = false;
    this._elapsed = 0;
    this._lastT = null;
    this._guardFrames = 0;
    this._guardUpFrames = 0;

    await this.stage.start({
      title: 'Stance check',
      required: 'full',
      onFrame: f => this._onFrame(f),
      onStarted: () => this._intro(),
    });
  }

  close({ keepCamera = false } = {}) {
    this._open = false;
    this.voice.cancelAll();
    this.stage.stop({ keepCamera });
  }

  _intro() {
    this.stage.drawOpts.guide = true;
    this.stage.setPanel({
      chip: 'Waiting for you', chipLevel: 'info',
      prompt: 'Get in your stance, hands up.',
      detail: 'Hold it for one minute. Walk out of frame and back to test the auto-pause.',
      timer: fmt(DURATION_MS),
      actions: [{ label: 'End', kind: 'secondary', onClick: () => this._finish(true) }],
    });
    this.voice.say('Get in your stance, hands up.');
  }

  _onFrame(frame) {
    if (this._done) return;

    for (const ev of frame.presence.events) this._onPresence(ev);

    const active = frame.presence.state === 'TRACKING';
    this.stage.drawOpts.guide = !active;
    this.stage.drawOpts.guideStatus = frame.framing.status;

    if (!this._started) {
      if (frame.framing.tip) this.stage.setPrompt(frame.framing.tip);
    }

    if (active) {
      if (this._lastT !== null) this._elapsed += Math.min(MAX_FRAME_DT_MS, frame.t - this._lastT);
      this._lastT = frame.t;
      this._trackGuard(frame);
      this.stage.setTimer(fmt(DURATION_MS - this._elapsed));
      if (this._elapsed >= DURATION_MS) this._finish(false);
    } else {
      this._lastT = null;   // timer frozen
    }
  }

  _onPresence(ev) {
    switch (ev.type) {
      case 'out_of_frame':
        this.voice.say('Out of frame', { priority: PRIORITY.FRAME });
        this.stage.setBanner('Out of frame', 'red');
        this.stage.setChip('Paused', 'amber');
        this.stage.showCountdown(null);
        break;
      case 'back_in_frame':
        if (!ev.first) {
          this.voice.say('Back in frame', { priority: PRIORITY.FRAME });
          this.stage.setBanner('Back in frame', 'green');
        }
        break;
      case 'countdown':
        this.tones.count(ev.n);
        this.stage.showCountdown(ev.n);
        break;
      case 'tracking':
        this.stage.showCountdown(null);
        this.stage.setBanner(null);
        if (!this._started) {
          this._started = true;
          this.tones.bell();
          this.stage.setPrompt('Hold your stance and guard.');
        }
        this.stage.setChip('Tracking', 'green');
        break;
    }
  }

  _trackGuard(frame) {
    const b = frame.body;
    const c = this.settings.calibration;
    if (!b.valid || !c) {
      this.stage.setDetail(c ? '' : 'Calibrate to see your guard here.');
      return;
    }
    const lead = b.guard.lead;
    const rear = b.guard.rear;
    if (Math.min(lead.conf, rear.conf) < 0.5) {
      this.stage.setDetail("Guard: can't see your hands clearly");
      return;
    }
    const leadUp = lead.delta > GUARD_DOWN_DELTA;
    const rearUp = rear.delta > GUARD_DOWN_DELTA;
    this._guardFrames++;
    if (leadUp && rearUp) this._guardUpFrames++;
    this.stage.setDetail(leadUp && rearUp ? 'Guard: up'
      : `Guard: ${[!leadUp && 'lead', !rearUp && 'rear'].filter(Boolean).join(' and ')} hand low`);
  }

  _finish(early) {
    if (this._done) return;
    this._done = true;
    const outs = this.stage.pipeline.presence.outOfFrameCount;
    const guardPct = this._guardFrames ? Math.round((100 * this._guardUpFrames) / this._guardFrames) : null;
    if (!early) {
      this.tones.bell();
      this.voice.say('Time. Nice work.');
    }
    this.stage.stop();
    this.stage.setBanner(null);
    this.stage.setPanel({
      chip: early ? 'Ended' : 'Done', chipLevel: 'green',
      prompt: `Tracked ${fmt(this._elapsed)} of ${fmt(DURATION_MS)}.`,
      detail: [
        `Out of frame: ${outs} time${outs === 1 ? '' : 's'}.`,
        guardPct !== null ? `Guard up ${guardPct}% of the time.` : '',
      ].filter(Boolean).join(' '),
      actions: [
        { label: 'Again', onClick: () => this.open() },
        { label: 'Home', kind: 'secondary', onClick: () => this.bus.emit('navigate:home') },
      ],
    });
  }
}
