import assert from 'node:assert/strict'
import { test } from 'node:test'

// Pure-fact tests: route.js is import-free on purpose, so this file runs with
// `node --test` without resolving any harness package (no node_modules
// needed). The installSeed/installDiscoveryWrap/apply behaviour tests live in
// index.test.js, which needs the @deepseek-ai/schemastery peer installed.
import { PROBED_MODEL_SPECS, buildRouteProfile, credentialFailure, effectiveCatalog, fetchedDiscoveryModels, mergeSpecFill, registryPlanModels, reservedRouteKey, routeModelsFromDiscovery } from '../lib/route.js'

const config = {
  seed: true,
  routeKey: 'clinepass',
  displayName: 'ClinePass',
  apiKeyEnv: 'CLINEPASS_API_KEY',
  baseURL: 'https://api.cline.bot/api/v1',
  api: 'openai-completions',
  models: PROBED_MODEL_SPECS,
}

test('probed spec table covers the documented ClinePass slugs', () => {
  assert.equal(PROBED_MODEL_SPECS.length, 12)
  for (const model of PROBED_MODEL_SPECS) {
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
  const byId = Object.fromEntries(PROBED_MODEL_SPECS.map(model => [model.id, model.input]))
  assert.deepEqual(byId['cline-pass/mimo-v2.5-pro'], ['text'])
  assert.deepEqual(byId['cline-pass/qwen3.7-max'], ['text'])
  // Region-locked for the probing deployment: catalog consensus, not a probe.
  assert.deepEqual(byId['cline-pass/muse-spark-1.3-contributor'], ['text', 'image'])
  assert.deepEqual(byId['cline-pass/glm-5.3'], ['text', 'image'])
  assert.deepEqual(byId['cline-pass/qwen3.7-plus'], ['text', 'image'])
})

test('capacities are curated catalog values; deepseek-v4.1-flash states none', () => {
  const byId = Object.fromEntries(PROBED_MODEL_SPECS.map(model => [model.id, model]))
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
  const merged = mergeSpecFill(existing, PROBED_MODEL_SPECS)
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
  const seeded = PROBED_MODEL_SPECS.map(model => ({ ...model }))
  assert.equal(mergeSpecFill(seeded, PROBED_MODEL_SPECS), null)
  assert.equal(mergeSpecFill([], PROBED_MODEL_SPECS), null)
  assert.equal(mergeSpecFill(undefined, PROBED_MODEL_SPECS), null)
})

test('effectiveCatalog lifts a spec-less resolved config to the code floor', () => {
  // The super-injector's fiber rebuild can hand apply() a config resolved
  // before schema defaults settled: models present, specs absent.
  const stale = PROBED_MODEL_SPECS.map(({ id, name, input }) => ({ id, name, input: [...input] }))
  const catalog = effectiveCatalog({ models: stale })
  assert.equal(catalog.length, 12)
  assert.equal(catalog.find(m => m.id === 'cline-pass/kimi-k3').contextWindow, 1048576)
  // A configured value always beats the floor.
  const pinned = stale.map(m => m.id === 'cline-pass/kimi-k3' ? { ...m, contextWindow: 7 } : m)
  assert.equal(effectiveCatalog({ models: pinned }).find(m => m.id === 'cline-pass/kimi-k3').contextWindow, 7)
  // An explicitly empty configured list is respected as-is.
  assert.deepEqual(effectiveCatalog({}), [])
})

test('fetchedDiscoveryModels passes fetched rows through, corrected by the probe', () => {
  const rows = fetchedDiscoveryModels([
    { id: 'cline-pass/qwen3.7-max', name: 'Qwen claims vision', contextWindow: 999, inputModalities: ['text', 'image'] },
  ])
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0], {
    id: 'cline-pass/qwen3.7-max',
    name: 'Qwen claims vision', // a fetched name is kept
    contextWindow: 999, // a fetched capacity is kept: the probe only fills gaps
    maxTokens: 131072, // gap filled from the probed table
    inputModalities: ['text'], // probed modality REPLACES the registry's claim
  })
})

test('fetchedDiscoveryModels keeps only cline-pass ids, first occurrence wins', () => {
  const live = [
    { id: 'zai/glm-5.3', name: 'GLM-5.3' }, // usage-billing slug: never adopted
    { id: 'cline-pass/kimi-k2.6', name: 'first' },
    { id: 'cline-pass/kimi-k2.6', name: 'duplicate' }, // dropped
    { id: 'cline-pass/new-model', contextWindow: 100000 }, // unnamed: falls back to the id
  ]
  const rows = fetchedDiscoveryModels(live)
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0], { id: 'cline-pass/kimi-k2.6', name: 'first' })
  assert.deepEqual(rows[1], { id: 'cline-pass/new-model', name: 'cline-pass/new-model', contextWindow: 100000 })
})

test('fetchedDiscoveryModels answers empty when every source fetched nothing', () => {
  // No shipped fallback: an unreachable registry plus a failed endpoint probe
  // means an empty answer, not a stale catalog.
  assert.deepEqual(fetchedDiscoveryModels(), [])
  assert.deepEqual(fetchedDiscoveryModels([]), [])
  assert.deepEqual(fetchedDiscoveryModels(undefined), [])
  assert.deepEqual(fetchedDiscoveryModels([null, {}, { id: 42 }]), [])
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

test('registry plan rows carry the fetch; the probe only corrects known ids', () => {
  const registry = registryPlanModels({
    'cline-pass': {
      models: {
        'cline-pass/glm-5.3': { id: 'cline-pass/glm-5.3', name: 'registry claim' },
        'cline-pass/kimi-k2.6': {
          id: 'cline-pass/kimi-k2.6',
          name: 'Kimi K2.6',
          limit: { context: 262144, output: 262144 },
          modalities: { input: ['text', 'image', 'video'] },
        },
      },
    },
  })
  const rows = fetchedDiscoveryModels(registry)
  assert.equal(rows.length, 2)
  // A known id keeps the registry's name and gets the probed specs filled in.
  assert.deepEqual(rows[0], {
    id: 'cline-pass/glm-5.3',
    name: 'registry claim',
    contextWindow: 1000000,
    maxTokens: 131072,
    inputModalities: ['text', 'image'],
  })
  // An unknown id is the registry's word alone (modalities already narrowed).
  assert.deepEqual(rows[1], {
    id: 'cline-pass/kimi-k2.6',
    name: 'Kimi K2.6',
    contextWindow: 262144,
    maxTokens: 262144,
    inputModalities: ['text', 'image'],
  })
})

test('routeModelsFromDiscovery maps fetched rows into route model entries', () => {
  const models = routeModelsFromDiscovery([
    { id: 'cline-pass/kimi-k2.6', name: 'Kimi K2.6', contextWindow: 262144, maxTokens: 262144, inputModalities: ['text', 'image'] },
    { id: 'cline-pass/bare' }, // no specs: every optional field stays absent
    { id: 'cline-pass/audio', inputModalities: ['text'] },
  ])
  assert.deepEqual(models, [
    { id: 'cline-pass/kimi-k2.6', name: 'Kimi K2.6', contextWindow: 262144, maxTokens: 262144, input: ['text', 'image'] },
    { id: 'cline-pass/bare' },
    { id: 'cline-pass/audio', input: ['text'] },
  ])
  assert.deepEqual(routeModelsFromDiscovery(undefined), [])
})

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
  // Nothing configured yet: not a verdict on the key, so it never rethrows.
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
