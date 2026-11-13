# Sources and research baseline

Research performed **2026-09-04**. Source links are primary where possible. Local installed paths are included to make the observations reproducible on the research machine; future implementers should re-read the version they target.

## Version baseline

| Component | Baseline inspected |
|---|---|
| Pi coding agent | `@earendil-works/pi-coding-agent` 0.85.0 |
| Gemini CLI npm stable | `@google/gemini-cli` 0.58.0; Node `>=20`; package-only npm unpacked size 97,987,180 bytes (not total transitive install) |
| Gemini CLI source | commit [`85aca163`](https://github.com/google-gemini/gemini-cli/commit/85aca163f6c73ac6ce380b5447359146b8adcae4) (main/nightly source observed as 0.60.0-nightly) |
| ACP SDK source/latest npm observed | 1.4.0; source commit [`5e2cfcab`](https://github.com/agentclientprotocol/typescript-sdk/commit/5e2cfcabb5303dc93c093da788b68460b9958526) |
| SDK required by Gemini CLI 0.58.0 | exact `@agentclientprotocol/sdk` 0.16.1 |
| Requested reference | `@estebanforge/pi-antigravity-bridge` 1.4.0 |
| Existing Gemini Pi package | `pi-gemini-acp` 0.13.2, source commit [`fe099004`](https://github.com/brandonkramer/pi-gemini-acp/commit/fe099004a13233a232d1abe2b41530a78101e861) |
| General ACP Pi package | `pi-acp-agents`, commit [`6b970f90`](https://github.com/buihongduc132/pi-acp-agents/commit/6b970f90856a73319d0cce10b318639a156733b5) |
| T3 Code Antigravity installer | [`AntigravityInstallation.ts`](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/provider/AntigravityInstallation.ts) and [`antigravityRelease.ts`](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/provider/antigravityRelease.ts), inspected 2026-09-06 |

Because the Gemini source checkout was ahead of npm stable, all behavior used for implementation must be reconfirmed against the exact npm artifact chosen in Milestone 0. Source-main observations explain direction but are not automatically claims about 0.58.0.

## Pi primary sources

- [Pi repository](https://github.com/earendil-works/pi)
- [Custom provider documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/custom-provider.md)
- [Extension documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)
- [Package/marketplace documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md)
- [Model/provider implementation types](https://github.com/earendil-works/pi/blob/main/packages/ai/src/models.ts)
- [Pi AI stream/message types](https://github.com/earendil-works/pi/blob/main/packages/ai/src/types.ts)

Local baseline:

```text
~/.nvm/versions/node/v24.19.0/lib/node_modules/
  @earendil-works/pi-coding-agent/docs/custom-provider.md
  @earendil-works/pi-coding-agent/docs/extensions.md
  @earendil-works/pi-coding-agent/docs/models.md
  @earendil-works/pi-coding-agent/docs/packages.md
  @earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/models.d.ts
  @earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/types.d.ts
  @earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/auth/types.d.ts
```

Key observations: complete Provider API; dynamic model refresh publication; `/login` auth interaction; `SimpleStreamOptions.sessionId`; strict assistant event lifecycle; `pi-package` gallery keyword and `pi.extensions`; Pi core packages as peers.

## ACP primary sources

- [Agent Client Protocol](https://agentclientprotocol.com/)
- [ACP protocol overview](https://agentclientprotocol.com/protocol/overview)
- [ACP v1 schema](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/schema/v1/schema.json)
- [Official TypeScript SDK](https://github.com/agentclientprotocol/typescript-sdk)
- [TypeScript SDK API](https://agentclientprotocol.github.io/typescript-sdk/)
- [SDK npm package](https://www.npmjs.com/package/@agentclientprotocol/sdk)
- [Additional workspace roots RFD](https://agentclientprotocol.com/rfds/additional-directories)

Key observations: JSON-RPC/NDJSON lifecycle, official client APIs, permission cancellation obligation, capability-negotiated fs, stable v1 versus experimental v2.

## Gemini CLI primary sources

- [Gemini CLI repository](https://github.com/google-gemini/gemini-cli)
- [ACP mode documentation](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/acp-mode.md)
- [CLI package manifest](https://github.com/google-gemini/gemini-cli/blob/main/packages/cli/package.json)
- [ACP RPC dispatcher](https://github.com/google-gemini/gemini-cli/blob/main/packages/cli/src/acp/acpRpcDispatcher.ts)
- [ACP session manager](https://github.com/google-gemini/gemini-cli/blob/main/packages/cli/src/acp/acpSessionManager.ts)
- [ACP session/update/tool implementation](https://github.com/google-gemini/gemini-cli/blob/main/packages/cli/src/acp/acpSession.ts)
- [ACP utilities: models, modes, permissions](https://github.com/google-gemini/gemini-cli/blob/main/packages/cli/src/acp/acpUtils.ts)
- [ACP filesystem service](https://github.com/google-gemini/gemini-cli/blob/main/packages/cli/src/acp/acpFileSystemService.ts)
- [Configuration reference](https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/configuration.md)
- [`@google/gemini-cli` npm](https://www.npmjs.com/package/@google/gemini-cli)

Key observations: `--acp`, npm main/bin entry, auth methods and API-key metadata, dynamic account-specific models, model setter, thought/tool updates, `_meta.quota`, internal tool loop, fs native fallback, and native keytar/PTY dependencies that require clean-platform installation tests.

For reproducible source references, replace `main` in links with the tested commit hash during implementation/release.

## Requested implementation reference

- [`@estebanforge/pi-antigravity-bridge` repository](https://github.com/EstebanForge/pi-antigravity-bridge)
- [npm package](https://www.npmjs.com/package/@estebanforge/pi-antigravity-bridge)

Installed baseline files:

```text
~/.pi/agent/npm/node_modules/@estebanforge/pi-antigravity-bridge/
  README.md
  package.json
  docs/ACP-ADOPTION-PLAN.md
  docs/ACP-PROTOCOL-REFERENCE.md
  docs/ARCHITECTURE.md
  docs/DEVELOPMENT.md
  docs/PI-BRIDGE-GAPS.md
  src/provider.ts
  src/acp/connection.ts
  src/acp/jsonrpc.ts
```

Key lessons: provider/driver abstraction, latest-turn extraction, context watermark, session bindings, balanced block streaming, no-patch Pi tool round trips, kill escalation, lifecycle cleanup, protocol probes, marketplace manifest. Security difference: its ACP path uses an automatic permission selection, which this design rejects.

## Adjacent implementations

### Existing `pi-gemini-acp`

- [Repository](https://github.com/brandonkramer/pi-gemini-acp)
- [npm](https://www.npmjs.com/package/pi-gemini-acp)
- [Pi gallery](https://pi.dev/packages/pi-gemini-acp)

Inspected files include `src/acp/{client,client-cache,jsonrpc-stdio,session}.ts`, `src/models/{provider,stream,preamble}.ts`, config/status/model code, package metadata, and tests. Key findings are documented in [REFERENCE-COMPARISON.md](REFERENCE-COMPARISON.md).

### `pi-acp-agents`

- [Repository](https://github.com/buihongduc132/pi-acp-agents)

Inspected Gemini adapter and generic ACP client. Useful for official SDK/process supervision; its product is ACP delegation rather than a Gemini-native Pi provider.

### Pi package template

- [Template repository](https://github.com/zenobi-us/pi-package-template) (local checkout used as a packaging reference; verify current canonical template before use)

## Upstream issue evidence

Issue reports motivate tests; they do not by themselves establish behavior in every version.

- [#24017 — ACP sequential prompts drop/merge responses and startup latency](https://github.com/google-gemini/gemini-cli/issues/24017)
- [#27913 — `session/load` resolves without restoring memory](https://github.com/google-gemini/gemini-cli/issues/27913)
- [#28693 — same-minute `session/load` failure/destructive resumability](https://github.com/google-gemini/gemini-cli/issues/28693)
- [#28775 — `session/load` erases the session it loads](https://github.com/google-gemini/gemini-cli/issues/28775)
- [#26448 — ACP filesystem structured ENOENT mismatch](https://github.com/google-gemini/gemini-cli/issues/26448)
- [#28361 — any `tools.core` value can exclude MCP tools](https://github.com/google-gemini/gemini-cli/issues/28361)
- [#22647 — non-protocol stdout corrupts ACP](https://github.com/google-gemini/gemini-cli/issues/22647)
- [#13913 — ACP subprocess hangs/no response](https://github.com/google-gemini/gemini-cli/issues/13913)
- [#7549 — cached credential behavior in ACP](https://github.com/google-gemini/gemini-cli/issues/7549)

Issue state and fixes must be rechecked on every bundled CLI upgrade.

## Registry observations

Commands run on 2026-09-04:

```text
npm view @google/gemini-cli version dist.unpackedSize engines --json
# version 0.58.0; unpackedSize 97987180; node >=20

npm view @agentclientprotocol/sdk version
# 1.4.0

npm view @google/gemini-cli@0.58.0 dependencies.@agentclientprotocol/sdk
# 0.16.1

npm view pi-gemini-acp version
# 0.13.2

npm view pi-gemini-acp-provider version
# E404 / not found
```

Npm availability and package metadata are mutable; re-run before implementation pinning and publication.

## Research limitations

- No production provider was implemented in this research repository.
- The existing package test command could not run in its shallow source checkout because dev dependencies were not installed; source/tests were inspected instead.
- Fresh Google OAuth was not executed as part of this documentation pass.
- Main-branch Gemini source was newer than npm stable.
- Web issue summaries may become stale; follow links and pinned release code.
- Platform behavior, especially Windows process trees and auth/browser handling, requires implementation-time tests.
