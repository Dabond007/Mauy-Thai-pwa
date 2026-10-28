/**
 * js/screens/setup.js — framing check, then calibration if due (§3.3, §7.2).
 */

import { Calibrator, STEPS, calibrationDue } from '../pose/calibration.js';
import { PRIORITY } from '../audio/voice.js';

const GREEN_HOLD_MS = 1500;

const CHIP = {
  green: ['Good to go', 'green'],
  amber: ['Almost there', 'amber'],
  red: ["Can't see you", 'red'],
};

export class SetupScreen {
  constructor({ bus, stage, settings, voice, tones }) {
    this.bus = bus;
    this.stage = stage;
    this.settings = settings;
    this.voice = voice;
    this.tones = tones;
    this._phase = null;
  }

  /**
   * @param {object} o
   * @param {boolean} [o.forceCalibrate]
   * @param {'practice'|'home'} [o.next]  where to go once setup is done
   */
  async open({ forceCalibrate = false, next = 'practice' } = {}) {
    this._forceCalibrate = forceCalibrate;
    this._next = next;
    this._phase = 'framing';
    this._calibrator = null;
    this._lastStep = null;
    this._started = false;

    await this.stage.start({
      title: forceCalibrate ? 'Calibrate' : 'Setup',
      required: 'full',
      onFrame: f => this._onFrame(f),
      onStarted: () => this._enterFraming(),
    });
  }

  close({ keepCamera = false } = {}) {
    this._phase = null;
    this.voice.cancelAll();
    this.stage.stop({ keepCamera });
    this.stage.debug.extra = {};
  }

  _onFrame(frame) {
    if (this._phase === 'framing') this._framing(frame);
    else if (this._phase === 'calibrate') this._calibrate(frame);
  }

  // ── Framing ───────────────────────────────────────────────

  _enterFraming() {
    this.stage.drawOpts.guide = true;
    this.stage.setPanel({
      chip: CHIP.red[0], chipLevel: 'red',
      prompt: 'Prop the phone up at waist height, then stand about 3 metres back.',
      detail: this._landscapeWarning() ?? 'Match the outline: whole body in view, feet included.',
      progress: 0,
    });
    this.voice.say('Prop the phone up at waist height. Stand about three metres back so I can see all of you.');
  }

  /** Diagnostic: the camera should give a portrait picture on a portrait phone. */
  _landscapeWarning() {
    const cam = this.stage.camera.info;
    const portrait = window.matchMedia?.('(orientation: portrait)').matches;
    if (!cam || !portrait || cam.height >= cam.width) return null;
    return `The camera is giving a landscape picture (${cam.width}×${cam.height}). Please report this.`;
  }

  _framing(frame) {
    const fr = frame.framing;
    const [chip, level] = CHIP[fr.status];
    this.stage.drawOpts.guideStatus = fr.status;
    this.stage.setChip(chip, level);
    this.stage.setPrompt(fr.status === 'green' ? 'Perfect — hold there.' : fr.tip);
    this.stage.setProgress(Math.min(1, fr.greenForMs / GREEN_HOLD_MS));

    if (fr.speak && fr.status !== 'green') {
      this.voice.say(fr.speak, { priority: PRIORITY.INFO, key: 'tip', maxWaitMs: 3000 });
    }

    // Amber may start anyway; red blocks (§3.3).
    const wantButton = fr.status === 'amber';
    if (wantButton !== this._amberButton) {
      this._amberButton = wantButton;
      this.stage.setActions(wantButton
        ? [{ label: 'Start anyway', kind: 'secondary', onClick: () => this._framingDone() }]
        : []);
    }

    if (fr.greenForMs >= GREEN_HOLD_MS) this._framingDone();
  }

  _framingDone() {
    if (this._phase !== 'framing') return;
    this._amberButton = null;
    this.stage.drawOpts.guide = false;
    this.voice.cancelAll();
    this.tones.good();
    if (this._forceCalibrate || calibrationDue(this.settings.calibration)) {
      this._enterCalibrate();
    } else {
      this._finish(false);
    }
  }

  // ── Calibration ───────────────────────────────────────────

  _enterCalibrate() {
    this._phase = 'calibrate';
    this._calibrator = new Calibrator({ previous: this.settings.calibration });
    this._lastStep = null;
    this._paused = false;
  }

  _calibrate(frame) {
    const cal = this._calibrator;

    // Only measure while the user is in frame and has been back for 1.5 s.
    // Walking out (or back from tapping the phone) must not count as a held
    // stance or a jab — the first debug log showed exactly that.
    const settled = frame.presence.state === 'TRACKING' || frame.presence.state === 'RESUMING';
    if (!settled) {
      if (!this._paused) {
        this._paused = true;
        cal.pause();
        this.stage.log.event('calibration', { paused: true }, frame.t);
      }
      const fr = frame.framing;
      this.stage.setDetail(fr.tip ?? 'Step back into the picture.');
      if (fr.speak) this.voice.say(fr.speak, { priority: PRIORITY.INFO, key: 'tip', maxWaitMs: 3000 });
      this.stage.debug.extra = { calibration: `${cal.step} paused (not in frame)` };
      return;
    }
    if (this._paused) {
      this._paused = false;
      this.stage.log.event('calibration', { paused: false }, frame.t);
    }

    const r = cal.update(frame);

    if (r.step !== this._lastStep) {
      this._lastStep = r.step;
      this.stage.log.event('calibration', { step: r.step, proposal: cal.proposal }, frame.t);
      this._showStep(cal);
    }
    if (r.event) this.stage.log.event('calibration', { event: r.event, live: cal.reachLive }, frame.t);
    if (r.event === 'handedness_done' || r.event === 'stance_proposed') this.tones.clean();
    if (r.event === 'reach_rep') this.tones.good();
    if (r.event === 'reach_timeout') this.voice.say('Skipping the jabs for now.');

    this.stage.setProgress(r.progress);
    // A calibration step can't work if the user drifted out of frame.
    const fr = frame.framing;
    this.stage.setDetail(fr.status === 'red' ? fr.tip : this._stepDetail(r.step));
    if (fr.status === 'red' && fr.speak) {
      this.voice.say(fr.speak, { priority: PRIORITY.INFO, key: 'tip', maxWaitMs: 3000 });
    }
    const extra = { calibration: `${r.step} ${Math.round(r.progress * 100)}%` };
    const live = cal.reachLive;
    if (r.step === STEPS.REACH && live?.d !== undefined) {
      extra.jab = `reach ${live.d.toFixed(2)} (guard ${live.guardReach.toFixed(2)}, counts > ${(live.guardReach + cal.o.reachOut).toFixed(2)})  ` +
        `elbow ${Math.round(live.elbow)}° (guard ${Math.round(live.guardElbow)}°)  ${live.armed ? 'ready' : 'out'}`;
    } else if (r.step === STEPS.REACH && live) {
      extra.jab = `lead arm hard to see (${live.conf.toFixed(2)})`;
    }
    this.stage.debug.extra = extra;

    if (r.step === STEPS.DONE && this._phase === 'calibrate') this._calibrationDone();
  }

  _stepDetail(step) {
    switch (step) {
      case STEPS.HANDEDNESS: return 'This checks which side is which on your phone.';
      case STEPS.STANCE: return 'Feet in your normal stance, gloves up by your face.';
      case STEPS.REACH: return 'Full extension each time, then hands back to your face.';
      default: return '';
    }
  }

  _showStep(cal) {
    const step = cal.step;
    const actions = [];
    if (step === STEPS.HANDEDNESS) {
      actions.push({ label: 'Skip', kind: 'secondary', onClick: () => { cal.skipHandedness(); } });
    } else if (step === STEPS.CONFIRM_STANCE && cal.proposal.confidence === 'high') {
      // Confident: announce and carry on, so the user doesn't have to walk
      // to the phone mid-calibration. Settings can switch it later.
      const p = cal.proposal;
      this.voice.say(`${p.stance === 'orthodox' ? 'Left' : 'Right'} foot forward. ${cap(p.stance)} stance.`);
      cal.confirmStance(p.stance);
      return;
    } else if (step === STEPS.CONFIRM_STANCE) {
      const p = cal.proposal;
      const other = p.stance === 'orthodox' ? 'southpaw' : 'orthodox';
      actions.push({ label: 'Yes', onClick: () => cal.confirmStance(p.stance) });
      actions.push({ label: `No — ${other}`, kind: 'secondary', onClick: () => cal.confirmStance(other) });
    } else if (step === STEPS.REACH) {
      actions.push({ label: 'Skip', kind: 'secondary', onClick: () => cal.skipReach() });
    }

    let prompt = cal.prompt;
    if (step === STEPS.CONFIRM_STANCE && cal.proposal.confidence === 'low') {
      prompt = `I'm not sure — ${prompt[0].toLowerCase()}${prompt.slice(1)}`;
    }
    this.stage.setPanel({
      chip: 'Calibrating', chipLevel: 'info',
      prompt, detail: this._stepDetail(step), progress: 0, actions,
    });
    if (step !== STEPS.DONE) this.voice.say(prompt.replace(' — ', ', '), { key: 'calib' });
  }

  async _calibrationDone() {
    this._phase = 'saving';
    await this.settings.setCalibration(this._calibrator.result);
    this.stage.log.event('calibration', { result: this._calibrator.result });
    this.voice.say('Calibration done.');
    this._finish(true);
  }

  // ── Done ──────────────────────────────────────────────────

  _finish(calibrated) {
    if (this._next === 'practice') {
      this._phase = null;
      this.bus.emit('navigate:practice');
      return;
    }
    this._phase = 'done';
    this.stage.stop();
    const c = this.settings.calibration;
    this.stage.setPanel({
      chip: calibrated ? 'Calibrated' : 'Ready', chipLevel: 'green',
      prompt: c ? `${cap(c.stance)} stance saved.` : 'Ready.',
      detail: c
        ? `Sides: ${c.swapSides ? 'swapped from MediaPipe labels' : 'MediaPipe labels are correct'}${c.handednessChecked ? '' : ' (not checked)'}. ` +
          `Reach: ${c.reach ? `${c.reach.lead.toFixed(2)} shoulder widths` : 'skipped'}.`
        : '',
      actions: [
        { label: 'Stance check', onClick: () => this.bus.emit('navigate:practice') },
        { label: 'Home', kind: 'secondary', onClick: () => this.bus.emit('navigate:home') },
      ],
    });
  }
}

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
