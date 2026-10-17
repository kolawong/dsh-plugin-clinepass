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

export declare const DEFAULT_MODELS: ClinePassModel[]
export declare function buildRouteProfile(config: ClinePassConfig): ClinePassRouteProfile
/**
 * The upgrade fill for a route the plugin already seeded: every absent
 * `contextWindow`/`maxTokens`/`input` on a model the shipped catalog knows,
 * and nothing else. A field the user set is never overwritten, and a model
 * the user added or removed is never touched.
 */
export declare function mergeSpecFill(
  existing: readonly ClinePassModel[] | null | undefined,
  shipped: readonly ClinePassModel[] | null | undefined,
): ClinePassModel[] | null
/**
 * The catalog the plugin should actually use: the configured models with
 * every absent spec field filled from the code-level {@link DEFAULT_MODELS}.
 * Configured values always win; the code catalog only patches gaps on
 * matching ids.
 */
export declare function effectiveCatalog(
  config: ClinePassConfig | null | undefined,
): ClinePassModel[]
export declare function shippedDiscoveryModels(
  config: ClinePassConfig,
  live?: readonly ClinePassDiscoveredModel[],
): ClinePassDiscoveredModel[]
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
