/**
 * js/settings.js — user settings and calibration, persisted in IndexedDB.
 * Emits 'settings:changed' / 'calibration:changed' on the bus.
 */

import { storage } from './storage.js';

export const DEFAULT_SETTINGS = Object.freeze({
  voiceRate: 1.0,
  voiceVolume: 1.0,
  verbosity: 'normal',     // quiet | normal | chatty (limits scale in Phase B)
  tones: true,
  debug: false,
  recordLog: false,        // opt-in debug log (numbers only, in memory), §10.5
  model: 'full',           // only 'full' ships (heavy too slow on Pixel 9)
});

export class Settings {
  constructor(bus) {
    this._bus = bus;
    this.values = { ...DEFAULT_SETTINGS };
    this.calibration = null;
  }

  async load() {
    try {
      const [values, calibration] = await Promise.all([
        storage.get('settings'),
        storage.get('calibration'),
      ]);
      this.values = { ...DEFAULT_SETTINGS, ...(values ?? {}), model: 'full' };
      this.calibration = calibration ?? null;
    } catch (e) {
      console.warn('[Settings] IndexedDB unavailable, using defaults:', e);
    }
    // ?debug=1 forces the overlay on for this visit.
    if (new URLSearchParams(location.search).get('debug') === '1') this.values.debug = true;
  }

  get(key) {
    return this.values[key];
  }

  async set(key, value) {
    this.values[key] = value;
    this._bus.emit('settings:changed', { key, value, values: this.values });
    await storage.set('settings', { ...this.values }).catch(() => {});
  }

  async setCalibration(calibration) {
    this.calibration = calibration;
    this._bus.emit('calibration:changed', calibration);
    await storage.set('calibration', calibration).catch(() => {});
  }

  /** Switch stance without re-calibrating (lead/rear mappings follow it). */
  async setStance(stance) {
    const c = this.calibration;
    if (!c || c.stance === stance) return;
    await this.setCalibration({
      ...c,
      stance,
      guard: swapLeadRear(c.guard),
      elbows: swapLeadRear(c.elbows),
      guardReach: swapLeadRear(c.guardReach),
    });
  }

  async deleteEverything() {
    await storage.clearAll();
    this.values = { ...DEFAULT_SETTINGS };
    this.calibration = null;
    this._bus.emit('settings:changed', { values: this.values });
    this._bus.emit('calibration:changed', null);
  }
}

/**
 * Per-side measurements are stored as lead/rear. Switching stance turns the
 * old lead arm into the new rear arm, so the two swap.
 */
function swapLeadRear(obj) {
  return obj ? { lead: obj.rear, rear: obj.lead } : obj;
}
