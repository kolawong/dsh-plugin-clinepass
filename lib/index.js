/**
 * dsh-plugin-clinepass — ClinePass model provider for DeepSeek Harness.
 *
 * ClinePass (docs.cline.bot/getting-started/clinepass) is Cline's subscription
 * tier: the same Cline API (`https://api.cline.bot/api/v1`, OpenAI Chat
 * Completions) served under `cline-pass/*` model slugs. DSH's provider catalog
 * ships nothing under that name, so this bundle makes it a first-class route:
 *
 *  1. At activation it seeds ONE llm-pi-ai provider route (`clinepass` by
 *     default) into the `llm-pi-ai` settings user layer — the exact write the
 *     Models settings page itself performs (`settings.update`), so the route
 *     lands where every configuration surface already looks. The profile
 *     carries what a catalog route would inherit from pi-ai: endpoint, wire
 *     protocol, display name, credential reference — and the model list,
 *     FETCHED LIVE from the models.dev registry's `cline-pass` namespace at
 *     seed time (an operator-pinned `models` config skips the fetch). A
 *     failed fetch seeds an empty route rather than a stale one. What is
 *     left for a human is exactly one field: the API key.
 *  2. Seeding is idempotent and non-destructive: a route key that already
 *     resolves — hand-tuned on the Models page or written into
 *     `cordis.patch.yml` — is never touched again (only absent spec fields
 *     are filled from the probed-facts table), and a key the llm runtime's
 *     provider directory already owns (the installed catalog, or another
 *     plugin's route) is refused with one warning instead of being shadowed
 *     (`allowReservedRouteKey: true` overrides deliberately).
 *  3. The llm runtime's registered model discovery for `llm-pi-ai` is wrapped
 *     so "fetch available models" on the ClinePass card answers with what the
 *     sources publish RIGHT NOW: the models.dev registry's plan namespace
 *     plus any `cline-pass/*` id the endpoint listing carries, corrected by
 *     the probed-facts table where it knows an id. There is no shipped
 *     fallback list — a source that fetched nothing yields an empty answer
 *     (with a warn log), so the card never shows models the plan may no
 *     longer carry. The Cline `GET /models` listing is NOT a primary source:
 *     it enumerates the usage-billing catalog only (verified 2026-09-29: no
 *     `cline-pass/` ids), so passing it through would offer slugs that do
 *     not count against the subscription; the probe is still made because it
 *     is this route's live credential check (see credentialFailure — a key
 *     the endpoint rejects is never masked).
 *
 * Everything else is native: the Models page card (API key input, collapsed
 * endpoint/model editors), the credential seam (`<ROUTE>_API_KEY`), request
 * streaming through llm-pi-ai's pi-ai adapter, and the composer model picker.
 * No dsh source is touched.
 *
 * @license MIT
 */

import z from "@deepseek-ai/schemastery";

import { PROBED_MODEL_SPECS, REGISTRY_URL, buildRouteProfile, credentialFailure, effectiveCatalog, fetchedDiscoveryModels, mergeSpecFill, reservedRouteKey, routeModelsFromDiscovery, registryPlanModels } from "./route.js";

export { PROBED_MODEL_SPECS, REGISTRY_PROVIDER, REGISTRY_URL, ROUTE_INPUT_MODALITIES, buildRouteProfile, credentialFailure, effectiveCatalog, fetchedDiscoveryModels, mergeSpecFill, reservedRouteKey, routeModelsFromDiscovery, registryPlanModels } from "./route.js";

export const name = "clinepass";
export const inject = ["settings"];

/** This plugin's own settings namespace (the Loader entry id). */
export const NS = "clinepass";

/** Settings namespace owned by the llm-pi-ai adapter plugin; the route lives there. */
export const LLM_PI_AI_NS = "llm-pi-ai";

/** How long a fetched plan catalog is trusted before the next fetch re-reads it. */
const REGISTRY_TTL_MS = 6 * 60 * 60 * 1000;

/** Registry request budget: discovery is interactive, so never hang on it. */
const REGISTRY_TIMEOUT_MS = 8000;

/** Last successful plan catalog. `rows: null` means "never fetched". */
let registryCache = { at: 0, rows: null };

/** One configured model row, mirroring llm-pi-ai's `PiAiModelProfile` subset. */
const modelSchema = z.object({
  id: z.string().required(),
  name: z.string(),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
  input: z.array(z.union(["text", "image"])),
});

/**
 * Plugin configuration schema. Exported so Cordis validates the bundle-patch /
 * user-layer values at load time and fills these defaults; every
 * deployment-varying value lives here instead of in code.
 */
export const Config = z.object({
  /** Seed the llm-pi-ai route when its key resolves nothing. */
  seed: z.boolean().default(true),
  /** llm-pi-ai provider route key (the settings key of the Models page card). */
  routeKey: z.string().default("clinepass"),
  /**
   * Deliberate opt-in escape hatch: seed even when `routeKey` already names a
   * provider in the llm runtime's directory. That write shadows a catalog
   * route's own endpoint/protocol/credential reference (or collides with
   * another adapter's route), so it is refused with one warning by default.
   */
  allowReservedRouteKey: z.boolean().default(false),
  /** Name shown in selectors and on the settings card. */
  displayName: z.string().default("ClinePass"),
  /**
   * Credential reference the route resolves its API key through. The default
   * matches the reference the Models page derives from the route key; set it
   * to an existing reference (e.g. `CLINE_API_KEY`) to reuse that credential
   * instead of storing a second copy.
   */
  apiKeyEnv: z.string().default("CLINEPASS_API_KEY"),
  /** Cline API endpoint. */
  baseURL: z.string().default("https://api.cline.bot/api/v1"),
  /** Wire protocol the endpoint speaks. */
  api: z.string().default("openai-completions"),
  /**
   * Operator-pinned model list. Empty (the default) means FETCH-FIRST: the
   * seed pulls the models.dev registry's `cline-pass` namespace at
   * activation and discovery answers from live sources only. Pin a list here
   * (or in 设置 → 插件) to override the fetch; pinned rows are enriched with
   * the probed-facts table where it knows the id.
   */
  models: z.array(modelSchema).default([]),
});
Config.meta.volatile = true;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait briefly for the llm-pi-ai settings namespace to register.
 * @param {object} settings - the settings service.
 * @param {number} attempts - polls before giving up.
 * @param {number} intervalMs - delay between polls.
 * @returns {Promise<object|undefined>} its descriptor, or undefined.
 */
async function awaitLlmPiAi(settings, attempts = 30, intervalMs = 1000) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let descriptors;
    try {
      descriptors = settings?.describe?.() ?? [];
    } catch {
      return undefined;
    }
    const hit = descriptors.find((entry) => entry?.ns === LLM_PI_AI_NS);
    if (hit !== undefined) return hit;
    await sleep(intervalMs);
  }
  return undefined;
}

/**
 * Seed the llm-pi-ai route once per activation, unless its key is already
 * claimed (see {@link reservedRouteKey}).
 * @param {object} ctx - plugin context.
 * @param {() => object} readConfig - live config reader.
 * @param {object} [options] - seed tuning; every field has a code default.
 * @param {number} [options.attempts] - llm-pi-ai settings polls before giving up.
 * @param {number} [options.intervalMs] - delay between those polls.
 * @param {() => object[]} [options.readInstalledRoutes] - directory reader the
 *   collision guard consults; `() => []` when no llm service is reachable.
 */
export function installSeed(ctx, readConfig, options = {}) {
  const { logger } = ctx;
  const { attempts = 30, intervalMs = 1000, readInstalledRoutes = () => [] } = options;
  let done = false;
  let inflight = null;

  const run = () => {
    if (done) return Promise.resolve();
    if (inflight !== null) return inflight;
    inflight = (async () => {
      const config = readConfig();
      if (config.seed !== true) {
        done = true;
        return;
      }
      const settings = ctx.settings;
      const descriptor = await awaitLlmPiAi(settings, attempts, intervalMs);
      if (descriptor === undefined) {
        logger?.warn?.("[clinepass] llm-pi-ai settings never registered; the ClinePass route was not seeded");
        return;
      }
      const routeKey = config.routeKey;
      const existing = descriptor.value?.providers?.[routeKey];
      if (existing !== undefined) {
        // The route is the user's now: never rewrite it. The one exception is
        // a strict fill of spec fields the route does not state (a catalog
        // refresh that shipped new capacities, say) — a field anyone set, a
        // model anyone added or removed, stays exactly as it is. The fill
        // reference is the operator's pinned list when there is one, else the
        // probed-facts table; the fetched catalog is NOT used here, because
        // the registry's claims are exactly what the probe corrects. The
        // write can collide with a hot-reload transaction ("HMR transactions
        // cannot be nested"); the volatile-update listener below retries the
        // run once the transaction settles.
        const pinned = effectiveCatalog(config);
        const fill = mergeSpecFill(existing.models, pinned.length > 0 ? pinned : PROBED_MODEL_SPECS);
        if (fill !== null) {
          try {
            await settings.mutate(
              LLM_PI_AI_NS,
              [{ op: "set", path: ["providers", routeKey, "models"], value: fill }],
              descriptor.revision,
            );
            logger?.info?.("[clinepass] filled missing model specs on llm-pi-ai route '" + routeKey + "'");
          } catch (error) {
            logger?.warn?.("[clinepass] could not fill model specs on the existing route:", error?.message ?? String(error));
          }
        } else {
          logger?.info?.("[clinepass] llm-pi-ai route '" + routeKey + "' already configured; leaving it untouched");
        }
        done = true;
        return;
      }
      // The route does not exist in the llm-pi-ai layer, so this would be a
      // fresh insert — and the key may still be claimed elsewhere in the llm
      // runtime's directory (the installed catalog, or another adapter's
      // route). Writing anyway shadows that route's own endpoint/protocol/
      // credential reference, or collides in llm-pi-ai's directory commit, so
      // refuse it with one actionable warning (once per seed run) unless the
      // operator opted in. The directory only lists providers registered when
      // this runs; an adapter activating later can still take the key first
      // (see reservedRouteKey for why the catalog case is nonetheless
      // deterministic).
      if (config.allowReservedRouteKey !== true) {
        // Best-effort: an unreadable directory must not block seeding, and a
        // throw here must never escape as an unhandled rejection.
        let reserved = null;
        try {
          reserved = reservedRouteKey(routeKey, readInstalledRoutes());
        } catch (error) {
          logger?.warn?.(
            "[clinepass] could not read the llm provider directory; seeding without the collision guard:",
            error?.message ?? String(error),
          );
        }
        if (reserved !== null) {
          logger?.warn?.(
            "[clinepass] routeKey '" + reserved + "' is already a provider route in this deployment "
            + "(installed catalog or another plugin); refusing to seed over it. "
            + "Pick a free key, or set allowReservedRouteKey: true to override deliberately.",
          );
          done = true;
          return;
        }
      }
      try {
        // Fetch-first: with no operator-pinned list, the seeded model list is
        // whatever the models.dev registry publishes for the plan right now
        // (corrected by the probed-facts table). A failed fetch seeds an
        // EMPTY route rather than a stale one — discovery re-fetches on
        // demand, so the card fills in on the next "fetch available models".
        let models = effectiveCatalog(config);
        if (models.length === 0) {
          models = routeModelsFromDiscovery(fetchedDiscoveryModels(await planRegistryRows(logger)));
        }
        // The same write the Models page performs: a path merge into the
        // llm-pi-ai user layer, persisted in the profile's cordis.patch.yml.
        await settings.update(LLM_PI_AI_NS, {
          providers: { [routeKey]: buildRouteProfile({ ...config, models }) },
        });
        done = true;
        logger?.info?.(
          "[clinepass] seeded llm-pi-ai route '" + routeKey + "' ("
          + String(models.length) + " models, " + config.api + " at " + config.baseURL
          + "); fill the API key on the Models page to use it",
        );
      } catch (error) {
        logger?.warn?.("[clinepass] could not seed the ClinePass route:", error?.message ?? String(error));
      }
    })().catch((error) => {
      // `run()` is called as `void run()`, so an unexpected throw must be
      // contained here: log it once for this run and leave `done` false, so a
      // later volatile update retries instead of the rejection surfacing as
      // an unhandled rejection. The log itself is contained too — a throwing
      // logger must not turn this containment back into a rejection.
      try {
        logger?.warn?.("[clinepass] seed run failed:", error?.message ?? String(error));
      } catch {
        // Nothing left to report it with; the run is still contained.
      }
    }).finally(() => {
      inflight = null;
    });
    return inflight;
  };

  void run();
  // Re-check on this entry's own volatile commits (a settings-page edit of the
  // plugin config — a new routeKey, say — is one) and on profile reloads. The
  // check is cheap and never rewrites a route that already resolved; an
  // in-session deletion of the row is respected until the next activation.
  ctx.on("loader/volatile-update", () => {
    done = false;
    void run();
  });
  ctx.on("app-boot/config-reload", () => {
    done = false;
    void run();
  });
}

/**
 * The plan catalog the models.dev registry publishes for ClinePass, fetched at
 * most once per TTL and never fatal: discovery treats it as one of two live
 * sources, so an unreachable registry costs that source's rows for this call,
 * nothing more.
 * @param {object} logger - plugin logger.
 * @returns {Promise<object[]>} `cline-pass/*` discovered-model rows ([] on failure).
 */
async function planRegistryRows(logger) {
  const now = Date.now();
  if (registryCache.rows !== null && now - registryCache.at < REGISTRY_TTL_MS) return registryCache.rows;
  try {
    const response = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const rows = registryPlanModels(await response.json());
    registryCache = { at: now, rows };
    logger?.info?.(`[clinepass] plan catalog refreshed from models.dev: ${rows.length} cline-pass models`);
    return rows;
  } catch (error) {
    // Not cached, so the next "fetch available models" retries; the TTL above
    // keeps a healthy registry from being asked once per click.
    logger?.info?.(
      "[clinepass] models.dev plan catalog unavailable for this call:",
      error?.message ?? String(error),
    );
    return registryCache.rows ?? [];
  }
}

/**
 * Drop the cached plan catalog, forcing the next fetch to re-read the
 * registry. Exported for tests and for callers that want a hard refresh.
 */
export function clearRegistryCache() {
  registryCache = { at: 0, rows: null };
}

/**
 * Wrap the llm-pi-ai model discovery so "fetch available models" on the
 * ClinePass card answers with the subscription catalog instead of the
 * endpoint's usage-billing listing. Registration rejects a duplicate
 * namespace, so the wrapper composes by swapping the registry entry (the
 * established toolkit pattern) and restores it on disposal.
 *
 * The wrap is ownership-aware and re-armable. llm-pi-ai may register its
 * discovery after this activation, and a remount registers a fresh function
 * over the entry, so a slow watchdog keeps watching the entry for the fiber's
 * lifetime and wraps whatever inner function it finds — never a wrapper this
 * plugin already installed.
 *
 * @param {object} ctx - plugin context.
 * @param {() => object} readConfig - live config reader (volatile-safe).
 * @param {object} [timing] - poll tuning; every field has a code default.
 * @param {number} [timing.fastMs] - retry delay while the discovery is missing.
 * @param {number} [timing.deadlineMs] - how long to retry fast before warning.
 * @param {number} [timing.pollMs] - watchdog period, for the fiber's lifetime.
 */
export function installDiscoveryWrap(ctx, readConfig, timing = {}) {
  const { logger } = ctx;
  const { fastMs = 1000, deadlineMs = 15000, pollMs = 5000 } = timing;

  const mount = (llm, scope) => {
    let disposed = false;
    /** Every live timer, so disposal can clear all of them. */
    const timers = new Set();
    let original = null;
    let wrapped = null;
    let errorLogged = false;
    let missedLogged = false;
    const deadline = Date.now() + deadlineMs;

    const later = (delay, attempt) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        attempt();
      }, delay);
      timer.unref?.();
      timers.add(timer);
    };

    /**
     * Ensure the registry entry holds this plugin's wrapper, without ever
     * nesting wrappers. Ownership-aware and idempotent: our wrapper already
     * in place → installed; another clinepass wrapper (an earlier install, or
     * a remount whose disposer has not run) → adopt it as-is; anything else →
     * wrap the current inner and swap it in.
     * @returns {boolean} whether the entry is wrapped.
     */
    const install = () => {
      if (disposed) return true;
      // Read through the scoped proxy per attempt, so a retry loop can never
      // poll a dead handle.
      const map = llm?.discoveries;
      if (!(map instanceof Map)) return false;
      const inner = map.get(LLM_PI_AI_NS);
      if (typeof inner !== "function") return false;
      if (inner === wrapped) return true;
      if (inner.answeredByClinepass === true) {
        // Another install of this plugin already owns the entry. Wrapping the
        // wrapper would double-filter the same answer.
        original = inner;
        wrapped = inner;
        return true;
      }
      wrapped = async (request, signal) => {
        const config = readConfig();
        if (request?.provider !== config.routeKey) return inner(request, signal);
        // The registry read is independent of the endpoint probe, so start it
        // first: the interactive answer then waits on the slower of the two
        // instead of their sum. planRegistryRows never rejects (every failure
        // path returns a fallback), so this promise is safe to float while the
        // probe is awaited — including when a credential failure rethrows
        // below, in which case the fetch still lands in the TTL cache.
        const registryPromise = planRegistryRows(logger);
        let live = [];
        try {
          live = await inner(request, signal);
        } catch (error) {
          // A supplied-but-rejected credential is the one failure the fetched
          // answer must NOT mask: listing models for a key the endpoint just
          // refused is the lie this wrap would otherwise tell. Rethrow the
          // original error untouched, so the Models page shows the harness's
          // own message. Every other failure — nothing configured yet
          // (`MISSING_CREDENTIAL`), an unreachable endpoint, a non-JSON body,
          // another status — only costs this one source; the registry half
          // of the answer still stands.
          if (credentialFailure(error)) throw error;
          logger?.warn?.(
            "[clinepass] endpoint listing unavailable for this 'fetch available models' call:",
            error?.message ?? String(error),
          );
        }
        // The answer is what the sources publish NOW: the registry's plan
        // namespace plus any `cline-pass/*` id the endpoint listing carried,
        // corrected by the probed-facts table. The endpoint's listing is the
        // usage-billing catalog and normally contributes nothing (it
        // publishes no `cline-pass/*` id); the probe is still made because
        // it is this route's live credential check (see credentialFailure).
        // `fetchedDiscoveryModels` keeps only `cline-pass/*` ids, so neither
        // source can widen the route past the subscription. There is no
        // shipped fallback: both sources empty means an empty answer.
        const fetched = fetchedDiscoveryModels([...(Array.isArray(live) ? live : []), ...(await registryPromise)]);
        // An operator-pinned list is explicit intent, not a fallback: those
        // rows lead the answer and are never displaced by a fetched row.
        const pinned = effectiveCatalog(config);
        if (pinned.length === 0) return fetched;
        const rows = pinned.map((model) => ({
          id: model.id,
          name: model.name ?? model.id,
          ...(Number.isFinite(model.contextWindow) ? { contextWindow: model.contextWindow } : {}),
          ...(Number.isFinite(model.maxTokens) ? { maxTokens: model.maxTokens } : {}),
          ...(Array.isArray(model.input) && model.input.length > 0 ? { inputModalities: [...model.input] } : {}),
        }));
        const seen = new Set(rows.map((row) => row.id));
        return [...rows, ...fetched.filter((row) => !seen.has(row.id))];
      };
      wrapped.answeredByClinepass = true;
      original = inner;
      map.set(LLM_PI_AI_NS, wrapped);
      logger?.info?.("[clinepass] model discovery wrapped; 'fetch available models' answers with the live ClinePass plan catalog");
      return true;
    };

    const attempt = () => {
      if (disposed) return;
      let installed = false;
      try {
        installed = install();
      } catch (error) {
        // Containment: a wrap failure must never escape the poll (or the
        // activation that started it). Report once, then keep watching.
        if (!errorLogged) {
          errorLogged = true;
          logger?.warn?.("[clinepass] could not wrap llm-pi-ai model discovery:", error?.message ?? String(error));
        }
      }
      if (installed) {
        // Keep watching: an llm-pi-ai remount replaces the entry with a fresh
        // discovery, and this watchdog is what re-arms the wrap over it.
        later(pollMs, attempt);
        return;
      }
      if (Date.now() < deadline) {
        later(fastMs, attempt);
        return;
      }
      // The warning is about a discovery that never appeared; once a wrap
      // succeeded, a later disappearance is the watchdog's quiet business.
      if (wrapped === null && !missedLogged) {
        missedLogged = true;
        logger?.warn?.(
          "[clinepass] llm-pi-ai model discovery never appeared; 'fetch available models' falls back to the endpoint listing",
        );
      }
      later(pollMs, attempt);
    };

    scope.effect(() => {
      attempt();
      return () => {
        disposed = true;
        for (const timer of timers) clearTimeout(timer);
        timers.clear();
        // Restore only what this fiber installed: a remount's fresh discovery,
        // or another clinepass wrapper, is not ours to overwrite.
        const map = llm?.discoveries;
        if (map instanceof Map && map.get(LLM_PI_AI_NS) === wrapped) map.set(LLM_PI_AI_NS, original);
      };
    }, "clinepass: clinepass model discovery");
  };

  // The service is reached through scoped injection unless the given context
  // already holds it: cordis refuses service property access outside a fiber
  // that injects it. This wrap is a bonus over a seed that stands alone — a
  // composition without an llm service simply gets no wrap, and everything
  // else still works. A caller that already holds the service (a scoped
  // handle, a test double) passes it on the context itself, and the probe
  // below picks it up without a nested inject.
  let direct = null;
  try {
    direct = ctx.llm ?? null;
  } catch {
    direct = null;
  }
  if (direct !== null) {
    mount(direct, ctx);
    return;
  }
  ctx.inject(["llm"], (sctx) => mount(sctx.llm, sctx));
}

/**
 * Activate the plugin: seed the route, then wrap model discovery.
 * @param {object} ctx - plugin context.
 * @param {object} config - resolved composition config.
 */
export function apply(ctx, config) {
  // A root-volatile schema (Config.meta.volatile) resolves through
  // `resolveConfig`, which hands apply a `{ get() }` reference when the
  // schemastery in use supports volatile fields, and plain values when it does
  // not — both paths occur, so read through it at every use and never cache a
  // snapshot, which is also what makes volatile commits visible live.
  const readConfig = () => (typeof config?.get === "function" ? config.get() : config) ?? {};
  // The collision guard needs the llm runtime's provider directory. The
  // scoped injection is the sanctioned way to reach the service — a bare
  // `ctx.llm` throws outside a fiber that injects it (the llm runtime is a
  // sibling fiber, not an ancestor) — but its callback lands a turn after
  // activation, and the seed's first run can beat it (verified against a real
  // Context: the write landed first). So the reader also falls back to
  // `ctx.get("llm")`, the documented read "without the inject requirement",
  // which is synchronous and sees the same service. The live read is tried
  // FIRST: the cached scoped handle is captured once and can outlive a
  // service reload, so it may be the staler of the two. An llm-less
  // composition gets `[]` from either path and seeds exactly as before.
  let scopedLlm = null;
  ctx.inject(["llm"], (sctx) => {
    scopedLlm = sctx.llm ?? null;
  });
  const readInstalledRoutes = () => {
    // The live read is preferred (see above), but a throw from `ctx.get` must
    // not discard a usable scoped handle: each source is tried on its own, and
    // only both failing yields `[]`.
    let llm = null;
    try {
      llm = ctx.get?.("llm") ?? null;
    } catch {
      llm = null;
    }
    if (llm === null) llm = scopedLlm;
    try {
      const rows = llm?.listConfigurableProviders?.();
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  };
  installSeed(ctx, readConfig, { readInstalledRoutes });
  installDiscoveryWrap(ctx, readConfig);
}

export default { name, inject, NS, Config, apply };
