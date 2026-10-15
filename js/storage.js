/**
 * js/storage.js — tiny IndexedDB key-value store (on the phone only, §10).
 * Holds settings and calibration now; progress and history later (Phase D).
 */

const DB_NAME = 'nak-muay';
const DB_VERSION = 1;
const STORE = 'kv';

let _dbPromise = null;

function open() {
  _dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const storage = {
  get: key => run('readonly', s => s.get(key)),
  set: (key, value) => run('readwrite', s => s.put(value, key)),
  del: key => run('readwrite', s => s.delete(key)),
  /** "Delete everything" (§10.6). */
  clearAll: () => run('readwrite', s => s.clear()),
};
