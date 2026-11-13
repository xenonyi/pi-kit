# Reference implementation comparison

## Summary matrix

| Capability | `pi-antigravity-bridge` 1.4.0 | `pi-gemini-acp` 0.13.2 | `pi-acp-agents` (`6b970f90`) | Proposed package |
|---|---|---|---|---|
| Normal Pi provider | Yes | Yes | No; agent delegation/orchestration | Yes, sole primary purpose |
| Bundles target agent | No | No | No | **Yes: official Gemini CLI** |
| Global command required | `agy`/ACP server | `gemini --acp` | configured agents | No by default |
| Dynamic ACP model discovery | Antigravity-specific discovery/config | Static provider models | Agent config, not Pi catalog | ACP session response + cached fallback |
| Actual session model method | Config option in ACP engine | No ACP set-model call found | General client dependent | Negotiated `unstable_setSessionModel` |
| Session binding | Pi session → upstream conversation | Warm prompt session keyed by cwd | Agent sessions | Pi session → ACP binding + watermark |
| Context strategy | latest prompt + optional delta digest | flattened transcript per provider call | delegation prompt | one-time reconstruction + external deltas |
| Text/thought lifecycle | Correct close-on-switch in provider | text-oriented; no block start/end in inspected path | callback updates | strict text/thinking state machine |
| Tool behavior | no-patch MCP/Pi round trip; ACP internal activity | Gemini runs tools; updates mostly collapsed | ACP tool updates | safe internal activity + Pi permission round trip + Pi-tool MCP bridge for 1.0 |
| Permission default | ACP engine selects allow automatically | policy heuristics/auto response | configurable handlers | deny-by-default user-visible choice |
| Cancel fallback | protocol probe then kill | notify cancel; close/cache behavior | circuit breaker | cancel deadline then process-tree teardown |
| Actual usage | Antigravity engine dependent | estimates text tokens | ACP dependent | `_meta.quota`, no estimates |
| Marketplace package | Yes | Yes | Yes, but different purpose | Required |

## 1. `@estebanforge/pi-antigravity-bridge`

This is the requested primary reference and the most relevant structural model.

### Adopt

#### Provider/driver boundary

Its `provider.ts` converts a generic turn driver into Pi events, while separate drivers own upstream transport and process details. Follow this split. The proposed `GeminiAcpDriver` should expose typed activities (`text`, `thought`, `tool`, `permission`, `usage`, terminal) and know nothing about Pi rendering.

#### Latest-turn extraction and session binding

The reference correctly recognizes that the upstream agent owns its history and does not replay Pi's complete transcript each turn. It keys bindings by Pi session id and tracks a context watermark for context unknown to the upstream conversation. Adapt this directly to ACP sessions.

#### Balanced stream blocks

The close-on-switch implementation ensures at most one text/thinking block is open, emits start events lazily and once, and closes before terminal events. This is the right Pi event model.

#### Lifecycle supervision

Useful patterns include:

- attach child `error` and `exit` listeners immediately;
- correlate JSON-RPC requests and reject all pending promises on death;
- separate stderr from stdout and retain a bounded tail;
- generation-scope callbacks so late exits cannot poison replacements;
- send protocol cancel, then kill a process group with escalation;
- close on session shutdown and idle timeout;
- expose diagnostic snapshots.

#### No-patch round trip

Its MCP-to-Pi bridge parks a remote tool request, emits a genuine Pi `toolCall`, lets Pi execute the tool, then resolves the parked upstream request when the resulting `toolResult` appears in the next provider invocation. The same technique solves Gemini ACP permission prompts without private Pi APIs. The same mechanism is required to bridge active Pi/marketplace tools to Gemini MCP before 1.0.

#### Honest gap documentation

The reference explicitly distinguishes what Pi's public API can render from what would require patches. Maintain that discipline rather than promising native widgets the provider cannot access.

### Adapt, do not copy

- Its ACP server uses `session/set_config_option`; Gemini CLI currently exposes `unstable_setSessionModel` and `session/set_mode`/SDK equivalents.
- Its ACP engine auto-selects the first allow option. That is unacceptable for a bundled general coding agent; use a user-mediated permission tool and deny headlessly.
- Its model/effort names and auth token store are Antigravity-specific.
- It carries two engines and substantial delegation/MCP display behavior. This package should have one official Gemini ACP engine.
- Antigravity currently lacks some usage fields; Gemini CLI exposes `_meta.quota`, so zeros are only fallback.

## 2. Existing `pi-gemini-acp`

This package proves there is user demand and contains robust general ACP process/cache tests, but it has different scope and setup assumptions.

### Valuable lessons/code patterns

- JSON-RPC stdio buffering and request cancellation.
- Capturing child process errors rather than allowing uncaught `ENOENT`.
- Warm process cache, idle expiry, queueing, and explicit close.
- Resource-link/image/file workflows and feature preflights.
- Unit tests for abort, session cache, permission policies, account isolation, and opt-in real-CLI smoke.
- Structured error classification and redacted diagnostics.

### Gaps relative to this project

The observations below refer to the inspected npm/source baseline, not intent or future versions.

1. **Special setup remains required.** Default config is `gemini --acp`, availability is checked externally, status tells users to install/authenticate the CLI, and package dependencies do not include `@google/gemini-cli`.
2. **Provider registration is conditional on preflight.** A missing command/auth marker can prevent Gemini models from being registered, reducing discoverability and making standard `/login` onboarding harder.
3. **Static model metadata.** The provider declares a fixed list rather than projecting the account-specific `availableModels` returned by ACP.
4. **Model selection is not an ACP session operation.** The inspected source probes whether command help exposes `--model`, persists a model, and puts the model id in a prompt preamble. No `unstable_setSessionModel`/session model call was found. Consequently Pi's selected model is not strongly tied to the live ACP session.
5. **History can duplicate.** `stream.ts` flattens recent Pi history and preamble into every request, while the warm cache reuses an ACP prompt session per cwd. The ACP session already remembers prior prompts, so old turns can be sent again.
6. **Cwd is used as prompt-session identity.** Distinct Pi conversations in one directory can share one ACP history unless isolated elsewhere in config/account cache.
7. **Text-only provider projection.** Current model metadata says `input: ["text"]` and `reasoning: false` despite Gemini ACP advertising image and thought support. Session updates collect agent message text and largely ignore thought/tool activity.
8. **Incomplete Pi block lifecycle.** The stream fixture expects `start`, `text_delta`, `done`, without `text_start`/`text_end`; current Pi documents balanced block events as the proper protocol.
9. **Estimated usage.** The final provider estimates tokens from character counts although current Gemini CLI returns turn totals under `_meta.quota`.
10. **Terminal semantics are flattened.** Success is hard-coded to Pi `stop` rather than mapping ACP stop reasons such as token/turn limits.
11. **Configuration breadth.** Search, research, citations, summarization, file/image analysis, account failover, and many commands make the package larger and harder to audit than a focused provider.

These are reasons for a new focused package rather than criticism of ancillary features that users may value. Reuse ideas, not source code, unless license and attribution are checked.

## 3. `pi-acp-agents`

This project is a strong general ACP client/delegation reference. It wraps the official SDK, manages subprocesses, filters startup noise, handles circuit breaking, and supports multiple agent adapters including Gemini.

### Adopt

- Immediate spawn error and early-exit handling.
- Official SDK connection patterns and protocol validation.
- Timeout/circuit-breaker tests.
- Unknown/noisy stdout diagnostics.
- Configurable session update callback and isolated client state.

### Do not adopt as product shape

Its Gemini adapter resolves `gemini` via PATH and exists to run ACP agents as delegated tools/orchestrated sessions. It does not make Gemini a Pi-native model provider with `/model`, provider auth, model refresh, or Pi transcript semantics. General multi-agent configuration is explicitly out of scope here.

## 4. Official Gemini CLI source

This is the wire-behavior authority for the pinned artifact. Prefer it over examples or stale protocol prose when behavior differs.

### Directly encode in contract tests

- initialize auth/capability response;
- API key in `authenticate._meta['api-key']`;
- cwd and `mcpServers` on session creation/load;
- account-specific available models/current model;
- `unstable_setSessionModel` behavior and invalid-model errors;
- message/thought/tool update shapes;
- permission option IDs and cancellation obligation;
- `_meta.quota` usage;
- stop-reason mapping;
- history replay during load;
- fs fallback behavior.

Do not import Gemini CLI internal modules. Launch the public package entry as a child and speak ACP. Internal imports would couple the provider to private build layout and shared global state.

## 5. License and clean implementation note

- Gemini CLI and the ACP SDK are Apache-2.0.
- `@estebanforge/pi-antigravity-bridge` is MIT.
- Confirm licenses of `pi-gemini-acp` and `pi-acp-agents` before copying any code.

The safest approach is independent implementation against public Pi/ACP types, with architectural attribution in documentation. If code is adapted verbatim, preserve required notices and record provenance per file.

## Recommended reference hierarchy

1. Pinned Gemini CLI artifact + its tests (actual agent behavior).
2. Pinned official ACP v1 SDK/schema (wire contract).
3. Installed Pi version's provider/types/docs (host contract).
4. `pi-antigravity-bridge` (state machine and integration patterns).
5. `pi-acp-agents` (generic SDK/process patterns).
6. Existing `pi-gemini-acp` (edge-case inventory and comparison).
7. Issue reports (regression candidates, not truth by themselves).
