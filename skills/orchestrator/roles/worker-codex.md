---
description: Codex CLI implementation worker supervised by the orchestrator.
command: codex --no-daemon --model gpt-6.1-sol -c 'model_provider="openai"' -c 'model_reasoning_effort="medium"'
---

# Role: Codex Implementation Worker

Read and follow the [worker contract](instructions.md) before execution.

## Identity check

- Use runtime metadata tied to this Codex session to verify the active provider, model, and reasoning effort against `command`. Read only the identity fields needed from the current session's metadata or runtime records; user configuration files and process arguments alone do not prove the effective model.
- The current CLI's native status is another source of runtime evidence. If available, inspect your own terminal with `hc read <your HC_TERMINAL_ID>` after following herdr-core. Do not send `/status` through the shell or start a second Codex process to infer this session's identity.
- Report the native session ID when exposed. Ignore inherited `PI_*` variables; they do not describe a Codex session. If required identity fields are unavailable, report a blocker instead of echoing the requested configuration as actual.

## Launch constraints

- Run interactively with `--no-daemon`, keeping tool execution inside the supervised terminal. Do not use `codex exec`, a shared or remote app-server, resume, or fork.
- Keep existing sandbox and approval restrictions. A permission denial, including a denied `hc send`, is a blocker, not permission to disable containment.
