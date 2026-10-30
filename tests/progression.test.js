import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Progression, levelFor, xpForLevel, MASTERY } from '../js/progression.js';

const set = (n, good) => Array.from({ length: n }, (_, i) => ({ rating: i < good ? 'clean' : 'fix', checks: { a: { result: 'pass' } } }));

test('XP per rating and streak multipliers on Clean/Good only', () => {
  const p = new Progression();
  let total = 0;
  for (let i = 0; i < 4; i++) total += p.recordRep('jab', 'clean').xp;
  assert.equal(total, 40);
  assert.equal(p.recordRep('jab', 'clean').multiplier, 1.5);   // 5th
  assert.equal(p.recordRep('jab', 'fix').xp, 2);                 // no multiplier, streak kept
  assert.equal(p.data.streak, 5);
  assert.equal(p.recordRep('jab', 'good').xp, 9);                // 6 × 1.5
  assert.equal(p.recordRep('jab', 'missed').xp, 0);
  assert.equal(p.data.streak, 0);
});

test('mastery: Learning after a set, Solid after two ≥80 % sets, Sharp across 3 sessions', () => {
  const p = new Progression();
  assert.equal(p.mastery('jab'), MASTERY.NEW);
  p.endSet('jab', set(8, 5), 's1');
  assert.equal(p.mastery('jab'), MASTERY.LEARNING);
  p.endSet('jab', set(8, 7), 's1');
  assert.equal(p.mastery('jab'), MASTERY.LEARNING);
  p.endSet('jab', set(8, 7), 's1');
  assert.equal(p.mastery('jab'), MASTERY.SOLID);
  p.endSet('jab', set(8, 8), 's1');
  p.endSet('jab', set(8, 8), 's2');
  assert.equal(p.mastery('jab'), MASTERY.SOLID);
  p.endSet('jab', set(8, 8), 's3');
  assert.equal(p.mastery('jab'), MASTERY.SHARP);
});

test('reps with nothing measurable do not count toward mastery', () => {
  const p = new Progression();
  const blind = Array.from({ length: 8 }, () => ({ rating: 'clean', checks: { a: { result: 'unknown' } } }));
  p.endSet('jab', blind, 's1');
  assert.equal(p.data.techniques.jab.sets[0].n, 0);
});

test('jab and cross unlock when stance and guard are Solid', () => {
  const p = new Progression();
  assert.equal(p.unlocked('stance'), true);
  assert.equal(p.unlocked('jab'), false);
  for (const id of ['stance', 'guard']) { p.endSet(id, set(10, 10), 's'); p.endSet(id, set(10, 10), 's'); }
  assert.equal(p.unlocked('jab'), true);
});

test('levels: fast early, monotonic', () => {
  assert.equal(levelFor(0), 1);
  assert.equal(levelFor(xpForLevel(2)), 2);
  for (let l = 2; l < 30; l++) assert.ok(xpForLevel(l + 1) > xpForLevel(l));
  assert.ok(xpForLevel(2) <= 80, 'level 2 within one good session');
});

test('daily streak counts consecutive days', () => {
  const p = new Progression();
  p.completeSession(new Date(2026, 9, 1));
  p.completeSession(new Date(2026, 9, 2));
  p.completeSession(new Date(2026, 9, 2));
  assert.equal(p.data.days.count, 2);
  p.completeSession(new Date(2026, 9, 5));
  assert.equal(p.data.days.count, 1);
});
