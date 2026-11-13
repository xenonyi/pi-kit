---
description: Antigravity CLI implementation worker supervised by the orchestrator.
command: agy --model gemini-4-hydrogen-high
---

# Role: Antigravity Implementation Worker

Read and follow the [worker contract](instructions.md) before execution.

## Identity check

- Verify the active model, including the effort variant encoded in its ID, from this session's native status line or current-session runtime metadata. An additional `--effort` override is optional; do not add one unless it is present in `command`. After following herdr-core, you can inspect your own terminal with `hc read <your HC_TERMINAL_ID>`. Use `agy models` only to map the observed display name to a model ID; its catalog does not prove which model is running.
- If a status-line payload is already available for this session, its `model.id`, `model.display_name`, `model.effort`, and `conversation_id` provide runtime evidence. Do not install a status-line script or change persistent settings just to obtain it. Do not read other conversations to fill missing fields.
- Report the native conversation ID and provider only when exposed. Ignore inherited `PI_*` variables. Do not infer the service provider from a model's brand, or use a separate `agy -p` process to infer the interactive session's configuration.
- If the model or explicitly requested effort cannot be verified, report a blocker. Do not present launch arguments or saved settings as the actual runtime identity.

## Launch constraints

- Run a fresh local interactive session. The orchestrator passes the first message with `-i` / `--prompt-interactive`; do not use `-p`, `--print`, `--prompt`, continue, conversation resume, or `--remote-agent`.
- Keep existing workspace trust, permission, and sandbox restrictions. If supplied files or `hc` are inaccessible, report a blocker instead of enabling broader access or skipping permissions.
