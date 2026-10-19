/** Type declarations for dsh-plugin-clinepass. */

/** One configured model row, mirroring llm-pi-ai's `PiAiModelProfile` subset. */
export interface ClinePassModel {
  id: string
  name?: string
  contextWindow?: number
  maxTokens?: number
  input?: Array<'text' | 'image'>
}

/** Plugin configuration as Cordis resolves it (every field defaulted). */
export interface ClinePassConfig {
  seed: boolean
  routeKey: string
  /**
   * Seed even when `routeKey` already names a provider in the llm runtime's
   * configurable-provider directory (a deliberate opt-in: the write shadows
   * that route's endpoint/protocol/credential reference, or collides with
   * another adapter's route).
   */
  allowReservedRouteKey: boolean
  displayName: string
  apiKeyEnv: string
  baseURL: string
  api: string
  /**
   * Operator-pinned model list. Empty (the default) means fetch-first: the
   * seed pulls the models.dev registry's `cline-pass` namespace at
   * activation and discovery answers from live sources only.
   */
  models: ClinePassModel[]
}

/** The llm-pi-ai provider profile one seed write carries. */
export interface ClinePassRouteProfile {
  displayName: string
  apiKeyEnv: string
  api: string
  baseURL: string
  models: ClinePassModel[]
}

/** One discovery row for the model-adoption UI. */
export interface ClinePassDiscoveredModel {
  id: string
  name?: string
  contextWindow?: number
  maxTokens?: number
  inputModalities?: Array<'text' | 'image'>
}

/**
 * Per-model probed facts (input modalities, curated capacities) used to
 * CORRECT fetched rows for known ids. Not a model catalog: it never
 * contributes an id to the route or the discovery answer.
 */
export declare const PROBED_MODEL_SPECS: ClinePassModel[]
export declare function buildRouteProfile(config: ClinePassConfig): ClinePassRouteProfile
/**
 * The upgrade fill for a route the plugin already seeded: every absent
 * `contextWindow`/`maxTokens`/`input` on a model the reference specs know,
 * and nothing else. A field the user set is never overwritten, and a model
 * the user added or removed is never touched.
 */
export declare function mergeSpecFill(
  existing: readonly ClinePassModel[] | null | undefined,
  reference: readonly ClinePassModel[] | null | undefined,
): ClinePassModel[] | null
/**
 * An operator-pinned model list with every absent spec field filled from the
 * code-level {@link PROBED_MODEL_SPECS}. Configured values always win; the
 * probed facts only patch gaps on matching ids. An empty/unset list stays
 * empty: that is the signal to fetch the model list live instead.
 */
export declare function effectiveCatalog(
  config: ClinePassConfig | null | undefined,
): ClinePassModel[]
/**
 * The discovery answer: the fetched rows (`cline-pass/*` ids only, first
 * occurrence wins), corrected by the probed-facts table where it knows an
 * id — probed input modalities replace a catalog claim, absent capacities
 * are only filled. No shipped fallback: empty sources yield an empty answer.
 */
export declare function fetchedDiscoveryModels(
  live?: readonly ClinePassDiscoveredModel[],
  known?: readonly ClinePassModel[],
): ClinePassDiscoveredModel[]
/**
 * Fetched discovery rows in the shape a seeded route's model list speaks
 * (`inputModalities` narrowed back to the route schema's `input`).
 */
export declare function routeModelsFromDiscovery(
  rows: readonly ClinePassDiscoveredModel[],
): ClinePassModel[]
/** Registry provider whose catalog is the ClinePass subscription namespace. */
export declare const REGISTRY_PROVIDER: string
/** models.dev listing: every provider's catalog in one payload. */
export declare const REGISTRY_URL: string
/**
 * Plan models the models.dev registry declares for ClinePass, in the shape the
 * discovery answer already speaks (`cline-pass/*` ids only).
 */
export declare function registryPlanModels(
  payload: unknown,
  provider?: string,
): ClinePassDiscoveredModel[]
/**
 * The llm runtime's claim on a route key: `routeKey` when the directory
 * already lists an entry with that `provider` (catalog-owned or another
 * adapter's route), else `null`. Tolerates a missing/malformed directory and
 * a non-string key.
 */
export declare function reservedRouteKey(routeKey: unknown, directory: unknown): string | null
/**
 * Whether a discovery failure means "a credential was supplied but cannot
 * work": `INVALID_CREDENTIAL`, or `DISCOVERY_FAILED` carrying llm-pi-ai's
 * `; check the API key` suffix (HTTP 401/403). `MISSING_CREDENTIAL` and every
 * other failure are deliberately not.
 */
export declare function credentialFailure(error: unknown): boolean
/** Drop the cached plan catalog, forcing the next discovery to re-fetch. */
export declare function clearRegistryCache(): void

/** Seed tuning; every field has a code default. */
export interface ClinePassSeedOptions {
  /** llm-pi-ai settings polls before giving up. */
  attempts?: number
  /** Delay between those polls. */
  intervalMs?: number
  /**
   * Directory reader the collision guard consults (`() => []` without llm).
   * Best-effort: a throw is logged and the seed proceeds unguarded.
   */
  readInstalledRoutes?: () => readonly unknown[]
}

/** Discovery-wrap timing; every field has a code default. */
export interface ClinePassDiscoveryTiming {
  /** Retry delay while the discovery is missing. */
  fastMs?: number
  /** How long to retry fast before warning. */
  deadlineMs?: number
  /** Watchdog period, for the fiber's lifetime. */
  pollMs?: number
}

export declare const name: string
export declare const inject: readonly string[]
/** Loader entry id (`clinepass`), exported as public API naming the entry — no internal caller reads it. */
export declare const NS: string
export declare const LLM_PI_AI_NS: string
export declare const Config: unknown
/** Seed the llm-pi-ai route once per activation, unless its key is claimed. */
export declare function installSeed(
  ctx: unknown,
  readConfig: () => ClinePassConfig,
  options?: ClinePassSeedOptions,
): void
/** Wrap llm-pi-ai model discovery, re-arming over later remounts. */
export declare function installDiscoveryWrap(
  ctx: unknown,
  readConfig: () => ClinePassConfig,
  timing?: ClinePassDiscoveryTiming,
): void
export declare function apply(ctx: unknown, config: ClinePassConfig): void
