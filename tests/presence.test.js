import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PresenceMonitor, PRESENCE } from '../js/pose/framing.js';
import { LM } from '../js/pose/landmarks.js';
import { frame } from './helpers/synthetic.js';

const IN = frame().image;
const FPS = 30;
const STEP = 1000 / FPS;

/** Feed `ms` of `image` starting at t; returns [events, endT]. */
function feed(m, image, t, ms) {
  const events = [];
  const end = t + ms;
  for (; t < end; t += STEP) events.push(...m.update(image, t).events);
  return [events, t];
}

const types = evs => evs.map(e => (e.type === 'countdown' ? `countdown${e.n}` : e.type));

/** Run the initial acquisition to TRACKING. */
function acquire(m) {
  const [events, t] = feed(m, IN, 0, 1500 + 3000 + 100);
  return { events, t };
}

test('session start: stable 1.5 s → 3-2-1 → tracking, without "Back in frame"', () => {
  const m = new PresenceMonitor('full');
  const { events } = acquire(m);
  assert.deepEqual(types(events), ['back_in_frame', 'countdown3', 'countdown2', 'countdown1', 'tracking']);
  assert.equal(events[0].first, true);
  assert.equal(m.state, PRESENCE.TRACKING);
});

test('dropout under 1 s triggers nothing', () => {
  const m = new PresenceMonitor('full');
  let { t } = acquire(m);
  let events;
  [events, t] = feed(m, null, t, 900);
  assert.deepEqual(events, []);
  [events, t] = feed(m, IN, t, 500);
  assert.deepEqual(events, []);
  assert.equal(m.state, PRESENCE.TRACKING);
});

test('lost > 1 s → out_of_frame once; back 1.5 s → back_in_frame, 3-2-1, tracking', () => {
  const m = new PresenceMonitor('full');
  let { t } = acquire(m);
  let events;
  [events, t] = feed(m, null, t, 3000);
  assert.deepEqual(types(events), ['out_of_frame']);
  assert.equal(m.active, false);
  assert.equal(m.outOfFrameCount, 1);

  [events, t] = feed(m, IN, t, 1400);
  assert.deepEqual(events, []);
  [events, t] = feed(m, IN, t, 1200 + 3300);
  assert.deepEqual(types(events), ['back_in_frame', 'countdown3', 'countdown2', 'countdown1', 'tracking']);
  assert.equal(events[0].first, false);
  assert.equal(m.active, true);
});

test('10 walk-outs fire 10 out/back pairs', () => {
  const m = new PresenceMonitor('full');
  let { t } = acquire(m);
  let outs = 0;
  let backs = 0;
  for (let i = 0; i < 10; i++) {
    let ev;
    [ev, t] = feed(m, null, t, 2000);
    outs += ev.filter(e => e.type === 'out_of_frame').length;
    [ev, t] = feed(m, IN, t, 6000);
    backs += ev.filter(e => e.type === 'back_in_frame').length;
  }
  assert.equal(outs, 10);
  assert.equal(backs, 10);
});

test('fast arm movement (wrists blurred / low visibility) never triggers out of frame', () => {
  const m = new PresenceMonitor('full');
  let { t } = acquire(m);
  const blurred = frame({ jab: 1, vis: { [LM.L_WRIST]: 0.1, [LM.R_WRIST]: 0.1, [LM.L_ELBOW]: 0.2 } }).image;
  const [events] = feed(m, blurred, t, 5000);
  assert.deepEqual(events, []);
  assert.equal(m.state, PRESENCE.TRACKING);
});

test('a kick that blurs one ankle briefly does not trigger', () => {
  const m = new PresenceMonitor('full');
  let { t } = acquire(m);
  const kick = frame({ vis: { [LM.R_ANKLE]: 0.2 } }).image;
  let events;
  [events, t] = feed(m, kick, t, 700);
  assert.deepEqual(events, []);
});

test('upper-body drills ignore the legs', () => {
  const m = new PresenceMonitor('upper');
  let { t } = acquire(m);
  const noLegs = frame({ vis: {
    [LM.L_ANKLE]: 0.1, [LM.R_ANKLE]: 0.1, [LM.L_KNEE]: 0.1, [LM.R_KNEE]: 0.1,
    [LM.L_HEEL]: 0.1, [LM.R_HEEL]: 0.1, [LM.L_FOOT]: 0.1, [LM.R_FOOT]: 0.1,
  } }).image;
  const [events] = feed(m, noLegs, t, 3000);
  assert.deepEqual(events, []);

  const full = new PresenceMonitor('full');
  let r = acquire(full);
  const [ev2] = feed(full, noLegs, r.t, 3000);
  assert.deepEqual(types(ev2), ['out_of_frame']);
});

test('hysteresis: visibility hovering between thresholds does not flap', () => {
  const m = new PresenceMonitor('full');
  let { t } = acquire(m);
  const hover = frame({ visibility: 0.55 }).image;   // above "lost", below "present"
  const [events] = feed(m, hover, t, 5000);
  assert.deepEqual(events, []);
  assert.equal(m.state, PRESENCE.TRACKING);
});

test('lost again during the first countdown restarts acquisition silently', () => {
  const m = new PresenceMonitor('full');
  let [events, t] = feed(m, IN, 0, 2000);   // into RESUMING
  assert.equal(m.state, PRESENCE.RESUMING);
  [events, t] = feed(m, null, t, 1500);
  assert.ok(!events.some(e => e.type === 'out_of_frame' || e.type === 'tracking'), JSON.stringify(events));
  assert.equal(m.state, PRESENCE.ACQUIRING);
});

test('a knee hovering at low visibility does not hold "Out of frame"', () => {
  const m = new PresenceMonitor('full');
  let { t } = acquire(m);
  const knee = frame({ vis: { [LM.R_KNEE]: 0.45 } }).image;
  const [events] = feed(m, knee, t, 5000);
  assert.deepEqual(events, []);
});

test('resume is not reset by a landmark hovering between thresholds', () => {
  const m = new PresenceMonitor('full');
  let { t } = acquire(m);
  let ev;
  [ev, t] = feed(m, null, t, 2000);
  const hover = frame({ vis: { [LM.R_ANKLE]: 0.55, [LM.R_HEEL]: 0.55, [LM.R_FOOT]: 0.55 } }).image;
  // alternate good / hovering frames: should still resume after 1.5 s
  const events = [];
  for (let i = 0; i < 60; i++, t += 1000 / 30) events.push(...m.update(i % 2 ? hover : IN, t).events);
  assert.ok(events.some(e => e.type === 'back_in_frame'));
});
