import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DEFAULT_MODELS, buildRouteProfile, credentialFailure, effectiveCatalog, mergeSpecFill, registryPlanModels, reservedRouteKey, shippedDiscoveryModels } from '../lib/route.js'
import { apply, installDiscoveryWrap, installSeed } from '../lib/index.js'

const config = {
  seed: true,
  routeKey: 'clinepass',
  displayName: 'ClinePass',
  apiKeyEnv: 'CLINEPASS_API_KEY',
  baseURL: 'https://api.cline.bot/api/v1',
  api: 'openai-completions',
  models: DEFAULT_MODELS,
}

test('shipped catalog is the documented ClinePass slugs', () => {
  assert.equal(DEFAULT_MODELS.length, 12)
  for (const model of DEFAULT_MODELS) {
    assert.ok(model.id.startsWith('cline-pass/'), model.id)
    assert.ok(model.name.length > 0, model.id)
  }
})

test('buildRouteProfile carries endpoint, protocol, credential ref, and models', () => {
  const profile = buildRouteProfile(config)
  assert.equal(profile.api, 'openai-completions')
  assert.equal(profile.baseURL, 'https://api.cline.bot/api/v1')
  assert.equal(profile.apiKeyEnv, 'CLINEPASS_API_KEY')
  assert.equal(profile.displayName, 'ClinePass')
  assert.equal(profile.models.length, 12)
  assert.deepEqual(profile.models[0], {
    id: 'cline-pass/glm-5.3',
    name: 'GLM-5.3',
    contextWindow: 1000000,
    maxTokens: 131072,
    input: ['text', 'image'],
  })
})

test('buildRouteProfile drops absent optional model fields', () => {
  const profile = buildRouteProfile({
    ...config,
    models: [{ id: 'cline-pass/x', contextWindow: 1000, maxTokens: 100 }],
  })
  assert.deepEqual(profile.models, [{ id: 'cline-pass/x', contextWindow: 1000, maxTokens: 100 }])
  assert.ok(!('name' in profile.models[0]))
  assert.ok(!('input' in profile.models[0]))
})

test('image modalities are probed facts, not uniform guesses', () => {
  const byId = Object.fromEntries(DEFAULT_MODELS.map(model => [model.id, model.input]))
  assert.deepEqual(byId['cline-pass/mimo-v2.5-pro'], ['text'])
  assert.deepEqual(byId['cline-pass/qwen3.7-max'], ['text'])
  // Region-locked for the probing deployment: catalog consensus, not a probe.
  assert.deepEqual(byId['cline-pass/muse-spark-1.3-contributor'], ['text', 'image'])
  assert.deepEqual(byId['cline-pass/glm-5.3'], ['text', 'image'])
  assert.deepEqual(byId['cline-pass/qwen3.7-plus'], ['text', 'image'])
})

test('capacities are curated catalog values; deepseek-v4.1-flash states none', () => {
  const byId = Object.fromEntries(DEFAULT_MODELS.map(model => [model.id, model]))
  assert.equal(byId['cline-pass/kimi-k3'].contextWindow, 1048576)
  assert.equal(byId['cline-pass/minimax-m3'].maxTokens, 512000)
  assert.equal(byId['cline-pass/qwen3.7-plus'].maxTokens, 65536)
  assert.ok(!('contextWindow' in byId['cline-pass/deepseek-v4.1-flash']))
  assert.ok(!('maxTokens' in byId['cline-pass/deepseek-v4.1-flash']))
})

test('mergeSpecFill fills absent specs on shipped ids only', () => {
  const existing = [
    { id: 'cline-pass/kimi-k3', name: 'Kimi K3', input: ['text', 'image'] }, // seeded without specs
    { id: 'cline-pass/qwen3.7-plus', name: 'Mine', contextWindow: 42, input: ['text'] }, // user-set: untouched
    { id: 'cline-pass/custom', name: 'User added' }, // unknown id: untouched
  ]
  const merged = mergeSpecFill(existing, DEFAULT_MODELS)
  assert.equal(merged.length, 3)
  assert.deepEqual(merged[0], {
    id: 'cline-pass/kimi-k3',
    name: 'Kimi K3',
    input: ['text', 'image'],
    contextWindow: 1048576,
    maxTokens: 131072,
  })
  // User-set contextWindow stays; the absent maxTokens is the fill's job.
  assert.deepEqual(merged[1], { id: 'cline-pass/qwen3.7-plus', name: 'Mine', contextWindow: 42, maxTokens: 65536, input: ['text'] })
  assert.deepEqual(merged[2], { id: 'cline-pass/custom', name: 'User added' })
})

test('mergeSpecFill returns null when nothing would change', () => {
  const seeded = DEFAULT_MODELS.map(model => ({ ...model }))
  assert.equal(mergeSpecFill(seeded, DEFAULT_MODELS), null)
  assert.equal(mergeSpecFill([], DEFAULT_MODELS), null)
  assert.equal(mergeSpecFill(undefined, DEFAULT_MODELS), null)
})

test('effectiveCatalog lifts a spec-less resolved config to the code floor', () => {
  // The super-injector's fiber rebuild can hand apply() a config resolved
  // before schema defaults settled: models present, specs absent.
  const stale = DEFAULT_MODELS.map(({ id, name, input }) => ({ id, name, input: [...input] }))
  const catalog = effectiveCatalog({ models: stale })
  assert.equal(catalog.length, 12)
  assert.equal(catalog.find(m => m.id === 'cline-pass/kimi-k3').contextWindow, 1048576)
  // A configured value always beats the floor.
  const pinned = stale.map(m => m.id === 'cline-pass/kimi-k3' ? { ...m, contextWindow: 7 } : m)
  assert.equal(effectiveCatalog({ models: pinned }).find(m => m.id === 'cline-pass/kimi-k3').contextWindow, 7)
  // An explicitly empty configured list is respected as-is.
  assert.deepEqual(effectiveCatalog({}), [])
})

test('shippedDiscoveryModels answers the shipped catalog and carries modalities', () => {
  const rows = shippedDiscoveryModels(config)
  assert.equal(rows.length, 12)
  assert.deepEqual(rows[0], {
    id: 'cline-pass/glm-5.3',
    name: 'GLM-5.3',
    contextWindow: 1000000,
    maxTokens: 131072,
    inputModalities: ['text', 'image'],
  })
})

test('shippedDiscoveryModels keeps only unknown cline-pass ids from the endpoint listing', () => {
  const live = [
    { id: 'zai/glm-5.3', name: 'GLM-5.3' }, // usage-billing slug: never adopted
    { id: 'cline-pass/glm-5.3', name: 'duplicate' }, // already shipped: never duplicated
    { id: 'cline-pass/new-model', name: 'New Model', contextWindow: 100000 }, // subscription slug: adopted
  ]
  const rows = shippedDiscoveryModels(config, live)
  assert.equal(rows.length, 13)
  assert.ok(!rows.some(row => row.id === 'zai/glm-5.3'))
  assert.equal(rows.filter(row => row.id === 'cline-pass/glm-5.3').length, 1)
  assert.deepEqual(rows[12], { id: 'cline-pass/new-model', name: 'New Model', contextWindow: 100000 })
})

test('shippedDiscoveryModels tolerates a missing or malformed listing', () => {
  assert.equal(shippedDiscoveryModels(config, undefined).length, 12)
  assert.equal(shippedDiscoveryModels(config, [null, {}, { id: 42 }]).length, 12)
})

test('registryPlanModels maps the registry plan catalog into discovered-model rows', () => {
  const rows = registryPlanModels({
    'cline-pass': {
      models: {
        'cline-pass/mimo-v2.6-pro': {
          id: 'cline-pass/mimo-v2.6-pro',
          name: 'MiMo-V2.6-Pro',
          limit: { context: 1048576, output: 131072 },
          modalities: { input: ['text', 'image', 'audio', 'video'], output: ['text'] },
        },
        'cline-pass/deepseek-v4-flash': {
          id: 'cline-pass/deepseek-v4-flash',
          name: 'DeepSeek V4 Flash',
          limit: { context: 1000000, output: 384000 },
          modalities: { input: ['text'] },
        },
      },
    },
  })
  assert.deepEqual(rows, [
    {
      id: 'cline-pass/mimo-v2.6-pro',
      name: 'MiMo-V2.6-Pro',
      contextWindow: 1048576,
      maxTokens: 131072,
      // models.dev declares audio+video too; the route schema accepts neither,
      // so passing them through failed the editor's write validation.
      inputModalities: ['text', 'image'],
    },
    {
      id: 'cline-pass/deepseek-v4-flash',
      name: 'DeepSeek V4 Flash',
      contextWindow: 1000000,
      maxTokens: 384000,
      inputModalities: ['text'],
    },
  ])
})

test('registryPlanModels narrows modalities to the route schema vocabulary', () => {
  const rows = registryPlanModels({
    'cline-pass': {
      models: {
        'cline-pass/audio-only': {
          id: 'cline-pass/audio-only',
          name: 'Audio Only',
          modalities: { input: ['audio', 'video'] }, // nothing the schema accepts
        },
        'cline-pass/vision': {
          id: 'cline-pass/vision',
          name: 'Vision',
          modalities: { input: ['video', 'text', 'image'] }, // extras dropped, order kept
        },
      },
    },
  })
  // No acceptable modality: the field is absent, so llm-pi-ai's defaults apply.
  assert.deepEqual(rows[0], { id: 'cline-pass/audio-only', name: 'Audio Only' })
  assert.deepEqual(rows[1].inputModalities, ['text', 'image'])
})

test('every registry row is writable by the llm-pi-ai route schema', () => {
  // Regression for the live failure:
  // "$.providers.clinepass.models[4].input[2] expected \"text\" | \"image\" but got \"audio\"".
  const rows = registryPlanModels({
    'cline-pass': {
      models: {
        'cline-pass/mimo-v2.6-pro': {
          id: 'cline-pass/mimo-v2.6-pro',
          modalities: { input: ['text', 'image', 'audio', 'video'] },
        },
        'cline-pass/kimi-k2.6': {
          id: 'cline-pass/kimi-k2.6',
          modalities: { input: ['text', 'image', 'video'] },
        },
      },
    },
  })
  for (const row of rows) {
    for (const modality of row.inputModalities ?? []) {
      assert.ok(['text', 'image'].includes(modality), `${row.id} carries ${modality}`)
    }
  }
})

test('registryPlanModels never widens the route past the subscription namespace', () => {
  const rows = registryPlanModels({
    'cline-pass': {
      models: {
        'openai/gpt-5.5': { id: 'openai/gpt-5.5', name: 'GPT-5.5' }, // usage billing: dropped
        'cline-pass/glm-5.2': { id: 'cline-pass/glm-5.2' }, // unnamed: falls back to the id
      },
    },
    openai: { models: { 'openai/gpt-5.5': { id: 'openai/gpt-5.5' } } }, // other provider: ignored
  })
  assert.deepEqual(rows, [{ id: 'cline-pass/glm-5.2', name: 'cline-pass/glm-5.2' }])
})

test('registryPlanModels tolerates a missing, empty, or malformed payload', () => {
  assert.deepEqual(registryPlanModels(undefined), [])
  assert.deepEqual(registryPlanModels({}), [])
  assert.deepEqual(registryPlanModels({ 'cline-pass': {} }), [])
  assert.deepEqual(registryPlanModels({ 'cline-pass': { models: null } }), [])
  assert.deepEqual(registryPlanModels({ 'cline-pass': { models: [1, 2] } }), [])
  // A malformed entry cannot smuggle a non-subscription id in.
  assert.deepEqual(registryPlanModels({ 'cline-pass': { models: { a: { id: 42 }, b: null } } }), [])
})

test('registry plan rows compose with the shipped catalog: plan first, no duplicates', () => {
  const registry = registryPlanModels({
    'cline-pass': {
      models: {
        'cline-pass/glm-5.3': { id: 'cline-pass/glm-5.3', name: 'registry claim' }, // shipped wins
        'cline-pass/kimi-k2.6': {
          id: 'cline-pass/kimi-k2.6',
          name: 'Kimi K2.6',
          limit: { context: 262144, output: 262144 },
          modalities: { input: ['text', 'image', 'video'] },
        },
      },
    },
  })
  const rows = shippedDiscoveryModels(config, registry)
  assert.equal(rows.length, 13)
  // The probed shipped row keeps its own name and modalities.
  assert.deepEqual(rows[0], {
    id: 'cline-pass/glm-5.3',
    name: 'GLM-5.3',
    contextWindow: 1000000,
    maxTokens: 131072,
    inputModalities: ['text', 'image'],
  })
  assert.deepEqual(rows[12], {
    id: 'cline-pass/kimi-k2.6',
    name: 'Kimi K2.6',
    contextWindow: 262144,
    maxTokens: 262144,
    inputModalities: ['text', 'image'],
  })
})

// --- route-key guard, seed, and discovery wrap -----------------------------
//
// These exercise lib/index.js against doubles, so they stay free of any
// harness package: a settings service with describe/update/mutate, and a ctx
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

test('reservedRouteKey reports any directory entry carrying that provider id', () => {
  // Catalog-owned route: llm-pi-ai marks those `declared: false`.
  assert.equal(reservedRouteKey('deepseek', [{ provider: 'deepseek', declared: false }]), 'deepseek')
  // Another adapter's route arrives with `declared` undefined — still a conflict.
  assert.equal(reservedRouteKey('deepseek-official', [{ provider: 'deepseek-official' }]), 'deepseek-official')
  // llm-pi-ai's own declared route: the settings check refuses it too.
  assert.equal(reservedRouteKey('clinepass', [{ provider: 'clinepass', declared: true }]), 'clinepass')
  // A free key, and exact case-sensitive matching.
  assert.equal(reservedRouteKey('clinepass', [{ provider: 'ClinePass', declared: false }]), null)
  assert.equal(reservedRouteKey('clinepass', [{ provider: 'other', declared: false }]), null)
  assert.equal(reservedRouteKey('clinepass', []), null)
})

test('reservedRouteKey tolerates a missing or malformed directory', () => {
  assert.equal(reservedRouteKey('clinepass', undefined), null)
  assert.equal(reservedRouteKey('clinepass', null), null)
  assert.equal(reservedRouteKey('clinepass', {}), null)
  assert.equal(reservedRouteKey('clinepass', 'clinepass'), null)
  assert.equal(reservedRouteKey('clinepass', [null, 42, {}, { provider: 7 }]), null)
  assert.equal(reservedRouteKey(undefined, [{ provider: undefined }]), null)
  assert.equal(reservedRouteKey(42, [{ provider: 42 }]), null)
  assert.equal(reservedRouteKey('', [{ provider: '' }]), null)
})

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
    providers: { clinepass: { models: DEFAULT_MODELS.map(model => ({ ...model })) } },
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

test('installDiscoveryWrap answers the ClinePass card with the shipped catalog', async () => {
  const realFetch = globalThis.fetch
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
    for (const model of DEFAULT_MODELS) assert.ok(ids.includes(model.id), model.id)
    assert.ok(ids.includes('cline-pass/from-endpoint'))
    assert.ok(!ids.includes('zai/glm-5.3'))
    assert.ok(ids.every(id => id.startsWith('cline-pass/')))
    assert.equal(new Set(ids).size, ids.length) // no duplicates
    assert.equal(rows.length, 13) // shipped 12 + the one unknown subscription id
    ctx.disposers[0]()
  } finally {
    globalThis.fetch = realFetch
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

test('credentialFailure flags only a supplied-but-rejected credential', () => {
  // Malformed/blank stored key.
  assert.equal(credentialFailure({ code: 'INVALID_CREDENTIAL', message: 'llm-pi-ai: api key is blank' }), true)
  // HTTP 401/403: llm-pi-ai appends the hint only for those statuses.
  assert.equal(credentialFailure({
    code: 'DISCOVERY_FAILED',
    message: 'https://api.cline.bot/api/v1/models answered 401; check the API key',
  }), true)
  assert.equal(credentialFailure({
    code: 'DISCOVERY_FAILED',
    message: 'https://api.cline.bot/api/v1/models answered 403; CHECK THE API KEY',
  }), true)
  // Other DISCOVERY_FAILED causes are not verdicts on the key.
  assert.equal(credentialFailure({
    code: 'DISCOVERY_FAILED',
    message: 'could not reach https://api.cline.bot/api/v1/models',
  }), false)
  assert.equal(credentialFailure({
    code: 'DISCOVERY_FAILED',
    message: 'https://api.cline.bot/api/v1/models answered 500',
  }), false)
  // Nothing configured yet: the shipped catalog is the documented answer there.
  assert.equal(credentialFailure({
    code: 'MISSING_CREDENTIAL',
    message: 'llm-pi-ai: no credential for provider route "clinepass"',
  }), false)
  // Malformed inputs never count as a credential verdict.
  assert.equal(credentialFailure(undefined), false)
  assert.equal(credentialFailure('DISCOVERY_FAILED; check the API key'), false)
  assert.equal(credentialFailure({}), false)
  assert.equal(credentialFailure({ code: 'DISCOVERY_FAILED' }), false)
  assert.equal(credentialFailure({ code: 'DISCOVERY_FAILED', message: 42 }), false)
  assert.equal(credentialFailure({ code: 401, message: 'check the API key' }), false)
})

test('installDiscoveryWrap rethrows a rejected credential instead of masking it', async () => {
  const failure = Object.assign(
    new Error('https://api.cline.bot/api/v1/models answered 401; check the API key'),
    { code: 'DISCOVERY_FAILED' },
  )
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
})

test('installDiscoveryWrap answers the catalog when nothing is configured', async () => {
  const realFetch = globalThis.fetch
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
  }
})

test('installDiscoveryWrap answers the catalog when the endpoint is unreachable', async () => {
  const realFetch = globalThis.fetch
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
