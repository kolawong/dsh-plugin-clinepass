import assert from 'node:assert/strict'
import { test } from 'node:test'

// Behaviour tests for lib/index.js against doubles. Unlike route.test.js this
// file imports index.js, which resolves the @deepseek-ai/schemastery peer at
// module load — install devDependencies (`npm install`) before running it.
import { PROBED_MODEL_SPECS } from '../lib/route.js'
import { apply, clearRegistryCache, installDiscoveryWrap, installSeed } from '../lib/index.js'

const config = {
  seed: true,
  routeKey: 'clinepass',
  displayName: 'ClinePass',
  apiKeyEnv: 'CLINEPASS_API_KEY',
  baseURL: 'https://api.cline.bot/api/v1',
  api: 'openai-completions',
  models: PROBED_MODEL_SPECS,
}

// These exercise lib/index.js against doubles, so they stay free of any
// harness service: a settings service with describe/update/mutate, and a ctx
// whose `llm.discoveries` map stands in for the runtime registry.

/** Bounded poll helper: settles as soon as `predicate` holds, else at timeout. */
async function waitFor(predicate, timeoutMs = 500) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true
    await new Promise(resolve => setTimeout(resolve, 2))
  }
  return predicate()
}

/** Bounded settle, for negative assertions ("nothing more happens"). */
const settle = (ms) => new Promise(resolve => setTimeout(resolve, ms))

/** Settings double: describe/update/mutate with every call captured. */
function fakeSettings({ providers = {}, revision = 1, registered = true } = {}) {
  const calls = { update: [], mutate: [] }
  return {
    calls,
    describe: () => (registered ? [{ ns: 'llm-pi-ai', revision, value: { providers } }] : []),
    update: async (ns, patch) => { calls.update.push({ ns, patch }) },
    mutate: async (ns, ops, expectedRevision) => { calls.mutate.push({ ns, ops, expectedRevision }) },
  }
}

/** Seed ctx double: the settings service, a log capture, and a captured event bus. */
function fakeSeedCtx(settings) {
  const logs = { warn: [], info: [] }
  const handlers = new Map()
  return {
    settings,
    logs,
    handlers,
    logger: {
      warn: (...args) => logs.warn.push(args.join(' ')),
      info: (...args) => logs.info.push(args.join(' ')),
    },
    on: (event, handler) => { handlers.set(event, handler) },
  }
}

/** Discovery ctx double: an llm service and effect-disposer capture. */
function fakeLlmCtx(discoveries) {
  const logs = { warn: [], info: [] }
  const disposers = []
  return {
    llm: { discoveries },
    logs,
    disposers,
    logger: {
      warn: (...args) => logs.warn.push(args.join(' ')),
      info: (...args) => logs.info.push(args.join(' ')),
    },
    effect: (execute) => {
      const dispose = execute()
      if (typeof dispose === 'function') disposers.push(dispose)
      return dispose
    },
  }
}

/** Tiny timings, so a wrap test finishes in a few milliseconds. */
const tinyTiming = { fastMs: 5, deadlineMs: 20, pollMs: 10 }

test('installSeed warns and writes nothing when llm-pi-ai never registers', async () => {
  const settings = fakeSettings({ registered: false })
  const ctx = fakeSeedCtx(settings)
  installSeed(ctx, () => config, { attempts: 2, intervalMs: 1, readInstalledRoutes: () => [] })
  assert.ok(await waitFor(() => ctx.logs.warn.some(line => line.includes('never registered'))))
  assert.equal(settings.calls.update.length, 0)
  assert.equal(settings.calls.mutate.length, 0)
})

test('installSeed seeds the route profile when the key is free', async () => {
  const settings = fakeSettings()
  const ctx = fakeSeedCtx(settings)
  // A directory that owns other keys must not block this one.
  installSeed(ctx, () => config, {
    attempts: 2,
    intervalMs: 1,
    readInstalledRoutes: () => [{ provider: 'deepseek', declared: false }],
  })
  assert.ok(await waitFor(() => settings.calls.update.length === 1))
  const [{ ns, patch }] = settings.calls.update
  assert.equal(ns, 'llm-pi-ai')
  assert.equal(patch.providers.clinepass.baseURL, 'https://api.cline.bot/api/v1')
  assert.equal(patch.providers.clinepass.api, 'openai-completions')
  assert.equal(patch.providers.clinepass.apiKeyEnv, 'CLINEPASS_API_KEY')
  assert.equal(patch.providers.clinepass.displayName, 'ClinePass')
  assert.equal(patch.providers.clinepass.models.length, 12)
  assert.equal(settings.calls.mutate.length, 0)
})

test('installSeed refuses a routeKey the installed catalog owns', async () => {
  const settings = fakeSettings()
  const ctx = fakeSeedCtx(settings)
  installSeed(ctx, () => config, {
    attempts: 2,
    intervalMs: 1,
    readInstalledRoutes: () => [{ provider: 'clinepass', declared: false }],
  })
  assert.ok(await waitFor(() => ctx.logs.warn.some(line => line.includes("routeKey 'clinepass'"))))
  const refusals = ctx.logs.warn.filter(line => line.includes("routeKey 'clinepass'"))
  assert.equal(refusals.length, 1) // one actionable warning, not one per poll
  assert.match(refusals[0], /already a provider route/)
  assert.match(refusals[0], /allowReservedRouteKey: true/)
  assert.equal(settings.calls.update.length, 0)
  assert.equal(settings.calls.mutate.length, 0)
})

test('installSeed refuses a key another adapter registered (declared undefined)', async () => {
  const settings = fakeSettings()
  const ctx = fakeSeedCtx(settings)
  installSeed(ctx, () => config, {
    attempts: 2,
    intervalMs: 1,
    readInstalledRoutes: () => [{ provider: 'clinepass' }],
  })
  assert.ok(await waitFor(() => ctx.logs.warn.some(line => line.includes("routeKey 'clinepass'"))))
  assert.equal(settings.calls.update.length, 0)
  assert.equal(settings.calls.mutate.length, 0)
})

test('installSeed writes anyway when allowReservedRouteKey is set', async () => {
  const settings = fakeSettings()
  const ctx = fakeSeedCtx(settings)
  installSeed(ctx, () => ({ ...config, allowReservedRouteKey: true }), {
    attempts: 2,
    intervalMs: 1,
    readInstalledRoutes: () => [{ provider: 'clinepass', declared: false }],
  })
  assert.ok(await waitFor(() => settings.calls.update.length === 1))
  assert.equal(settings.calls.update[0].patch.providers.clinepass.displayName, 'ClinePass')
  assert.equal(ctx.logs.warn.length, 0)
})

test('installSeed fills absent specs on an existing route via mutate', async () => {
  const settings = fakeSettings({
    providers: { clinepass: { models: [{ id: 'cline-pass/kimi-k3' }] } },
    revision: 7,
  })
  const ctx = fakeSeedCtx(settings)
  installSeed(ctx, () => config, { attempts: 2, intervalMs: 1, readInstalledRoutes: () => [] })
  assert.ok(await waitFor(() => settings.calls.mutate.length === 1))
  const [{ ns, ops, expectedRevision }] = settings.calls.mutate
  assert.equal(ns, 'llm-pi-ai')
  assert.equal(expectedRevision, 7)
  assert.equal(ops[0].op, 'set')
  assert.deepEqual(ops[0].path, ['providers', 'clinepass', 'models'])
  assert.equal(ops[0].value[0].contextWindow, 1048576)
  assert.equal(settings.calls.update.length, 0)
})

test('installSeed leaves a complete existing route untouched', async () => {
  const settings = fakeSettings({
    providers: { clinepass: { models: PROBED_MODEL_SPECS.map(model => ({ ...model })) } },
  })
  const ctx = fakeSeedCtx(settings)
  installSeed(ctx, () => config, { attempts: 2, intervalMs: 1, readInstalledRoutes: () => [] })
  assert.ok(await waitFor(() => ctx.logs.info.some(line => line.includes('already configured'))))
  assert.equal(settings.calls.update.length, 0)
  assert.equal(settings.calls.mutate.length, 0)
})

test('installDiscoveryWrap installs over the inner discovery and marks it', () => {
  const inner = async () => []
  const discoveries = new Map([['llm-pi-ai', inner]])
  const ctx = fakeLlmCtx(discoveries)
  installDiscoveryWrap(ctx, () => config, tinyTiming)
  const wrapped = discoveries.get('llm-pi-ai')
  assert.equal(typeof wrapped, 'function')
  assert.notEqual(wrapped, inner)
  assert.equal(wrapped.answeredByClinepass, true)
  assert.equal(ctx.disposers.length, 1)
  ctx.disposers[0]()
})

test('installDiscoveryWrap passes another provider straight through', async () => {
  const inner = async (request) => [{ id: 'inner/' + request.provider }]
  const discoveries = new Map([['llm-pi-ai', inner]])
  const ctx = fakeLlmCtx(discoveries)
  installDiscoveryWrap(ctx, () => config, tinyTiming)
  assert.deepEqual(await discoveries.get('llm-pi-ai')({ provider: 'openai' }), [{ id: 'inner/openai' }])
  ctx.disposers[0]()
})

test('installDiscoveryWrap fetches the registry in parallel with the endpoint probe', async () => {
  const realFetch = globalThis.fetch
  clearRegistryCache() // a warm cache answers without a fetch; measure a cold one
  let fetchStarted = -1
  let innerStarted = -1
  let tick = 0
  globalThis.fetch = async () => {
    fetchStarted = tick
    return { ok: true, json: async () => ({}) }
  }
  try {
    const inner = async () => {
      innerStarted = tick
      await settle(30) // a slow probe must not delay the registry fetch
      return []
    }
    const discoveries = new Map([['llm-pi-ai', inner]])
    const ctx = fakeLlmCtx(discoveries)
    installDiscoveryWrap(ctx, () => config, tinyTiming)
    tick += 1 // the wrapped call itself is one tick
    const rows = await discoveries.get('llm-pi-ai')({ provider: 'clinepass' })
    assert.equal(rows.length, 12) // the pinned list; both fetches came back empty
    // Both were started by the same wrapped call: the registry fetch did not
    // wait out the probe's 30ms.
    assert.equal(innerStarted, 1)
    assert.equal(fetchStarted, 1)
    ctx.disposers[0]()
  } finally {
    globalThis.fetch = realFetch
    clearRegistryCache()
  }
})

test('installDiscoveryWrap answers pinned rows plus fetched subscription ids', async () => {
  const realFetch = globalThis.fetch
  clearRegistryCache()
  // The registry contributes nothing here; the endpoint listing is stubbed.
  globalThis.fetch = async () => ({ ok: true, json: async () => ({}) })
  try {
    const inner = async () => [
      { id: 'zai/glm-5.3', name: 'GLM-5.3' }, // usage-billing slug: never adopted
      { id: 'cline-pass/from-endpoint', name: 'From Endpoint' },
    ]
    const discoveries = new Map([['llm-pi-ai', inner]])
    const ctx = fakeLlmCtx(discoveries)
    installDiscoveryWrap(ctx, () => config, tinyTiming)
    const rows = await discoveries.get('llm-pi-ai')({ provider: 'clinepass' })
    const ids = rows.map(row => row.id)
    for (const model of PROBED_MODEL_SPECS) assert.ok(ids.includes(model.id), model.id)
    assert.ok(ids.includes('cline-pass/from-endpoint'))
    assert.ok(!ids.includes('zai/glm-5.3'))
    assert.ok(ids.every(id => id.startsWith('cline-pass/')))
    assert.equal(new Set(ids).size, ids.length) // no duplicates
    assert.equal(rows.length, 13) // pinned 12 + the one fetched subscription id
    ctx.disposers[0]()
  } finally {
    globalThis.fetch = realFetch
    clearRegistryCache()
  }
})

test('installDiscoveryWrap re-arms over a remounted discovery', async () => {
  const inner = async () => [{ id: 'inner' }]
  const discoveries = new Map([['llm-pi-ai', inner]])
  const ctx = fakeLlmCtx(discoveries)
  installDiscoveryWrap(ctx, () => config, tinyTiming)
  const first = discoveries.get('llm-pi-ai')
  assert.equal(first.answeredByClinepass, true)
  // A remount registers a fresh foreign discovery over our wrapper.
  const remounted = async (request) => [{ id: 'remounted/' + request.provider }]
  discoveries.set('llm-pi-ai', remounted)
  assert.ok(await waitFor(() => discoveries.get('llm-pi-ai') !== remounted))
  const second = discoveries.get('llm-pi-ai')
  assert.equal(second.answeredByClinepass, true)
  assert.notEqual(second, first) // a fresh wrapper, not the stale one
  // No nesting: the new wrapper delegates to the remounted inner.
  assert.deepEqual(await second({ provider: 'openai' }), [{ id: 'remounted/openai' }])
  ctx.disposers[0]()
})

test('installDiscoveryWrap adopts an existing clinepass wrapper instead of nesting', () => {
  const prior = async () => [{ id: 'prior' }]
  prior.answeredByClinepass = true
  const discoveries = new Map([['llm-pi-ai', prior]])
  const ctx = fakeLlmCtx(discoveries)
  installDiscoveryWrap(ctx, () => config, tinyTiming)
  assert.equal(discoveries.get('llm-pi-ai'), prior) // adopted as-is, never re-wrapped
  ctx.disposers[0]()
  assert.equal(discoveries.get('llm-pi-ai'), prior) // and not ours to remove
})

test('installDiscoveryWrap waits past the deadline and adopts a late discovery', async () => {
  const discoveries = new Map()
  const ctx = fakeLlmCtx(discoveries)
  installDiscoveryWrap(ctx, () => config, tinyTiming)
  assert.equal(discoveries.size, 0)
  assert.ok(await waitFor(() => ctx.logs.warn.some(line => line.includes('never appeared'))))
  assert.equal(ctx.logs.warn.filter(line => line.includes('never appeared')).length, 1)
  // llm-pi-ai mounts late: the slow watchdog picks the fresh discovery up.
  const inner = async () => []
  discoveries.set('llm-pi-ai', inner)
  assert.ok(await waitFor(() => discoveries.get('llm-pi-ai') !== inner))
  assert.equal(discoveries.get('llm-pi-ai').answeredByClinepass, true)
  ctx.disposers[0]()
})

test('installDiscoveryWrap contains a throwing install and warns once', async () => {
  const discoveries = new Map()
  discoveries.get = () => { throw new Error('boom') }
  const ctx = fakeLlmCtx(discoveries)
  installDiscoveryWrap(ctx, () => config, tinyTiming)
  assert.ok(await waitFor(() => ctx.logs.warn.some(line => line.includes('could not wrap'))))
  await settle(30)
  assert.equal(ctx.logs.warn.filter(line => line.includes('could not wrap')).length, 1)
  delete discoveries.get // restore the map read the disposer needs
  ctx.disposers[0]()
})

test('installDiscoveryWrap dispose restores the original and stops watching', async () => {
  const inner = async () => []
  const discoveries = new Map([['llm-pi-ai', inner]])
  const ctx = fakeLlmCtx(discoveries)
  installDiscoveryWrap(ctx, () => config, tinyTiming)
  assert.equal(discoveries.get('llm-pi-ai').answeredByClinepass, true)
  ctx.disposers[0]()
  assert.equal(discoveries.get('llm-pi-ai'), inner)
  // A later swap must not be re-armed: every watchdog timer is gone.
  const foreign = async () => []
  discoveries.set('llm-pi-ai', foreign)
  await settle(40)
  assert.equal(discoveries.get('llm-pi-ai'), foreign)
})

test('installDiscoveryWrap dispose leaves a foreign entry alone', () => {
  const inner = async () => []
  const discoveries = new Map([['llm-pi-ai', inner]])
  const ctx = fakeLlmCtx(discoveries)
  installDiscoveryWrap(ctx, () => config, tinyTiming)
  const foreign = async () => []
  discoveries.set('llm-pi-ai', foreign) // a remount beat the disposer
  ctx.disposers[0]()
  assert.equal(discoveries.get('llm-pi-ai'), foreign)
})

test('apply seeds exactly as before in a composition without llm', async () => {
  const settings = fakeSettings()
  const logs = { warn: [], info: [] }
  const ctx = {
    settings,
    logger: {
      warn: (...args) => logs.warn.push(args.join(' ')),
      info: (...args) => logs.info.push(args.join(' ')),
    },
    on: () => {},
    effect: () => {},
    inject: () => {}, // llm never registers: the scoped callback never runs
    get: () => undefined, // a real cordis ctx always has `get`; no llm here
    get llm() { throw new Error('service "llm" is not injected') },
  }
  apply(ctx, config)
  assert.ok(await waitFor(() => settings.calls.update.length === 1))
  assert.equal(settings.calls.update[0].patch.providers.clinepass.baseURL, 'https://api.cline.bot/api/v1')
  assert.equal(settings.calls.update[0].patch.providers.clinepass.models.length, 12)
  assert.equal(settings.calls.mutate.length, 0)
  assert.equal(logs.warn.length, 0)
})

test('apply wires the injected directory into the collision guard', async () => {
  const settings = fakeSettings()
  const logs = { warn: [], info: [] }
  const directory = [{ provider: 'clinepass', declared: false }]
  // cordis runs the scoped callback once llm is available; here it already is.
  const scoped = {
    llm: { listConfigurableProviders: () => directory, discoveries: new Map() },
    effect: (execute) => { execute() },
  }
  const ctx = {
    settings,
    logger: {
      warn: (...args) => logs.warn.push(args.join(' ')),
      info: (...args) => logs.info.push(args.join(' ')),
    },
    on: () => {},
    effect: () => {},
    inject: (_deps, callback) => callback(scoped),
    get llm() { throw new Error('service "llm" is not injected') },
  }
  apply(ctx, config)
  assert.ok(await waitFor(() => logs.warn.some(line => line.includes("routeKey 'clinepass'"))))
  assert.equal(settings.calls.update.length, 0)
  assert.equal(settings.calls.mutate.length, 0)
})

test('apply still consults the directory when the scoped callback lands late', async () => {
  // The live-harness shape: the llm runtime is a sibling fiber, so `ctx.llm`
  // throws, `ctx.inject` resolves a turn after activation — and the seed's
  // first run beats that callback. `ctx.get("llm")` is the synchronous read
  // the guard falls back to.
  const settings = fakeSettings()
  const logs = { warn: [], info: [] }
  const directory = [{ provider: 'clinepass', declared: false }]
  const ctx = {
    settings,
    logger: {
      warn: (...args) => logs.warn.push(args.join(' ')),
      info: (...args) => logs.info.push(args.join(' ')),
    },
    on: () => {},
    effect: () => {},
    inject: () => {}, // the scoped callback has not run yet
    get: (name) => (name === 'llm' ? { listConfigurableProviders: () => directory } : undefined),
    get llm() { throw new Error('service "llm" is not injected') },
  }
  apply(ctx, config)
  assert.ok(await waitFor(() => logs.warn.some(line => line.includes("routeKey 'clinepass'"))))
  assert.equal(settings.calls.update.length, 0)
  assert.equal(settings.calls.mutate.length, 0)
})

test('apply tolerates a throwing directory read and still seeds', async () => {
  const settings = fakeSettings()
  const logs = { warn: [], info: [] }
  const ctx = {
    settings,
    logger: {
      warn: (...args) => logs.warn.push(args.join(' ')),
      info: (...args) => logs.info.push(args.join(' ')),
    },
    on: () => {},
    effect: () => {},
    inject: () => {},
    get: () => { throw new Error('service is inactive') },
    get llm() { throw new Error('service "llm" is not injected') },
  }
  apply(ctx, config)
  assert.ok(await waitFor(() => settings.calls.update.length === 1))
  assert.equal(settings.calls.update[0].patch.providers.clinepass.baseURL, 'https://api.cline.bot/api/v1')
  assert.equal(logs.warn.length, 0)
})

// --- pinned behaviours the adversarial pass showed a mutation can break ----

test('installSeed fills specs before the collision guard ever runs', async () => {
  // Steady state: the seeded route is itself in the directory (llm-pi-ai
  // declares it), so the existing-route branch must win. A guard-first order
  // would refuse forever and silently kill the spec fill.
  const settings = fakeSettings({
    providers: { clinepass: { models: [{ id: 'cline-pass/kimi-k3' }] } },
    revision: 5,
  })
  const ctx = fakeSeedCtx(settings)
  installSeed(ctx, () => config, {
    attempts: 2,
    intervalMs: 1,
    readInstalledRoutes: () => [{ provider: 'clinepass', declared: true }],
  })
  assert.ok(await waitFor(() => settings.calls.mutate.length === 1))
  assert.equal(settings.calls.mutate[0].ops[0].value[0].contextWindow, 1048576)
  assert.equal(settings.calls.update.length, 0)
  assert.equal(ctx.logs.warn.filter(line => line.includes('already a provider route')).length, 0)
})

test('installSeed survives a throwing directory reader and still seeds', async () => {
  const unhandled = []
  const onUnhandled = (reason) => unhandled.push(reason)
  process.on('unhandledRejection', onUnhandled)
  try {
    const settings = fakeSettings()
    const ctx = fakeSeedCtx(settings)
    installSeed(ctx, () => config, {
      attempts: 2,
      intervalMs: 1,
      readInstalledRoutes: () => { throw new Error('directory exploded') },
    })
    assert.ok(await waitFor(() => settings.calls.update.length === 1))
    assert.equal(settings.calls.update[0].patch.providers.clinepass.baseURL, 'https://api.cline.bot/api/v1')
    // Best-effort guard: one note, no refusal, and no escaping rejection.
    assert.equal(ctx.logs.warn.filter(line => line.includes('could not read the llm provider directory')).length, 1)
    assert.equal(ctx.logs.warn.filter(line => line.includes('already a provider route')).length, 0)
    await settle(10)
    assert.deepEqual(unhandled, [])
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
})

test('installSeed contains an unexpected run failure and retries later', async () => {
  const unhandled = []
  const onUnhandled = (reason) => unhandled.push(reason)
  process.on('unhandledRejection', onUnhandled)
  try {
    const settings = fakeSettings()
    const ctx = fakeSeedCtx(settings)
    const boom = () => { throw new Error('config exploded') }
    installSeed(ctx, boom, { attempts: 2, intervalMs: 1, readInstalledRoutes: () => [] })
    const failures = () => ctx.logs.warn.filter(line => line.includes('seed run failed'))
    assert.ok(await waitFor(() => failures().length === 1))
    assert.match(failures()[0], /config exploded/)
    // `done` stayed false, so the next volatile update retries the run.
    ctx.handlers.get('loader/volatile-update')()
    assert.ok(await waitFor(() => failures().length === 2))
    await settle(10)
    assert.deepEqual(unhandled, [])
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
})

test('installSeed warns once per seed run on a refused key', async () => {
  const settings = fakeSettings()
  const ctx = fakeSeedCtx(settings)
  installSeed(ctx, () => config, {
    attempts: 2,
    intervalMs: 1,
    readInstalledRoutes: () => [{ provider: 'clinepass', declared: false }],
  })
  const refusals = () => ctx.logs.warn.filter(line => line.includes('already a provider route'))
  assert.ok(await waitFor(() => refusals().length === 1))
  // A volatile update on this entry resets `done` and re-runs the seed, so the
  // unchanged bad key warns again: one warning per run, not per activation.
  ctx.handlers.get('loader/volatile-update')()
  assert.ok(await waitFor(() => refusals().length === 2))
  assert.equal(refusals()[0], refusals()[1])
  assert.equal(settings.calls.update.length, 0)
})

test('installDiscoveryWrap dispose clears every pending timer', async () => {
  const realSetTimeout = globalThis.setTimeout
  const realClearTimeout = globalThis.clearTimeout
  const pending = new Set()
  globalThis.setTimeout = (fn, ms, ...args) => {
    const timer = realSetTimeout(fn, ms, ...args)
    pending.add(timer)
    return timer
  }
  globalThis.clearTimeout = (timer) => {
    pending.delete(timer)
    return realClearTimeout(timer)
  }
  try {
    const inner = async () => []
    const discoveries = new Map([['llm-pi-ai', inner]])
    const ctx = fakeLlmCtx(discoveries)
    const before = pending.size
    installDiscoveryWrap(ctx, () => config, tinyTiming)
    assert.equal(discoveries.get('llm-pi-ai').answeredByClinepass, true)
    assert.ok(pending.size > before) // the lifetime watchdog is armed
    ctx.disposers[0]()
    assert.equal(pending.size, before) // every timer it armed was cleared
    // Nothing re-arms afterwards: a foreign entry stays foreign.
    const foreign = async () => []
    discoveries.set('llm-pi-ai', foreign)
    await new Promise(resolve => realSetTimeout(resolve, 40))
    assert.equal(discoveries.get('llm-pi-ai'), foreign)
    assert.equal(pending.size, before)
  } finally {
    globalThis.setTimeout = realSetTimeout
    globalThis.clearTimeout = realClearTimeout
  }
})

test('installDiscoveryWrap retries at the fast cadence before the deadline', async () => {
  const discoveries = new Map()
  let attempts = 0
  const realGet = Map.prototype.get
  discoveries.get = function (key) {
    attempts += 1
    return realGet.call(this, key)
  }
  const ctx = fakeLlmCtx(discoveries)
  // pollMs is a thousand times fastMs: a retry that used the watchdog period
  // would attempt once and stop.
  installDiscoveryWrap(ctx, () => config, { fastMs: 5, deadlineMs: 500, pollMs: 1000 })
  await settle(60)
  assert.ok(attempts >= 3, 'expected fast retries before the deadline, saw ' + attempts)
  ctx.disposers[0]()
})

test('apply prefers the live llm read over a cached scoped handle', async () => {
  // The scoped handle is captured once; a service reload can leave it stale.
  // The cached handle says the key is free, the live one says it is claimed.
  const settings = fakeSettings()
  const logs = { warn: [], info: [] }
  const stale = { listConfigurableProviders: () => [] }
  const fresh = { listConfigurableProviders: () => [{ provider: 'clinepass', declared: false }] }
  const ctx = {
    settings,
    logger: {
      warn: (...args) => logs.warn.push(args.join(' ')),
      info: (...args) => logs.info.push(args.join(' ')),
    },
    on: () => {},
    effect: () => {},
    inject: (_deps, callback) => callback({ llm: stale, effect: () => {} }),
    get: (name) => (name === 'llm' ? fresh : undefined),
    get llm() { throw new Error('service "llm" is not injected') },
  }
  apply(ctx, config)
  assert.ok(await waitFor(() => logs.warn.some(line => line.includes("routeKey 'clinepass'"))))
  assert.equal(settings.calls.update.length, 0)
})

// --- credential failures surface; the fallback stays for everything else ----

test('installDiscoveryWrap rethrows a rejected credential instead of masking it', async () => {
  const failure = Object.assign(
    new Error('https://api.cline.bot/api/v1/models answered 401; check the API key'),
    { code: 'DISCOVERY_FAILED' },
  )
  const realFetch = globalThis.fetch
  clearRegistryCache()
  // The parallel registry fetch must not hit the real network from this test.
  globalThis.fetch = async () => ({ ok: true, json: async () => ({}) })
  try {
    const inner = async () => { throw failure }
    const discoveries = new Map([['llm-pi-ai', inner]])
    const ctx = fakeLlmCtx(discoveries)
    installDiscoveryWrap(ctx, () => config, tinyTiming)
    // The original error, unchanged: the Models page shows the harness's message.
    await assert.rejects(
      discoveries.get('llm-pi-ai')({ provider: 'clinepass' }),
      (error) => error === failure,
    )
    assert.equal(ctx.logs.warn.length, 0)
    ctx.disposers[0]()
  } finally {
    globalThis.fetch = realFetch
    clearRegistryCache()
  }
})

test('installDiscoveryWrap answers the pinned rows when nothing is configured', async () => {
  const realFetch = globalThis.fetch
  clearRegistryCache()
  globalThis.fetch = async () => ({ ok: true, json: async () => ({}) })
  try {
    const inner = async () => {
      throw Object.assign(
        new Error('llm-pi-ai: no credential for provider route "clinepass"'),
        { code: 'MISSING_CREDENTIAL' },
      )
    }
    const discoveries = new Map([['llm-pi-ai', inner]])
    const ctx = fakeLlmCtx(discoveries)
    installDiscoveryWrap(ctx, () => config, tinyTiming)
    const rows = await discoveries.get('llm-pi-ai')({ provider: 'clinepass' })
    assert.equal(rows.length, 12)
    assert.ok(rows.every(row => row.id.startsWith('cline-pass/')))
    assert.equal(ctx.logs.warn.filter(line => line.includes('endpoint listing unavailable')).length, 1)
    ctx.disposers[0]()
  } finally {
    globalThis.fetch = realFetch
    clearRegistryCache()
  }
})

test('installDiscoveryWrap answers the pinned rows when the endpoint is unreachable', async () => {
  const realFetch = globalThis.fetch
  clearRegistryCache()
  globalThis.fetch = async () => ({ ok: true, json: async () => ({}) })
  try {
    const inner = async () => {
      throw Object.assign(
        new Error('could not reach https://api.cline.bot/api/v1/models'),
        { code: 'DISCOVERY_FAILED' },
      )
    }
    const discoveries = new Map([['llm-pi-ai', inner]])
    const ctx = fakeLlmCtx(discoveries)
    installDiscoveryWrap(ctx, () => config, tinyTiming)
    const rows = await discoveries.get('llm-pi-ai')({ provider: 'clinepass' })
    assert.equal(rows.length, 12)
    assert.equal(ctx.logs.warn.filter(line => line.includes('endpoint listing unavailable')).length, 1)
    ctx.disposers[0]()
  } finally {
    globalThis.fetch = realFetch
    clearRegistryCache()
  }
})

test('apply falls back to the scoped handle when ctx.get throws', async () => {
  // R2: a throwing inject-free read must not skip the guard while a perfectly
  // usable scoped handle is sitting right there.
  const settings = fakeSettings()
  const logs = { warn: [], info: [] }
  const scoped = {
    llm: { listConfigurableProviders: () => [{ provider: 'clinepass', declared: false }] },
    effect: (execute) => { execute() },
  }
  const ctx = {
    settings,
    logger: {
      warn: (...args) => logs.warn.push(args.join(' ')),
      info: (...args) => logs.info.push(args.join(' ')),
    },
    on: () => {},
    effect: () => {},
    inject: (_deps, callback) => callback(scoped),
    get: () => { throw new Error('service is inactive') },
    get llm() { throw new Error('service "llm" is not injected') },
  }
  apply(ctx, config)
  assert.ok(await waitFor(() => logs.warn.some(line => line.includes("routeKey 'clinepass'"))))
  assert.equal(settings.calls.update.length, 0)
  assert.equal(settings.calls.mutate.length, 0)
})

test('installSeed contains a throwing logger in the run-chain catch', async () => {
  const unhandled = []
  const onUnhandled = (reason) => unhandled.push(reason)
  process.on('unhandledRejection', onUnhandled)
  try {
    const settings = fakeSettings()
    const ctx = {
      settings,
      logger: {
        warn: () => { throw new Error('logger exploded') },
        info: () => {},
      },
      on: () => {},
    }
    installSeed(ctx, () => { throw new Error('config exploded') }, {
      attempts: 2,
      intervalMs: 1,
      readInstalledRoutes: () => [],
    })
    await settle(20)
    assert.deepEqual(unhandled, [])
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
})

// --- fetch-first: the model list is pulled live, never shipped ---------------

test('installSeed fetches the model list from the registry when none is pinned', async () => {
  const realFetch = globalThis.fetch
  clearRegistryCache()
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      'cline-pass': {
        models: {
          // A known id: the probe corrects the registry's image claim.
          'cline-pass/qwen3.7-max': {
            id: 'cline-pass/qwen3.7-max',
            name: 'Qwen3.7 Max',
            modalities: { input: ['text', 'image'] },
          },
          // A new id: the registry's word alone (modalities narrowed).
          'cline-pass/kimi-k2.6': {
            id: 'cline-pass/kimi-k2.6',
            name: 'Kimi K2.6',
            limit: { context: 262144, output: 262144 },
            modalities: { input: ['text', 'image', 'video'] },
          },
        },
      },
    }),
  })
  try {
    const settings = fakeSettings()
    const ctx = fakeSeedCtx(settings)
    installSeed(ctx, () => ({ ...config, models: [] }), { attempts: 2, intervalMs: 1, readInstalledRoutes: () => [] })
    assert.ok(await waitFor(() => settings.calls.update.length === 1))
    assert.deepEqual(settings.calls.update[0].patch.providers.clinepass.models, [
      { id: 'cline-pass/qwen3.7-max', name: 'Qwen3.7 Max', contextWindow: 1000000, maxTokens: 131072, input: ['text'] },
      { id: 'cline-pass/kimi-k2.6', name: 'Kimi K2.6', contextWindow: 262144, maxTokens: 262144, input: ['text', 'image'] },
    ])
  } finally {
    globalThis.fetch = realFetch
    clearRegistryCache()
  }
})

test('installSeed seeds an empty route rather than a stale one when the fetch fails', async () => {
  const realFetch = globalThis.fetch
  clearRegistryCache()
  globalThis.fetch = async () => { throw new Error('network down') }
  try {
    const settings = fakeSettings()
    const ctx = fakeSeedCtx(settings)
    installSeed(ctx, () => ({ ...config, models: [] }), { attempts: 2, intervalMs: 1, readInstalledRoutes: () => [] })
    assert.ok(await waitFor(() => settings.calls.update.length === 1))
    assert.deepEqual(settings.calls.update[0].patch.providers.clinepass.models, [])
  } finally {
    globalThis.fetch = realFetch
    clearRegistryCache()
  }
})

test('installDiscoveryWrap answers purely from the fetch when nothing is pinned', async () => {
  const realFetch = globalThis.fetch
  clearRegistryCache()
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      'cline-pass': { models: { 'cline-pass/kimi-k2.6': { id: 'cline-pass/kimi-k2.6', name: 'Kimi K2.6' } } },
    }),
  })
  try {
    const inner = async () => [{ id: 'cline-pass/from-endpoint' }]
    const discoveries = new Map([['llm-pi-ai', inner]])
    const ctx = fakeLlmCtx(discoveries)
    installDiscoveryWrap(ctx, () => ({ ...config, models: [] }), tinyTiming)
    const rows = await discoveries.get('llm-pi-ai')({ provider: 'clinepass' })
    assert.deepEqual(rows.map(row => row.id), ['cline-pass/from-endpoint', 'cline-pass/kimi-k2.6'])
    // No probed-table id leaked in: it is a correction table, not a catalog.
    assert.ok(!rows.some(row => row.id === 'cline-pass/glm-5.3'))
    ctx.disposers[0]()
  } finally {
    globalThis.fetch = realFetch
    clearRegistryCache()
  }
})

test('installDiscoveryWrap answers empty when every source fails and nothing is pinned', async () => {
  const realFetch = globalThis.fetch
  clearRegistryCache()
  globalThis.fetch = async () => { throw new Error('network down') }
  try {
    const inner = async () => {
      throw Object.assign(new Error('answered 500'), { code: 'DISCOVERY_FAILED' })
    }
    const discoveries = new Map([['llm-pi-ai', inner]])
    const ctx = fakeLlmCtx(discoveries)
    installDiscoveryWrap(ctx, () => ({ ...config, models: [] }), tinyTiming)
    assert.deepEqual(await discoveries.get('llm-pi-ai')({ provider: 'clinepass' }), [])
    ctx.disposers[0]()
  } finally {
    globalThis.fetch = realFetch
    clearRegistryCache()
  }
})
