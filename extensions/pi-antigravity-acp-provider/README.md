# pi-antigravity-acp-provider

A [Pi](https://github.com/earendil-works/pi) provider for **Google Antigravity** through the native `agy` CLI (`agy acp`).

## Features

- Registers `antigravity-acp/*` models backed by the native Google Antigravity CLI (`agy`).
- Uses ACP protocol v1 and `@agentclientprotocol/sdk`.
- Collapses Antigravity's effort-qualified IDs into one entry per model; Pi's Shift+Tab reasoning control selects `low`/`medium`/`high`/`xhigh` dynamically.
- Supports Pi streaming, cancellation, usage/quota metadata, lifecycle cleanup, and persisted ACP session restoration across Pi restarts.
- Routes compatible Pi tools through an authenticated loopback MCP bridge; `doctor`/`status` names omitted tools and their reasons.
- Supports persisted `default`, `accept-edits`, `auto`, `plan`, and `yolo` permission modes. The default is `yolo` (`--dangerously-skip-permissions` + `auto`); prompting modes retain the single-use, fail-closed Pi permission broker.
- Advertises no ACP filesystem or terminal client capabilities.
- Provides setup, auth-health, logout/account-switching, qualification, and quota commands.

## New-user setup

In Pi:

1. Ensure the native `agy` CLI is installed (for example `~/.local/bin/agy`, on `PATH`, or pointed to by `AGY_ACP_BIN`).
2. Optionally run `/antigravity-acp setup` for a runtime/auth preflight.
3. Run `/login` -> **Sign in with an account** -> **Google Antigravity (ACP)**, or configure an API key / `GEMINI_API_KEY`.
4. Complete the Google login in the browser (or manual relay over SSH / headless Linux).
5. Run `/antigravity-acp setup` again to perform a network auth probe and model discovery.
6. Run `/model` and select one of the `antigravity-acp` models.
7. Press **Shift+Tab** to choose the reasoning effort. Only tiers advertised by Antigravity are exposed.
8. Send a prompt. The default permission mode is `yolo`, launching `agy acp --dangerously-skip-permissions`.

The provider resolves `AGY_ACP_BIN`, then `~/.local/bin/agy`, and then `agy` on `PATH`. If an external non-`agy` ACP binary path is set via `AGY_ACP_BIN`, it is launched directly without injecting `acp` or CLI-only flags.

Loopback MCP traffic is exempted from proxies in the ACP child environment. Explicit `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY` (and lowercase variants) are preserved. Set `PI_ANTIGRAVITY_ACP_PROXY` to an absolute HTTP/HTTPS proxy URL to override child proxy settings.

Standalone Pi builds also need Node.js to run the ACP supervisor (`src/acp/supervisor.mjs`). The provider looks for `node` or `nodejs` on `PATH`; set `NODE` to the executable path if neither is available. An explicit `SSL_CERT_FILE` is preserved; otherwise the provider uses `NIX_SSL_CERT_FILE` or a readable system CA bundle when available.

### SSH and headless Google login

When Pi is running over SSH, or on Linux without `DISPLAY`/`WAYLAND_DISPLAY`, `/login` automatically uses a manual browser relay:

1. Pi prints the Google authorization URL instead of trying to launch a browser on the server.
2. Open that URL in a browser on your local machine and finish Google sign-in.
3. Google redirects to an Antigravity loopback URL. Copy the **complete final URL** from the browser address bar.
4. Paste that URL into Pi. The provider validates its host, port, path, and OAuth state, then relays it to Antigravity's loopback listener on the server.

Set `PI_ANTIGRAVITY_ACP_OAUTH_MODE=manual` to force this flow, or `PI_ANTIGRAVITY_ACP_OAUTH_MODE=browser` to force normal browser launch.

For API-key authentication, choose **Enter an API key** and then **Antigravity Gemini API key** in `/login`, or set `GEMINI_API_KEY` before starting Pi.

`agy` stores OAuth credentials under `~/.gemini/antigravity-cli/` (`antigravity-oauth-token` and `settings.json`); Pi stores only a non-secret configured marker. An explicit `GEMINI_HOME` relocates the `antigravity-cli` directory, and `AntigravityProcess` passes `--gemini-dir` to `agy acp` when `GEMINI_HOME` is set.

### macOS credential storage

On macOS `agy` keeps the consumer token in the login keychain and falls back to `~/.gemini/antigravity-cli/antigravity-oauth-token` when keychain access is unavailable or `AGY_ACP_FORCE_FILE_STORAGE=1` is set. When a refreshable token file exists without a matching keychain entry, this provider sets `AGY_ACP_FORCE_FILE_STORAGE=1` in the child environment so saved logins are reused.

## Commands

```text
/antigravity-acp setup
/antigravity-acp doctor
/antigravity-acp doctor --verbose
/antigravity-acp status
/antigravity-acp quota
/antigravity-acp qualify
/antigravity-acp logout
/antigravity-acp account
/antigravity-acp permissions
/antigravity-acp permissions default
/antigravity-acp permissions accept-edits
/antigravity-acp permissions auto
/antigravity-acp permissions plan
/antigravity-acp permissions yolo
```

Permission settings are saved in `$PI_CODING_AGENT_DIR/antigravity-acp-provider/config.json` (where `PI_CODING_AGENT_DIR` defaults to `~/.pi/agent`). ACP session bindings are saved beside the config in `sessions.json`. Legacy `"auto_edit"` / `"auto-edit"` values in existing configs normalize to `"accept-edits"`.

`logout`/`account` sends the ACP `logout` RPC to active connections when supported, clears local `antigravity-cli` auth/token files (preserving user `settings.json`), and clears saved ACP sessions. Run Pi's `/logout` afterward to remove the Pi credential marker, then `/login` for the new account.

`quota` reads Antigravity quota groups via `agy -p "/usage"` (parsing the TSV quota table) when running against `agy`, and falls back to ACP `/usage` on non-`agy` test/custom binaries; snapshots are cached for `180s` (`DEFAULT_QUOTA_CACHE_MS`) and bypassed on explicit `/antigravity-acp quota`. Other Pi extensions can request the same snapshot:

```ts
pi.events.emit("antigravity-acp:quota:request", { reply: (result) => { /* ... */ } });
```

## Security boundary

This launches a full coding agent with the user's OS privileges. **The default `yolo` mode runs `agy acp --dangerously-skip-permissions` with session mode `auto`, permitting Antigravity-native commands and edits without confirmation.** Use `/antigravity-acp permissions default` (or `accept-edits` / `plan`) for confirmation prompts. Switching across the `yolo` ↔ non-`yolo` boundary invalidates active ACP processes so `--dangerously-skip-permissions` is never mismatched with the active policy. Disabling ACP filesystem/terminal callbacks is not a sandbox for Antigravity-native tools.

## Architecture highlights in `pi-kit`

1. **Protocol-layer error interception and transient retry (`src/acp/turn-recovery.ts`, `src/runtime.ts`)**: `TurnOutputBuffer` holds ambiguous leading prefixes that could match unstructured gateway/backend error banners (for example `502`, `The model is currently unreachable.`, `ACP Internal Error`, or quota exhaustion) until prose diverges or `end_turn` resolves. Retryable transient banners and transport errors are retried with exponential backoff (`500ms`, `1500ms`) before any irreversible output is committed.
2. **Long-session rollover**: Wedged ACP sessions, repeated transport failures, or clean turns exceeding `proactiveRolloverTurns` (default `30`) or `proactiveRolloverContextRatio` (`0.85`) automatically roll over via `session/new` (reusing the live child process when healthy, or replacing it otherwise) and rehydrate from Pi context.
3. **Synthetic progress fallback (`src/acp/events.ts`, `src/acp/turn-recovery.ts`)**: When native `agent_thought_chunk` updates are absent, `plan` and `tool_call*` updates are deduplicated and condensed into `[Plan k/n]` / `[Tool]` thinking lines.
4. **Standby pre-warming (`AntigravityRuntime.prewarm`, `index.ts`)**: `session_start` warms a standby ACP process matching the current `dangerSkipPermissions` flag off the critical path when local credentials exist, and closes it on `close()` / `logout()`.
5. **Single-invocation `/usage` and 180s cache**: `quota()` runs `agy -p "/usage"` (with fast-fail when unauthenticated) or ACP `/usage` fallback, cleans throwaway conversation files, and caches snapshots for `180s`.

## Verification

```sh
pnpm tsc
pnpm exec vitest run --root extensions/pi-antigravity-acp-provider
```

## License

MIT
