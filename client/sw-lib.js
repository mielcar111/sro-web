// @ts-check
/**
 * Pure service-worker logic, split out so vitest imports THIS file — the SW
 * (sw.js, a module worker) and the tests share one source of truth.
 *
 * Plan invariants (docs at .ideas/pwa-versioning-plan.md + the approved plan):
 *  - the SW never serves or gates CODE — only manifest-listed /assets/ paths
 *  - every cache write is hash-verified against the manifest
 *  - cache writes may fail (quota) without breaking the response
 */

export const ASSET_CACHE = "game-assets";
export const META_CACHE = "mmo-meta";
export const META_KEY = "/__meta";

/**
 * Requests carrying this header are the patcher's own verified downloads — the
 * SW must not intercept them: mid-patch its manifest snapshot is stale by
 * design (meta flips last), so it would fetch-verify-refetch every changed
 * file a second time. Mirrored as a literal in src/patcher/cache.ts (TS can't
 * import this file); a vitest asserts the two stay equal.
 */
export const PATCHER_BYPASS_HEADER = "x-mmo-patcher";

/**
 * Should the SW intercept this request? Same-origin GET under /assets/ only —
 * shell bundles (/app/*), HTML, version.json, manifests and the API always go
 * to the network untouched.
 * @param {string} method
 * @param {string} origin
 * @param {string} selfOrigin
 * @param {string} pathname
 */
export function shouldHandle(method, origin, selfOrigin, pathname) {
  return method === "GET" && origin === selfOrigin && pathname.startsWith("/assets/");
}

/**
 * Manifest key for an /assets/ pathname ("/assets/models/x.glb" → "models/x.glb"),
 * decoded because manifest keys are raw file paths while URLs may be %-encoded.
 * @param {string} pathname
 */
export function manifestKey(pathname) {
  try {
    return decodeURIComponent(pathname.slice("/assets/".length));
  } catch {
    return pathname.slice("/assets/".length);
  }
}

/**
 * sha256 hex of a buffer (crypto.subtle exists in workers, windows and node).
 * @param {ArrayBuffer} buf
 */
export async function sha256Hex(buf) {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Read the patcher meta blob ({version, manifest}) from the meta cache.
 * Returns null when absent (first run, cleared storage, SW-less sessions).
 * @param {CacheStorage} cachesObj
 * @returns {Promise<{version: string, manifest: {files: Record<string, {h: string, s: number}>}} | null>}
 */
export async function readMeta(cachesObj) {
  try {
    const cache = await cachesObj.open(META_CACHE);
    const res = await cache.match(META_KEY);
    if (!res) return null;
    return await res.json();
  } catch {
    return null;
  }
}
