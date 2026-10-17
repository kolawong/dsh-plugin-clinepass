/**
 * dsh-plugin-clinepass — pure route-seed facts.
 *
 * Kept free of imports so the seed payload and the discovery answer can be
 * asserted by `node --test` without resolving any harness package.
 *
 * @license MIT
 */

/**
 * The ClinePass subscription catalog (docs.cline.bot/getting-started/clinepass).
 *
 * `input` is probed fact, not guesswork (2026-09-29, one image + one text
 * request per model against the live API):
 *  - `mimo-v2.5-pro` answers "No endpoints found that support image input";
 *  - `qwen3.7-max` rejects image content upstream (InvalidParameter);
 *  - every other slug except `muse-spark-1.3-contributor` served the image
 *    probe — including `glm-5.3` and `deepseek-v4-pro`, which vendor catalogs
 *    declare text-only: Cline's deployment accepts images for them, and the
 *    probe of the actual route wins over the catalog;
 *  - `muse-spark-1.3-contributor` is region-locked for this deployment and
 *    could not be probed at all, so it states the pi-ai catalog consensus
 *    (text+image, three independent provider entries).
 *
 * `contextWindow`/`maxTokens` are curated from the pi-ai builtin catalog the
 * same day, preferring the vendor-official provider entry (moonshotai,
 * deepseek, xiaomi, minimax, qwen-token-plan) and then the coding-plan
 * aggregator whose offer most resembles ClinePass (opencode-go). Cline
 * publishes no per-model specs on any API-key-accessible endpoint — the
 * `/models` listing carries only id/object/created/owned_by — so these
 * numbers are inherited from the vendors' own declarations, not fetched from
 * Cline. `deepseek-v4.1-flash` has no catalog entry anywhere, so its
 * capacities stay absent and llm-pi-ai's conservative defaults apply
 * (262144 context / 32768 output; under-reporting is the safe direction — it
 * only compacts earlier, never overflows).
 */
export const DEFAULT_MODELS = [
  { id: "cline-pass/glm-5.3", name: "GLM-5.3", input: ["text", "image"], contextWindow: 1000000, maxTokens: 131072 },
  { id: "cline-pass/glm-5.3-flash", name: "GLM-5.3 Flash", input: ["text", "image"], contextWindow: 1000000, maxTokens: 131072 },
  { id: "cline-pass/kimi-k3", name: "Kimi K3", input: ["text", "image"], contextWindow: 1048576, maxTokens: 131072 },
  { id: "cline-pass/deepseek-v4-pro", name: "DeepSeek V4 Pro", input: ["text", "image"], contextWindow: 1000000, maxTokens: 384000 },
  { id: "cline-pass/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", input: ["text", "image"] },
  { id: "cline-pass/mimo-v2.5", name: "MiMo-V2.5", input: ["text", "image"], contextWindow: 1048576, maxTokens: 131072 },
  { id: "cline-pass/mimo-v2.5-pro", name: "MiMo-V2.5-Pro", input: ["text"], contextWindow: 1048576, maxTokens: 131072 },
  { id: "cline-pass/minimax-m3", name: "MiniMax M3", input: ["text", "image"], contextWindow: 1048576, maxTokens: 512000 },
  { id: "cline-pass/muse-spark-1.3-contributor", name: "Muse Spark 1.3 Contributor", input: ["text", "image"], contextWindow: 1048576, maxTokens: 131072 },
  { id: "cline-pass/qwen3.8-max", name: "Qwen3.8 Max", input: ["text", "image"], contextWindow: 1000000, maxTokens: 131072 },
  { id: "cline-pass/qwen3.7-max", name: "Qwen3.7 Max", input: ["text"], contextWindow: 1000000, maxTokens: 131072 },
  { id: "cline-pass/qwen3.7-plus", name: "Qwen3.7 Plus", input: ["text", "image"], contextWindow: 1000000, maxTokens: 65536 },
];

/**
 * The llm-pi-ai provider profile one seed write carries: every fact pi-ai's
 * installed catalog would have supplied for a catalog route, and nothing
 * else. Absent model fields stay absent so llm-pi-ai's own defaults apply.
 * @param {object} config - resolved plugin configuration.
 * @returns {object} a `PiAiProviderProfile`-shaped plain object.
 */
export function buildRouteProfile(config) {
  const models = (config.models ?? []).map((model) => ({
    id: model.id,
    ...(typeof model.name === "string" && model.name.length > 0 ? { name: model.name } : {}),
    ...(Number.isFinite(model.contextWindow) ? { contextWindow: model.contextWindow } : {}),
    ...(Number.isFinite(model.maxTokens) ? { maxTokens: model.maxTokens } : {}),
    ...(Array.isArray(model.input) && model.input.length > 0 ? { input: [...model.input] } : {}),
  }));
  return {
    displayName: config.displayName,
    apiKeyEnv: config.apiKeyEnv,
    api: config.api,
    baseURL: config.baseURL,
    models,
  };
}

/**
 * The upgrade fill for a route the plugin already seeded: every absent
 * `contextWindow`/`maxTokens`/`input` on a model the shipped catalog knows,
 * and nothing else. A field the user set is never overwritten, and a model
 * the user added or removed is never touched — the merge only patches
 * missing spec fields on entries whose id matches the shipped catalog.
 * @param {readonly object[]} existing - the route's current model entries.
 * @param {readonly object[]} shipped - the plugin's current catalog.
 * @returns {object[]|null} the merged list, or null when nothing would change.
 */
export function mergeSpecFill(existing, shipped) {
  const shippedById = new Map((shipped ?? []).map((model) => [model.id, model]));
  let changed = false;
  const merged = (existing ?? []).map((entry) => {
    const spec = shippedById.get(entry?.id);
    if (spec === undefined) return entry;
    const next = { ...entry };
    for (const field of ["contextWindow", "maxTokens"]) {
      if (!Number.isFinite(next[field]) && Number.isFinite(spec[field])) {
        next[field] = spec[field];
        changed = true;
      }
    }
    if ((!Array.isArray(next.input) || next.input.length === 0)
      && Array.isArray(spec.input) && spec.input.length > 0) {
      next.input = [...spec.input];
      changed = true;
    }
    return next;
  });
  return changed ? merged : null;
}

/**
 * The catalog the plugin should actually use: the configured models with
 * every absent spec field filled from the code-level {@link DEFAULT_MODELS}.
 * Some mount paths hand apply() a config resolved before schema defaults
 * settle (the super-injector's fiber rebuild is one), so a config that names
 * no specs must not starve the seed of them. Configured values always win;
 * the code catalog only patches gaps on matching ids.
 * @param {object} config - resolved plugin configuration.
 * @returns {object[]} model entries with the spec floor applied.
 */
export function effectiveCatalog(config) {
  const configured = config?.models ?? [];
  return mergeSpecFill(configured, DEFAULT_MODELS) ?? configured;
}

/**
 * The llm runtime's claim on a route key, when there is one.
 *
 * A route key that already names a provider in the runtime's configurable
 * directory is not free: seeding this plugin's profile over it would shadow
 * whatever that entry is. For a route the installed catalog owns, the profile
 * we write (ClinePass endpoint, `openai-completions`, `CLINEPASS_API_KEY`)
 * silently replaces the catalog's baseURL/api/apiKeyEnv; for a route another
 * adapter registered, the write collides in llm-pi-ai's own directory commit
 * (`DUPLICATE_DIRECTORY`) and can fail that adapter's next mount. The seed
 * therefore consults this predicate before its first write, so the collision
 * is reported instead of performed.
 *
 * The `declared` flag is deliberately NOT consulted: it separates a route the
 * installed catalog owns (`false`) from one llm-pi-ai's own settings declare
 * (`true`), but cross-adapter entries (`deepseek-official`,
 * `deepseek-account`) arrive with `declared === undefined`, and all three are
 * collisions for this purpose. The guard is simply "no route of this key
 * exists anywhere in the directory".
 *
 * Residual window: the directory only lists providers registered when this
 * runs, so an adapter that activates *after* this seed can still take the key
 * first. The realistic catalog case is deterministic — llm-pi-ai commits its
 * catalog directory synchronously before its fiber becomes ACTIVE, which is
 * exactly what the seed's settings-descriptor poll waits for.
 *
 * @param {unknown} routeKey - the llm-pi-ai route key the seed would write.
 * @param {unknown} directory - `llm.listConfigurableProviders()` rows.
 * @returns {string|null} the key when the directory already owns it, else null.
 */
export function reservedRouteKey(routeKey, directory) {
  if (typeof routeKey !== "string" || routeKey.length === 0 || !Array.isArray(directory)) return null;
  for (const entry of directory) {
    // Exact, case-sensitive: a route key is a settings key, not an id to fold.
    if (entry?.provider === routeKey) return routeKey;
  }
  return null;
}

/**
 * Whether a discovery failure means "a credential was supplied but cannot
 * work", as opposed to any other reason the probe failed.
 *
 * Two harness shapes say exactly that, and both must surface instead of being
 * masked behind the shipped catalog:
 *  - `INVALID_CREDENTIAL`: the stored key is malformed or blank
 *    (`assertUsableApiKey`, packages/llm/llm/src/error.ts);
 *  - `DISCOVERY_FAILED` whose message carries the `; check the API key`
 *    suffix — llm-pi-ai appends it only for HTTP 401/403, so the endpoint
 *    answered and rejected the key (llm-pi-ai/src/discovery.ts).
 *
 * `MISSING_CREDENTIAL` is deliberately NOT one of them: nothing is configured
 * yet, the user can see the empty key field on the card, and answering from
 * the shipped catalog is this plugin's documented behaviour for that state.
 * Neither is any other failure — endpoint unreachable, non-JSON body, another
 * status code — because none of them is a verdict on the key.
 *
 * @param {unknown} error - the value an inner discovery rejected with.
 * @returns {boolean} true only for a supplied-but-rejected credential.
 */
export function credentialFailure(error) {
  const code = error?.code;
  if (code === "INVALID_CREDENTIAL") return true;
  if (code !== "DISCOVERY_FAILED") return false;
  const message = error?.message;
  return typeof message === "string" && /check the api key/i.test(message);
}

/**
 * The discovery answer the wrapped "fetch available models" returns for the
 * ClinePass route: the shipped catalog first, then any `cline-pass/*` id the
 * endpoint listing contributed that the catalog does not already carry.
 * @param {object} config - resolved plugin configuration.
 * @param {readonly object[]} live - the inner discovery's answer, if any.
 * @returns {object[]} discovered-model rows for the adoption UI.
 */
export function shippedDiscoveryModels(config, live = []) {
  const rows = (config.models ?? []).map((model) => ({
    id: model.id,
    name: model.name ?? model.id,
    ...(Number.isFinite(model.contextWindow) ? { contextWindow: model.contextWindow } : {}),
    ...(Number.isFinite(model.maxTokens) ? { maxTokens: model.maxTokens } : {}),
    ...(Array.isArray(model.input) && model.input.length > 0 ? { inputModalities: [...model.input] } : {}),
  }));
  const seen = new Set(rows.map((row) => row.id));
  for (const entry of live) {
    const id = typeof entry?.id === "string" ? entry.id : "";
    // The subscription namespace only: the endpoint's usage-billing slugs
    // would not count against a ClinePass plan if adopted onto this route.
    if (id.startsWith("cline-pass/") && !seen.has(id)) {
      seen.add(id);
      rows.push({ ...entry, id });
    }
  }
  return rows;
}

/** Registry provider whose catalog is the ClinePass subscription namespace. */
export const REGISTRY_PROVIDER = "cline-pass";

/**
 * The only input modalities llm-pi-ai's route schema accepts (`"text" |
 * "image"`). models.dev also declares `audio`/`video` on some plan models
 * (MiMo-V2.6-Pro, Kimi K2.6); passing those through makes the model editor's
 * write fail schema validation (`expected "text" | "image" but got "audio"`),
 * so the registry's declaration is narrowed to what a route can express.
 */
export const ROUTE_INPUT_MODALITIES = ["text", "image"];

/** models.dev listing: every provider's catalog in one payload. */
export const REGISTRY_URL = "https://models.dev/api.json";

/**
 * Plan models the models.dev registry declares for ClinePass, in the shape the
 * discovery answer already speaks. The shipped catalog above can only grow by
 * a release; this is the same subscription namespace published independently,
 * so a plan model Cline adds shows up in "fetch available models" without one.
 *
 * The endpoint's own `GET /models` listing is deliberately NOT this source: it
 * enumerates the usage-billing catalog, whose slugs do not count against the
 * subscription (see the plugin header). This function only ever returns
 * `cline-pass/*` ids, so feeding it to `shippedDiscoveryModels` cannot widen
 * the route beyond the plan.
 *
 * `inputModalities` is the registry's declaration, not the per-model probe the
 * shipped rows carry; the shipped rows keep priority, so a model that was
 * probed here is never overwritten by a catalog claim.
 *
 * @param {unknown} payload - parsed `https://models.dev/api.json`.
 * @param {string} [provider] - registry provider id.
 * @returns {object[]} discovered-model rows, `cline-pass/*` only.
 */
export function registryPlanModels(payload, provider = REGISTRY_PROVIDER) {
  const models = payload?.[provider]?.models;
  if (models === null || typeof models !== "object") return [];
  const rows = [];
  for (const entry of Object.values(models)) {
    const id = typeof entry?.id === "string" ? entry.id : "";
    if (!id.startsWith("cline-pass/")) continue;
    const context = entry?.limit?.context;
    const output = entry?.limit?.output;
    const input = Array.isArray(entry?.modalities?.input)
      ? entry.modalities.input.filter((modality) => ROUTE_INPUT_MODALITIES.includes(modality))
      : [];
    rows.push({
      id,
      name: typeof entry?.name === "string" && entry.name !== "" ? entry.name : id,
      ...(Number.isFinite(context) ? { contextWindow: context } : {}),
      ...(Number.isFinite(output) ? { maxTokens: output } : {}),
      ...(input.length > 0 ? { inputModalities: input } : {}),
    });
  }
  return rows;
}
