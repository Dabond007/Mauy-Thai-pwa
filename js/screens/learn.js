/**
 * js/screens/learn.js — Learn mode (§5.2): key points → 3 sets → summaries.
 *
 * Strike techniques (jab, cross): 8 cued reps per set. A soft tick asks for
 * each rep; the tempo starts slow (3 s) and tightens toward 1.8 s while reps
 * are good. A rep is "missed" only if nothing is thrown within 4 s.
 * Hold techniques (stance, guard): a 20 s hold judged in 2 s windows.
 *
 * During a set the voice says only "Hands up" and frame events; per-rep
 * feedback is a tone. Everything else waits for the end-of-set summary,
 * spoken during a 25 s rest. Sets continue on their own (the user is 3 m
 * from the phone); the buttons are optional.
 */

import { PRIORITY } from '../audio/voice.js';
import { RepDetector } from '../technique/rep-detector.js';
import { evaluateRep, evaluateHold, RATING } from '../technique/form-eval.js';
import { GuardMonitor, summarizeSet, PraiseTracker, VERBOSITY_LIMITS } from '../coach/coach.js';

const SETS = 3;
const STRIKE_REPS = 8;
const HOLD_WINDOW_MS = 2000;
const REST_MS = 25000;
const CUE_START_MS = 3000;
const CUE_FASTEST_MS = 1800;
const ATTEMPT_WINDOW_MS = 4000;
const MAX_FRAME_DT_MS = 100;

const fmt = ms => `0:${String(Math.max(0, Math.ceil(ms / 1000))).padStart(2, '0')}`;

export class LearnScreen {
  constructor({ bus, stage, settings, voice, tones, log, techniques, progression, saveProgress }) {
    this.bus = bus;
    this.stage = stage;
    this.settings = settings;
    this.voice = voice;
    this.tones = tones;
    this.log = log;
    this.techniques = techniques;
    this.progression = progression;
    this.saveProgress = saveProgress;
  }

  async open({ technique = 'jab' } = {}) {
    const def = this.techniques[technique];
    const calib = this.settings.calibration;
    if (!calib) {
      this.bus.emit('navigate:setup', { forceCalibrate: true, next: 'learn', nextOpts: { technique } });
      return;
    }
    this.def = def;
    this.calib = calib;
    this.phase = 'intro';
    this.setIndex = 0;
    this.sessionXp = 0;
    this.masteryBefore = this.progression().mastery(def.id);
    this.sessionId = `${new Date().toDateString()}`;
    const limits = VERBOSITY_LIMITS[this.settings.get('verbosity')] ?? VERBOSITY_LIMITS.normal;
    this.guard = new GuardMonitor({ maxPerSet: limits.handsUpPerSet });
    this.praise = new PraiseTracker(limits.thatsItPerSet);
    this.detector = new RepDetector(calib);
    this._lastT = null;
    this._armed = false;

    await this.stage.start({
      title: def.name,
      required: def.required_landmarks,
      onFrame: f => this._onFrame(f),
      onStarted: () => this._intro(),
    });
  }

  close({ keepCamera = false } = {}) {
    this.phase = null;
    this.voice.cancelAll();
    this.voice.setHold(false);
    this.stage.stop({ keepCamera });
    this.stage.debug.extra = {};
  }

  // ── Intro ─────────────────────────────────────────────────

  _intro() {
    const def = this.def;
    this.stage.drawOpts.guide = true;
    this.stage.setPanel({
      chip: `Set 1 of ${SETS}`, chipLevel: 'info',
      prompt: def.name,
      detail: def.key_points.map(k => k.text).join(' '),
      actions: [{ label: 'End', kind: 'secondary', onClick: () => this._finish(true) }],
    });
    this.voice.say(`${def.name}. ${def.key_points.map(k => k.text).join(' ')}`);
    this.log.event('learn', { action: 'open', technique: def.id, calibration: this.calib });
  }

  // ── Frame loop ────────────────────────────────────────────

  _onFrame(frame) {
    if (!this.phase || this.phase === 'done') return;
    for (const ev of frame.presence.events) this._onPresence(ev);

    const tracking = frame.presence.state === 'TRACKING';
    const dt = this._lastT === null ? 0 : Math.min(MAX_FRAME_DT_MS, frame.t - this._lastT);
    this._lastT = frame.t;
    this.stage.drawOpts.guide = !tracking;

    if (this.phase === 'intro') {
      if (this._armed && tracking && !this.voice.busy && this.voice.pending === 0) this._startSet(frame.t);
      return;
    }
    if (this.phase === 'rest') {
      this._rest(frame);
      return;
    }
    if (!tracking) {
      // Paused: freeze the set's clock.
      this.detector.reset();
      this.voice.setHold(false);
      if (this.pending) this.pending.deadline += dt;
      this.nextCueAt += dt;
      return;
    }
    if (this.def.kind === 'hold') this._holdFrame(frame, dt);
    else this._strikeFrame(frame);
    this._debug(frame);
  }

  _onPresence(ev) {
    switch (ev.type) {
      case 'out_of_frame':
        this.voice.say('Out of frame', { priority: PRIORITY.FRAME });
        this.stage.setBanner('Out of frame', 'red');
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
        this._armed = true;
        break;
    }
  }

  // ── Sets ──────────────────────────────────────────────────

  _startSet(t) {
    this.phase = 'set';
    this.results = [];
    this.guard.startSet();
    this.praise.startSet();
    this.detector.reset();
    const hold = this.def.kind === 'hold';
    this.total = hold ? Math.round((this.def.hold_seconds * 1000) / HOLD_WINDOW_MS) : STRIKE_REPS;
    this.interval = CUE_START_MS;
    this.pending = null;
    this.cues = 0;
    this.holdMs = 0;
    this.window = [];
    this.stage.setChip(`Set ${this.setIndex + 1} of ${SETS}`, 'green');
    this.stage.setStrip([], this.total);
    if (hold) {
      const line = this.def.id === 'guard' ? 'Guard up and hold.' : 'Stance and hold.';
      this.stage.setPrompt(`${line} ${this.def.hold_seconds} seconds.`);
      this.voice.say(line);
    } else {
      this.stage.setPrompt(`${this.def.name}: one on each tick.`);
      this.voice.say(`${this.def.name}s. One on each tick.`);
    }
    // First cue once the line has been said.
    this.nextCueAt = t + 2200;
    this.log.event('learn', { action: 'set_start', set: this.setIndex + 1, technique: this.def.id }, t);
  }

  _strikeFrame(frame) {
    const t = frame.t;
    const out = this.detector.update(frame);
    this.voice.setHold(this.detector.striking);

    if (this.guard.update(frame, this.detector.striking)) {
      this.voice.say('Hands up', { priority: PRIORITY.GUARD, key: 'handsup' });
      this.log.event('learn', { action: 'hands_up' }, t);
    }

    if (out?.type === 'rep') {
      if (this.pending && out.tStart >= this.pending.cueT - 300) {
        this._scoreRep(evaluateRep(this.def, out, this.calib), out, t);
      } else {
        this.log.event('learn', { action: 'extra_rep', technique: out.technique }, t);
      }
    }

    if (this.pending && t > this.pending.deadline && !this.detector.striking) {
      this._scoreRep({ technique: null, expected: this.def.id, rating: RATING.MISSED, noAttempt: true, checks: {}, faults: [] }, null, t);
    }

    if (!this.pending && this.cues < this.total && t >= this.nextCueAt && !this.detector.striking) {
      this.cues++;
      this.pending = { cueT: t, deadline: t + ATTEMPT_WINDOW_MS };
      this.tones.cue();
      this.stage.setPrompt(`${this.def.name} ${this.cues} of ${this.total}`);
      this.log.event('learn', { action: 'cue', rep: this.cues }, t);
    }

    if (this.results.length >= this.total) this._endSet(t);
  }

  _scoreRep(result, rep, t) {
    this.pending = null;
    this.results.push(result);
    const p = this.progression();
    const scored = p.recordRep(this.def.id, result.rating);
    this.sessionXp += scored.xp;
    if (result.rating === RATING.CLEAN) this.tones.clean();
    else if (result.rating === RATING.GOOD) this.tones.good();
    else if (result.rating === RATING.FIX) this.tones.fix();
    if (this.praise.onRep(result)) this.voice.say('That’s it', { priority: PRIORITY.PRAISE });

    // Tempo: tighten while it's going well, ease off when it isn't (§5.2).
    const ok = result.rating === RATING.CLEAN || result.rating === RATING.GOOD;
    this.interval = Math.max(CUE_FASTEST_MS, Math.min(CUE_START_MS, this.interval + (ok ? -200 : 200)));
    this.nextCueAt = Math.max(t + 700, (rep?.tStart ?? t) + this.interval);

    this.stage.setStrip(this.results.map(r => r.rating), this.total);
    this.stage.setTimer(`XP ${this.sessionXp}`);
    this._lastResult = result;
    this.log.event('learn', {
      action: 'rep', rating: result.rating, technique: result.technique, wrong: !!result.wrongTechnique,
      checks: Object.fromEntries(Object.entries(result.checks).map(([k, v]) => [k, [v.result, v.value]])),
      ext: rep ? [rep.peakExt, rep.otherExt] : null, xp: scored.xp,
    }, t);
  }

  _holdFrame(frame, dt) {
    if (this.guard.update(frame, false)) {
      this.voice.say('Hands up', { priority: PRIORITY.GUARD, key: 'handsup' });
    }
    this.holdMs += dt;
    this.window.push(frame);
    this.stage.setTimer(fmt(this.def.hold_seconds * 1000 - this.holdMs));
    if (this.holdMs >= (this.results.length + 1) * HOLD_WINDOW_MS) {
      const result = evaluateHold(this.def, this.window, this.calib);
      this.window = [];
      this.results.push(result);
      this.sessionXp += this.progression().recordRep(this.def.id, result.rating).xp;
      this.stage.setStrip(this.results.map(r => r.rating), this.total);
      this.log.event('learn', {
        action: 'window', rating: result.rating,
        checks: Object.fromEntries(Object.entries(result.checks).map(([k, v]) => [k, [v.result, v.value]])),
      }, frame.t);
    }
    if (this.results.length >= this.total) this._endSet(frame.t);
  }

  async _endSet(t) {
    this.phase = 'rest';
    this.voice.setHold(false);
    const p = this.progression();
    const mastery = p.mastery(this.def.id);
    const summary = summarizeSet({ def: this.def, results: this.results, mastery });
    const change = p.endSet(this.def.id, this.results, this.sessionId);
    this.praise.setFocus(summary.focus?.id ?? null);
    await this.saveProgress();

    this.setIndex++;
    const last = this.setIndex >= SETS;
    if (summary.speak) this.voice.say(summary.lines.join(' '), { key: 'summary' });
    if (change.after !== change.before && [ 'solid', 'sharp' ].includes(change.after)) {
      this.voice.say(`${this.def.name} is now ${change.after}.`);
    }
    this.stage.setPrompt(summary.lines[0]);
    this.stage.setDetail(summary.lines.slice(1).join(' '));
    this.stage.setChip(last ? 'Done' : `Rest · next: set ${this.setIndex + 1} of ${SETS}`, 'info');
    this.restUntil = last ? null : t + REST_MS;
    this.stage.setActions(last ? [] : [
      { label: 'Next set', onClick: () => { this.restUntil = 0; } },
      { label: 'End', kind: 'secondary', onClick: () => this._finish(true) },
    ]);
    this.log.event('learn', { action: 'summary', lines: summary.lines, counts: summary.counts, mastery: change }, t);
    if (last) this._finish(false);
  }

  _rest(frame) {
    if (this.restUntil === null) return;
    const left = this.restUntil - frame.t;
    this.stage.setTimer(fmt(left));
    if (left <= 0 && !this.voice.busy && this.voice.pending === 0) {
      this.stage.setActions([{ label: 'End', kind: 'secondary', onClick: () => this._finish(true) }]);
      this._startSet(frame.t);
    }
  }

  // ── Finish ────────────────────────────────────────────────

  async _finish(early) {
    if (this.phase === 'done') return;
    const wasRest = this.phase === 'rest';
    this.phase = 'done';
    this.voice.setHold(false);
    const p = this.progression();
    if (this.setIndex > 0) p.completeSession();
    await this.saveProgress();
    const after = p.mastery(this.def.id);
    if (!early) this.tones.bell();
    if (!early || !wasRest) this.voice.say(`${this.def.name} done. ${this.sessionXp} XP.`);
    this.stage.stop();
    this.stage.setBanner(null);
    this.stage.setPanel({
      chip: early ? 'Ended' : 'Done', chipLevel: 'green',
      prompt: `${this.def.name}: +${this.sessionXp} XP`,
      detail: `Mastery: ${after}${after !== this.masteryBefore ? ` (was ${this.masteryBefore})` : ''}. Level ${p.level}.`,
      actions: [
        { label: 'Again', onClick: () => this.open({ technique: this.def.id }) },
        { label: 'Home', kind: 'secondary', onClick: () => this.bus.emit('navigate:home') },
      ],
    });
    this.log.event('learn', { action: 'finish', early, xp: this.sessionXp, mastery: after });
  }

  _debug(frame) {
    const d = this.detector;
    const r = this._lastResult;
    this.stage.debug.extra = {
      rep: `${d.state} ext L ${d.ext.lead.toFixed(2)} R ${d.ext.rear.toFixed(2)}`,
      last: r ? `${r.rating}${r.wrongTechnique ? ` (${r.technique})` : ''} ` +
        Object.entries(r.checks).map(([k, v]) => `${k}:${v.result[0]}`).join(' ') : '—',
    };
  }
}
