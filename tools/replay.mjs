#!/usr/bin/env node
/**
 * tools/replay.mjs — replay a downloaded debug log through the same pipeline.
 *
 *   node tools/replay.mjs nakmuay-log-….json
 *
 * Prints the logged events, landmark visibility statistics, framing results
 * over time, and (during calibration's reach step) the jab metrics.
 */

import { readFileSync } from 'node:fs';
import { decodeFrame } from '../js/debug/log.js';
import { PosePipeline } from '../js/pose/pipeline.js';
import { median } from '../js/pose/geometry.js';

const file = process.argv[2];
if (!file) {
  console.error('usage: node tools/replay.mjs <log.json>');
  process.exit(1);
}
const log = JSON.parse(readFileSync(file, 'utf8'));
const frames = log.frames.map(decodeFrame);
const events = log.events ?? [];
const f2 = v => (Number.isFinite(v) ? v.toFixed(2) : '—');
const t0 = frames[0]?.t ?? 0;
const ts = t => ((t - t0) / 1000).toFixed(1).padStart(6);

console.log(`log v${log.logVersion}  exported ${log.exportedAt}`);
console.log(`${log.userAgent}`);
console.log(`${frames.length} frames over ${((frames.at(-1).t - t0) / 1000).toFixed(1)} s, ` +
  `${frames.filter(f => f.image).length} with a pose, median inference ${f2(median(frames.map(f => f.inferenceMs)))} ms\n`);

console.log('── events ──');
for (const e of events) {
  const { t, type, ...rest } = e;
  if (type === 'framing') console.log(`${ts(t)}s framing ${rest.status} [${rest.issues.join(',')}] missing=${JSON.stringify(rest.missing ?? [])}`);
  else if (type === 'screen') console.log(`${ts(t)}s screen "${rest.title}" model=${rest.model}/${rest.delegate} cam=${rest.camera?.width}x${rest.camera?.height} calib=${rest.calibration ? rest.calibration.stance : 'none'}`);
  else console.log(`${ts(t)}s ${type} ${JSON.stringify(rest)}`);
}

console.log('\n── visibility (median / 10th percentile) ──');
const NAMES = { 0: 'nose', 11: 'mpL shoulder', 12: 'mpR shoulder', 13: 'mpL elbow', 14: 'mpR elbow',
  15: 'mpL wrist', 16: 'mpR wrist', 23: 'mpL hip', 24: 'mpR hip', 25: 'mpL knee', 26: 'mpR knee',
  27: 'mpL ankle', 28: 'mpR ankle', 29: 'mpL heel', 30: 'mpR heel', 31: 'mpL toe', 32: 'mpR toe' };
const withPose = frames.filter(f => f.image);
for (const [i, name] of Object.entries(NAMES)) {
  const v = withPose.map(f => f.image[i].visibility).sort((a, b) => a - b);
  console.log(`${name.padEnd(14)} ${f2(median(v))} / ${f2(v[Math.floor(v.length * 0.1)])}`);
}

// Find calibration (for lead/rear) and the reach step window from events.
const result = [...events].reverse().find(e => e.type === 'calibration' && e.result)?.result
  ?? [...events].reverse().find(e => e.type === 'screen' && e.calibration)?.calibration ?? null;
const reachStart = events.find(e => e.type === 'calibration' && e.step === 'reach')?.t;
const reachEnd = events.find(e => e.type === 'calibration' && e.step === 'done')?.t ?? Infinity;

console.log('\n── every 0.5 s ──');
console.log('    t  framing  feet-vis(L/R)  reachL  elbowL  conf  presence');
const pipe = new PosePipeline({ calibration: result });
let next = -Infinity;
for (const raw of frames) {
  const fr = pipe.process(raw);
  if (raw.t < next) continue;
  next = raw.t + 500;
  const b = fr.body;
  const feet = raw.image
    ? `${f2(Math.max(...[27, 29, 31].map(i => raw.image[i].visibility)))}/${f2(Math.max(...[28, 30, 32].map(i => raw.image[i].visibility)))}`
    : '—';
  const inReach = raw.t >= (reachStart ?? Infinity) && raw.t <= reachEnd;
  console.log(`${ts(raw.t)} ${fr.framing.status.padEnd(7)} ${feet.padEnd(14)} ` +
    `${b.valid ? f2(b.reach.lead) : '—'}`.padEnd(7) + ` ${b.valid ? Math.round(b.angles.lead.elbow) : '—'}`.padEnd(7) +
    ` ${b.valid ? f2(b.confidence.lead.arm) : '—'}  ${fr.presence.state}${inReach ? '  [reach step]' : ''}`);
}
