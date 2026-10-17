# dsh-plugin-clinepass

**Adds [ClinePass](https://docs.cline.bot/getting-started/clinepass) as a model provider to DeepSeek
Harness: once installed, one API key in Settings → Models is all it takes.**

ClinePass is Cline's low-cost subscription tier ($9.99/month, 2–5x usage on popular open coding
models). It speaks the regular Cline API (`https://api.cline.bot/api/v1`, OpenAI Chat Completions)
under `cline-pass/*` model slugs. DSH's provider catalog ships nothing under that name, so this
small bundle registers it as a first-class `llm-pi-ai` route.

## What you get

Everything runs through DSH's native paths:

- a **ClinePass** card on **Settings → Models** whose only primary field is the **API key**
  (the collapsed 自定义设置 area still edits endpoint, protocol, and the model list);
- the 12 ClinePass subscription models (`cline-pass/glm-5.3`, `cline-pass/kimi-k3`,
  `cline-pass/deepseek-v4-pro`, …) in the model picker;
- **fetch available models** on the card answers with the subscription catalog instead of the
  endpoint's usage-billing listing (see below).

> **Why isn't ClinePass in the "add provider" dropdown?** That select lists only *unconfigured*
> directory providers (an adoption entry). The plugin pre-seeds ClinePass as a configured provider
> card, so it is not in the dropdown and never needs to be picked from it — open Settings → Models
> and the card is already there, same as any hand-declared route.

## Install

```bash
# Option A: hot-assemble with the dev injector (no restart; also records the
# bundle in the profile's bundle list)
#   dev_install_package /root/dsh-plugin-clinepass --profile web

# Option B: manual
#   1) add this directory to the profile dependencies (link or file) and to
#      dsh.profile.bundles;
#   2) restart DSH.
```

On activation the plugin seeds the route into the `llm-pi-ai` settings user layer — the very write
the Models page itself performs, persisted in the profile's `cordis.patch.yml` — and then all that
remains is:

**Settings → Models → ClinePass → paste the API key (app.cline.bot → Settings → API Keys) → Apply**

## What it does / does not do

| Does | Does not |
| --- | --- |
| idempotently seed the `clinepass` route (endpoint, protocol, display name, credential ref, models) | touch dsh source or any other route |
| scope "fetch available models" to `cline-pass/*` slugs | own key storage (native credentials service does) |
| then hand everything to the native Models page / credentials / streaming adapter | overwrite configuration you already have |

Seeding is **idempotent and non-destructive**: once the route key resolves (hand-tuned on the
Models page or written into `cordis.patch.yml`), the plugin never writes it again. Set `seed: false`
in the plugin config to disable seeding entirely.

**Route-key collisions**: if `routeKey` already names a provider in the llm runtime's directory —
the installed catalog owns it, or another plugin registered it — seeding is refused with one warning
instead of shadowing that route's endpoint, protocol, and credential reference (which would also
collide in llm-pi-ai's directory commit). Pick a free key, or set `allowReservedRouteKey: true` to
take the key over deliberately. The warning is per seed run, not per activation: a plugin-config
edit re-runs the seed, so an unchanged bad key warns again — that is what surfaces a newly picked
reserved key. The guard is best-effort: if the directory cannot be read at all, the seed proceeds
with a note in the log rather than blocking, since an unreadable directory is no reason to leave the
route unseeded.

**Removal semantics**: the card is removable on the Models page (the route lives in the user layer
only). A removal takes effect and is respected for the rest of the session; the next activation
(restart or hot reload) finds the route missing and re-seeds it. To retire the card for good, set
`seed: false` instead of deleting it.

## Seeded model list

The 12 subscription models from the [ClinePass docs](https://docs.cline.bot/getting-started/clinepass).
`input` (text/image) is probed fact — one image and one text request per model against the live API
on 2026-09-29:

| Model | id | context | max output | image |
| --- | --- | --- | --- | --- |
| GLM-5.3 | `cline-pass/glm-5.3` | 1,000,000 | 131,072 | ✅ |
| GLM-5.3 Flash | `cline-pass/glm-5.3-flash` | 1,000,000 | 131,072 | ✅ |
| Kimi K3 | `cline-pass/kimi-k3` | 1,048,576 | 131,072 | ✅ |
| DeepSeek V4 Pro | `cline-pass/deepseek-v4-pro` | 1,000,000 | 384,000 | ✅ |
| DeepSeek V4.1 Flash | `cline-pass/deepseek-v4.1-flash` | — (conservative default) | — (conservative default) | ✅ |
| MiMo-V2.5 | `cline-pass/mimo-v2.5` | 1,048,576 | 131,072 | ✅ |
| MiMo-V2.5-Pro | `cline-pass/mimo-v2.5-pro` | 1,048,576 | 131,072 | ❌ rejects image input |
| MiniMax M3 | `cline-pass/minimax-m3` | 1,048,576 | 512,000 | ✅ |
| Muse Spark 1.3 Contributor | `cline-pass/muse-spark-1.3-contributor` | 1,048,576 | 131,072 | ⚠️ catalog consensus; region-locked, unprobed |
| Qwen3.8 Max | `cline-pass/qwen3.8-max` | 1,000,000 | 131,072 | ✅ |
| Qwen3.7 Max | `cline-pass/qwen3.7-max` | 1,000,000 | 131,072 | ❌ rejects image input |
| Qwen3.7 Plus | `cline-pass/qwen3.7-plus` | 1,000,000 | 65,536 | ✅ |

**Where the specs come from (why they cannot be fetched from ClinePass)**: Cline publishes no
per-model specs on any API-key-accessible endpoint — `GET /api/v1/models` carries only
`id/object/created/owned_by`, the model-detail endpoints require the app's account session, and
the docs table has no parameter columns. The context/output values above are **inherited from the
pi-ai builtin catalog** (2026-09-29; vendor-official entries preferred — moonshotai, deepseek,
xiaomi, minimax, qwen-token-plan — then the coding-plan aggregator opencode-go), while the image
column is **probed per model against the live ClinePass API** (more accurate than the catalog,
which declares GLM-5.3 and DeepSeek V4 Pro text-only although Cline's deployment serves images).
`deepseek-v4.1-flash` has no catalog entry anywhere, so it keeps llm-pi-ai's conservative defaults
(262144/32768): under-reporting only compacts earlier and can never overflow the context.

**Spec auto-fill**: on every activation the plugin fills only *absent* spec fields on the existing
route — values anyone set and models anyone added or removed are never touched. Upgrading the
plugin needs no action: the next activation fills whatever new specs the release ships.

## Why "fetch available models" is wrapped

Cline's `GET /api/v1/models` enumerates the **usage-billing catalog** (vendor slugs like
`zai/glm-5.3`, 464 entries, re-verified 2026-10-06 to contain no `cline-pass/*` ids). Subscription
models use the `cline-pass/*` alias namespace (verified: `cline-pass/glm-5.3` routes to
`zai/glm-5.3` underneath). Passing the listing through would let users adopt slugs that do not count
against the subscription, so the card's discovery answer is scoped to `cline-pass/*`: the shipped
list first, plus any `cline-pass/*` id the endpoint publishes later.

**The probe is still made even though it contributes no `cline-pass/*` id**: it is the route's live
credential check, and a chance to catch slugs published after a release.

**A rejected key is not masked**: a key that was *supplied* and rejected — a malformed/blank stored
value (`INVALID_CREDENTIAL`), or an endpoint that answered 401/403 (`DISCOVERY_FAILED` with the
harness's "; check the API key" hint) — now **surfaces the harness's own error** on the card instead
of being answered from the shipped catalog. The old fallback turned a wrong API key into what looked
like success. Two states still answer from the shipped catalog, by design: an **unconfigured** card
(`MISSING_CREDENTIAL` — the empty key field is already visible, and the shipped list is the
documented answer there) and an **unreachable or unparseable** endpoint (network failures, non-JSON
bodies, statuses other than 401/403).

**Where new models come from**: since that endpoint will never carry a `cline-pass/*` id, the
"shipped list plus endpoint" pair could never grow. The plugin therefore reads the **plan catalog
from the [models.dev](https://models.dev/providers/cline-pass/) `cline-pass` provider** — 18 models
as of 2026-10-06, covering all 12 shipped ones plus `mimo-v2.6-pro`, `mimo-v2.6-flash`, `kimi-k2.6`,
`kimi-k2.7-code`, `glm-5.2` and `deepseek-v4-flash`. It is fetched when you click "fetch available
models" (six-hour cache; a failure just falls back to the shipped list) and its new `cline-pass/*`
rows appear in the adoption list for you to confirm. That source is the subscription namespace only,
so it cannot widen the route past the plan, and the shipped rows keep priority — the per-model
probed image/context facts are never overwritten by a catalog claim.

## Configuration

Plugin configuration lives in the profile's `cordis.patch.yml` (entry id `clinepass`) and is
editable in the plugins settings page:

| Field | Default | Meaning |
| --- | --- | --- |
| `seed` | `true` | seed the route when absent; `false` disables |
| `routeKey` | `clinepass` | llm-pi-ai route key (the Models page card key) |
| `allowReservedRouteKey` | `false` | seed even when `routeKey` already names a provider in the llm runtime's directory (that write would shadow the catalog route's endpoint/protocol/credential ref, or collide with another plugin's route); a deliberate opt-in |
| `displayName` | `ClinePass` | name shown in selectors |
| `apiKeyEnv` | `CLINEPASS_API_KEY` | credential reference; set to `CLINE_API_KEY` to reuse an existing Cline credential with zero typing |
| `baseURL` | `https://api.cline.bot/api/v1` | Cline API endpoint |
| `api` | `openai-completions` | wire protocol |
| `models` | the 12 models above | seeded model catalog |

## Requirements

- `llm-pi-ai` (shipped with DSH) — the host namespace of the route. Without it the plugin logs one
  warning and writes nothing.
- the `settings` service.
- the shared `@deepseek-ai/schemastery` ≥3.18.5 (the harness's own copy) — `Config.meta.volatile`
  needs volatile support for live config edits; `peerDependencies` states the same floor.
- the llm runtime's provider directory (`listConfigurableProviders`, provided by dsh-llm) for the
  `routeKey` collision guard. Without an llm service the seed still runs, just unguarded.

## License

MIT
