/**
 * js/technique/registry.js — loads technique definitions (data/techniques/*.json, §7.5).
 */

export const TECHNIQUE_IDS = Object.freeze(['stance', 'guard', 'jab', 'cross']);

/** Learning path (§9.3); Phase B covers the first two steps. */
export const LEARNING_PATH = Object.freeze([
  ['stance', 'guard'],
  ['jab', 'cross'],
]);

const browserLoader = async id => {
  const res = await fetch(new URL(`../../data/techniques/${id}.json`, import.meta.url));
  if (!res.ok) throw new Error(`Couldn't load technique ${id}`);
  return res.json();
};

/**
 * @param {(id:string) => Promise<object>} [load]  injectable for Node tests
 * @returns {Promise<Object<string, object>>}
 */
export async function loadTechniques(load = browserLoader) {
  const out = {};
  for (const id of TECHNIQUE_IDS) out[id] = await load(id);
  return out;
}
