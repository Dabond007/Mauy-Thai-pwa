/**
 * js/screens/angle-test.js — guided camera-angle test.
 *
 * Calls out a fixed routine (stance hold, jabs, crosses, rear kicks, teeps,
 * walk-out) with a beep per rep, and records a debug log for it, so camera
 * placements can be compared from real data. Starting the test is the
 * user's opt-in for that log (spec §10.5); it stays on the phone until they
 * tap Download.
 */

import { PRIORITY } from '../audio/voice.js';
import { estimateSpeechMs } from '../audio/voice-queue.js';
import { Routine } from '../coach/routine.js';

const MAX_FRAME_DT_MS = 100;

const PLACEMENT = {
  30: { forward: '3 metres', side: '1.5 metres' },
  45: { forward: '2 metres', side: '2 metres' },
};

function steps() {
  return [
    { id: 'hold', say: 'Hold your stance, hands up.', holdMs: 10000 },
    { id: 'jab', say: 'Jabs. Eight. One on each beep.', reps: { count: 8, intervalMs: 2500, label: 'Jab' } },
    { id: 'cross', say: 'Crosses. Eight. One on each beep.', reps: { count: 8, intervalMs: 2500, label: 'Cross' } },
    { id: 'kick', say: 'Rear roundhouse kicks. Four. One on each beep.', reps: { count: 4, intervalMs: 4000, label: 'Rear kick' } },
    { id: 'teep', say: 'Lead teeps. Four. One on each beep.', reps: { count: 4, intervalMs: 4000, label: 'Teep' } },
    { id: 'walk', say: 'Now walk out of the picture, then come back.', walkout: true },
    { id: 'end', say: 'All done. Thank you.' },
  ];
}

const fmt = ms => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export class AngleTestScreen {
  constructor({ bus, stage, settings, voice, tones, log }) {
    this.bus = bus;
    this.stage = stage;
    this.settings = settings;
    this.voice = voice;
    this.tones = tones;
    this.log = log;
  }

  /** @param {{angle: 30|45}} o */
  async open({ angle = 30 } = {}) {
    this._angle = PLACEMENT[angle] ? angle : 30;
    const stance = this.settings.calibration?.stance ?? 'orthodox';
    this._side = stance === 'southpaw' ? 'left' : 'right';
    this._routine = new Routine(steps(), text => estimateSpeechMs(text, this.voice.rate));
    this._started = false;
    this._armed = false;
    this._done = false;
    this._active = 0;
    this._lastT = null;
    this._walkedOut = false;

    // This test always records: clear any old log so the file holds just this run.
    this._logWasEnabled = this.log.enabled;
    this.log.clear();
    this.log.enabled = true;
    this.log.event('angle_test', { angle: this._angle, stance, phoneSide: this._side });

    await this.stage.start({
      title: `Angle test ${this._angle}°`,
      required: 'full',
      onFrame: f => this._onFrame(f),
      onStarted: () => this._intro(),
    });
  }

  close({ keepCamera = false } = {}) {
    this.voice.cancelAll();
    this.stage.stop({ keepCamera });
    this.log.enabled = this._logWasEnabled;
  }

  _intro() {
    const p = PLACEMENT[this._angle];
    this.stage.drawOpts.guide = false;
    this.stage.setPanel({
      chip: 'Recording log', chipLevel: 'info',
      prompt: `Phone ${p.forward} in front of you and ${p.side} to your ${this._side}.`,
      detail: 'Face a spot on the wall (your opponent), not the phone. Get in your stance and the test starts by itself.',
      actions: [{ label: 'End', kind: 'secondary', onClick: () => this._finish(true) }],
    });
    this.voice.say(`Angle test. Put the phone ${p.forward} in front of you and ${p.side} to your ${this._side}. ` +
      'Face a spot on the wall, not the phone. Then get in your stance.');
  }

  _onFrame(frame) {
    if (this._done) return;
    for (const ev of frame.presence.events) this._onPresence(ev);

    const tracking = frame.presence.state === 'TRACKING';
    if (!this._started) {
      // Start once the user is tracked AND the setup instructions have
      // finished, so the first cue isn't buried under the intro speech.
      if (this._armed && tracking && !this.voice.busy && this.voice.pending === 0) {
        this._started = true;
        this.tones.bell();
      } else {
        if (frame.framing.tip) this.stage.setDetail(frame.framing.tip);
        return;
      }
    }
    if (!tracking) {
      this._lastT = null;   // routine paused while out of frame
      return;
    }
    if (this._lastT !== null) this._active += Math.min(MAX_FRAME_DT_MS, frame.t - this._lastT);
    this._lastT = frame.t;

    for (const a of this._routine.update(this._active)) this._onAction(a, frame.t);
    this.stage.setTimer(fmt(this._routine.remainingMs(this._active)));
  }

  _onAction(a, t) {
    const { type, ...rest } = a;          // keep the event's own type as 'routine'
    this.log.event('routine', { action: type, ...rest }, t);
    switch (a.type) {
      case 'step':
        this.stage.setChip(`Step ${a.index + 1} of ${this._routine.steps.length}`, 'green');
        this.stage.setDetail('');
        break;
      case 'say':
        this.voice.say(a.text, { key: 'routine' });
        this.stage.setPrompt(a.text);
        break;
      case 'cue':
        this.tones.go();
        this.stage.setPrompt(`${a.label} ${a.rep} of ${a.of}`);
        break;
      case 'done':
        this._finish(false);
        break;
    }
  }

  _onPresence(ev) {
    const walking = this._routine.step?.id === 'walk';
    switch (ev.type) {
      case 'out_of_frame':
        if (walking) {
          this._walkedOut = true;
          this.stage.setPrompt('Now come back.');
          this.voice.say('Now come back.');
        } else {
          this.voice.say('Out of frame', { priority: PRIORITY.FRAME });
          this.stage.setBanner('Out of frame', 'red');
        }
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
        this._armed = true;
        if (walking && this._walkedOut) this._routine.walkoutDone();
        break;
    }
  }

  _finish(early) {
    if (this._done) return;
    this._done = true;
    this.log.event('angle_test_end', { early, activeMs: Math.round(this._active) });
    this.stage.stop();
    this.stage.setBanner(null);
    this.log.enabled = this._logWasEnabled;
    this.stage.el.rec.classList.toggle('hidden', !this.log.enabled);
    this.stage.setPanel({
      chip: early ? 'Ended early' : 'Done', chipLevel: 'green',
      prompt: `Recorded ${Math.round(this.log.seconds)} s at ${this._angle}°.`,
      detail: 'Download the log and attach it in the Claude chat. It holds pose numbers only, no images.',
      actions: [
        { label: 'Download log', onClick: () => {
          const bytes = this.log.download();
          this.stage.setDetail(`Saved ${(bytes / 1e6).toFixed(1)} MB to your Downloads folder.`);
        } },
        { label: 'Home', kind: 'secondary', onClick: () => this.bus.emit('navigate:home') },
      ],
    });
  }
}
