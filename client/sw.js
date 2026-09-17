// @ts-check
/**
 * Game asset service worker — a dumb, VERSION-AGNOSTIC verified byte cache.
 *
 * Scope: same-origin GET /assets/* only, and only paths listed in the stored
 * manifest (mmo-meta cache, written by the patcher). Everything else —
 * HTML, /app/* shell bundles, /version.json, /manifests/*, /api/* — passes
 * straight to the network: the SW NEVER serves or gates code (the server
 * version gate is the only code gate), so game deploys never need to change
 * this file, which defuses the whole SW-update-lifecycle risk class.
 *
 * Writes are sha256-verified against the manifest before cache.put; a
 * mismatch retries once with cache:"reload" (busts the HTTP cache), then
 * serves the body WITHOUT caching (availability over integrity — heals on
 * the next patch). Quota errors are non-fatal. Registered as a module worker.
 */
import {
  ASSET_CACHE,
  manifestKey,
  PATCHER_BYPASS_HEADER,
  readMeta,
  sha256Hex,
  shouldHandle,
} from "./sw-lib.js";

const sw = /** @type {ServiceWorkerGlobalScope & typeof globalThis} */ (/** @type {unknown} */ (self));

/** In-memory manifest snapshot; null until loaded. Refreshed on "meta-updated". */
let manifestFiles = null;
let netFetches = 0; // E2E observability: real network asset fetches this SW served

async function loadMeta() {
  const meta = await readMeta(caches);
  manifestFiles = meta?.manifest?.files ?? null;
}

sw.addEventListener("install", () => {
  sw.skipWaiting();
});
sw.addEventListener("activate", (e) => {
  e.waitUntil(Promise.all([sw.clients.claim(), loadMeta()]));
});
sw.addEventListener("message", (e) => {
  const data = e.data;
  if (data && data.type === "meta-updated") e.waitUntil?.(loadMeta());
  if (data && data.type === "get-net-fetches")
    e.source?.postMessage({ type: "net-fetches", count: netFetches });
});

/**
 * Serve-then-verify: the loader gets cold bytes at network speed; sha256 +
 * cache.put run in the background via waitUntil. A mismatched body is served
 * ONCE uncached — the same availability-over-integrity stance the old
 * verify-before-serve path already took after its failed retry — and NEVER
 * poisons the cache; the background retry (cache:"reload") heals the cached
 * copy for the next request. This removes ~150MB of crypto.subtle latency
 * from a first city visit's critical path.
 * @param {Request} req
 * @param {{h: string, s: number} | undefined} entry
 * @param {(p: Promise<unknown>) => void} waitUntil
 */
async function cacheFirst(req, entry, waitUntil) {
  const cache = await caches.open(ASSET_CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;

  netFetches++;
  const res = await fetch(req);
  if (!res.ok || res.status !== 200) return res; // partial/error bodies never cached

  const verifyClone = res.clone();
  const putClone = res.clone();
  waitUntil(
    (async () => {
      try {
        if (entry) {
          if ((await sha256Hex(await verifyClone.arrayBuffer())) !== entry.h) {
            // bust a poisoned HTTP cache and refill with a verified copy
            const res2 = await fetch(new Request(req.url, { cache: "reload" }));
            if (!res2.ok || res2.status !== 200) return;
            const body2 = await res2.clone().arrayBuffer();
            if ((await sha256Hex(body2)) !== entry.h) return; // still bad — stay uncached
            await cache.put(req, res2);
            return;
          }
        }
        await cache.put(req, putClone);
      } catch {
        // quota/write failure — non-fatal, the session just stays networked
      }
    })(),
  );
  return res;
}

sw.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.headers.get(PATCHER_BYPASS_HEADER)) return; // patcher traffic: hands off
  const url = new URL(req.url);
  if (!shouldHandle(req.method, url.origin, sw.location.origin, url.pathname)) return;

  e.respondWith(
    (async () => {
      if (manifestFiles === null) await loadMeta();
      const entry = manifestFiles?.[manifestKey(url.pathname)];
      // unlisted paths (no manifest yet / removed files): pure passthrough,
      // NEVER cached — removed assets cannot poison the cache
      if (!entry) {
        netFetches++;
        return fetch(req);
      }
      // waitUntil is called before respondWith settles — still valid then
      return cacheFirst(req, entry, (p) => e.waitUntil(p));
    })(),
  );
});
