# ACP SDK 2.2 migration

The provider upgrades the SDK from 1.8.0 to 2.2.0 without changing the wire protocol: it still negotiates **ACP v1**. SDK package version 2 does not imply ACP protocol v2.

## API and feature profile

- Replace the removed `ClientSideConnection` with `client().onRequest(...).onNotification(...).connect(stream)`.
- Use the returned connection's `agent.request(methods.agent.*, params)` for initialization, authentication, session creation/restoration, configuration, and prompts.
- Send `session/cancel` with `agent.notify()`, not a request. Retain the cancellation grace period, watchdogs, and process teardown fallback.
- Close the SDK lifecycle explicitly as well as the supervised process so outstanding RPCs are rejected immediately.
- Import apps, methods, and protocol types consistently from `@agentclientprotocol/sdk/unstable`. This full-v1 entrypoint includes the draft prompt `usage` and session lifecycle fields that the provider already uses. The default stable-only entrypoint is insufficient. No experimental v2 imports are used.
- Register only permission requests and session updates. Filesystem and terminal client capabilities remain disabled; opting into full-v1 schemas does not advertise additional capabilities.

## Compatibility retained

The bounded NDJSON transport, frame limits, malformed-output failure, credential redaction, prompt inactivity watchdogs, permission continuation, and authenticated Pi-tool MCP bridge remain in place.

Stable `session/set_config_option` selectors remain preferred. Older official Antigravity builds still supply legacy `models` metadata and accept `session/set_model`; explicit local session-state validation and the custom-method request fallback preserve this behavior without private SDK imports.

## Regression coverage

`test/sdk-migration.test.ts` exercises the production connection against a synthetic ACP subprocess:

- protocol-v1 negotiation and disabled filesystem/terminal client capabilities;
- draft prompt token usage, cache/reasoning counts, and quota metadata;
- default-denied permissions and replacement permission handlers;
- cancellation notification followed by reuse of the healthy connection;
- lifecycle close while a prompt is outstanding.

Existing connection, model-selection, runtime-safety, usage, context, bounded-stream, and MCP suites cover legacy and stable selectors, session resume/load, permission/tool continuations, and shutdown/error handling. Packaging checks verify that the selected public SDK entrypoint resolves from an isolated package installation.

These tests use fake agents and no Google credentials. Live authenticated prompts, real-account quota exhaustion, and platform-specific runtime qualification are separate opt-in checks; synthetic coverage is not a claim that those have been exercised.

## Upstream reference

[SDK v2.2.0 migration guide](https://github.com/agentclientprotocol/typescript-sdk/blob/v2.2.0/MIGRATION_STABLE_UNSTABLE.md)
