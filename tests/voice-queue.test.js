import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VoiceQueue, PRIORITY, estimateSpeechMs } from '../js/audio/voice-queue.js';

/** Fake clock + timers + speech backend. */
function harness({ autoStart = true } = {}) {
  let now = 0;
  let timers = [];
  let nextId = 1;
  const spoken = [];
  const cancels = [];
  let lastOpts = null;

  const backend = {
    speak(text, opts) {
      spoken.push(text);
      lastOpts = opts;
      if (autoStart) opts.onstart();
    },
    cancel() { cancels.push(now); },
  };
  const q = new VoiceQueue({
    backend,
    now: () => now,
    setTimer: (fn, ms) => { const id = nextId++; timers.push({ id, at: now + ms, fn }); return id; },
    clearTimer: id => { timers = timers.filter(t => t.id !== id); },
  });
  const advance = ms => {
    const end = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > end) break;
      timers.shift();
      now = next.at;
      next.fn();
    }
    now = end;
  };
  return { q, spoken, cancels, advance, end: () => lastOpts.onend(), get now() { return now; } };
}

test('same priority waits its turn', () => {
  const h = harness();
  h.q.say('First instruction here', { priority: PRIORITY.INFO });
  h.q.say('Second', { priority: PRIORITY.INFO });
  assert.deepEqual(h.spoken, ['First instruction here']);
  h.advance(estimateSpeechMs('First instruction here') + 1);
  assert.deepEqual(h.spoken, ['First instruction here', 'Second']);
});

test('higher priority cuts off lower priority', () => {
  const h = harness();
  h.q.say('A long summary sentence that goes on', { priority: PRIORITY.INFO });
  h.advance(300);
  h.q.say('Out of frame', { priority: PRIORITY.FRAME });
  assert.deepEqual(h.spoken, ['A long summary sentence that goes on', 'Out of frame']);
  assert.equal(h.cancels.length, 1);
});

test('lower priority never cuts off higher priority', () => {
  const h = harness();
  h.q.say('Out of frame', { priority: PRIORITY.FRAME });
  h.q.say('That is it', { priority: PRIORITY.PRAISE });
  assert.deepEqual(h.spoken, ['Out of frame']);
  assert.equal(h.cancels.length, 0);
});

test('advances on the estimated duration even if onend never fires', () => {
  const h = harness();
  h.q.say('Hands up', { priority: PRIORITY.GUARD });
  h.q.say('Next', { priority: PRIORITY.GUARD });
  h.advance(estimateSpeechMs('Hands up') + 1);
  assert.equal(h.spoken.at(-1), 'Next');
});

test('an immediate (bogus) onend is ignored; a plausible one advances early', () => {
  const h = harness();
  const text = 'Get in your fighting stance and hold still';
  h.q.say(text);
  h.q.say('Next');
  h.end();                       // fires at t=0: ignored
  assert.equal(h.spoken.length, 1);
  h.advance(estimateSpeechMs(text) * 0.7);
  h.end();                       // plausible: advances now
  assert.equal(h.spoken.at(-1), 'Next');
});

test('start watchdog re-issues once when onstart never arrives', () => {
  const h = harness({ autoStart: false });
  h.q.say('Back in frame', { priority: PRIORITY.FRAME });
  h.advance(1300);
  assert.deepEqual(h.spoken, ['Back in frame', 'Back in frame']);
  assert.equal(h.cancels.length, 1);
  h.advance(5000);
  assert.equal(h.spoken.length, 2, 'only one retry');
});

test('hold blocks everything except frame events', () => {
  const h = harness();
  h.q.setHold(true);
  h.q.say('Nice', { priority: PRIORITY.PRAISE, maxWaitMs: 10000 });
  assert.deepEqual(h.spoken, []);
  h.q.say('Out of frame', { priority: PRIORITY.FRAME });
  assert.deepEqual(h.spoken, ['Out of frame']);
  h.advance(2000);
  assert.deepEqual(h.spoken, ['Out of frame']);
  h.q.setHold(false);
  assert.deepEqual(h.spoken, ['Out of frame', 'Nice']);
});

test('stale cues expire instead of playing late', () => {
  const h = harness();
  h.q.say('A very long instruction that takes several seconds to read out loud');
  h.q.say('Hands up', { priority: PRIORITY.GUARD });   // cuts in
  h.q.say('That is it', { priority: PRIORITY.PRAISE, maxWaitMs: 500 }); // waits, then expires
  h.advance(10000);
  assert.ok(!h.spoken.includes('That is it'));
});

test('a keyed item replaces its queued predecessor', () => {
  const h = harness();
  h.q.say('Busy talking now');
  h.q.say('Come a little closer', { key: 'tip' });
  h.q.say('Step back a little', { key: 'tip' });
  h.advance(20000);
  assert.deepEqual(h.spoken, ['Busy talking now', 'Step back a little']);
});

test('say() returns an ETA that includes what is ahead in the queue', () => {
  const h = harness();
  h.q.say('Jab, cross, low kick.');
  const eta = h.q.say('Go');
  assert.ok(eta >= estimateSpeechMs('Jab, cross, low kick.'));
});

test('disabled queue says nothing', () => {
  const h = harness();
  h.q.enabled = false;
  h.q.say('Hello');
  assert.deepEqual(h.spoken, []);
});
