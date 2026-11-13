# Test and release plan

## 1. Test layers

| Layer | Target | External dependencies |
|---|---|---|
| Pure unit | parsers, event writer, context, usage, policy, redaction | none |
| Component | connection/driver against in-memory/fake streams | none |
| Subprocess contract | process supervisor against programmable fake agent | Node child only |
| Pi integration | provider loaded in Pi harness with fake ACP backend | Pi peer packages |
| Gemini contract | exact bundled CLI in isolated homes | CLI; credentials for authenticated subset |
| Packed smoke | tarball installed by Pi/npm into clean temp dirs | built package + Pi |
| Soak/chaos | repeated turns, aborts, crashes, idle eviction | fake and real CLI |

Tests must never rely solely on mocks for process lifecycle, framing, authentication, or sequential prompt correctness.

## 2. Pure unit matrix

### Pi event writer

- first text; first thought; alternating text/thought/text;
- empty delta and empty successful response;
- Unicode split at surrogate/multibyte boundaries;
- tool/permission closes current block;
- terminal `{type:"done", reason:"stop"|"length"|"toolUse"|"deferred"}` and `{type:"error", reason:"aborted"|"error"}` events;
- duplicate finalize and late update ignored/asserted;
- shared partial has final expected content;
- balanced start/end indices.

### ACP update parser

Fixtures for every known `SessionUpdate`: message, thought, tool call/update, plan, commands, mode/model state. Test missing fields, unknown additive fields, unknown update discriminator, huge content, malicious control text, wrong session id, and replay suppression scoping.

### Usage parser

- valid `_meta.quota` totals and multiple `model_usage` entries;
- absent metadata;
- zero values;
- negative/fractional/NaN-like/string/overflow values;
- output includes thinking but reasoning remains undefined;
- zero cost clearly retained;
- auto route with multiple response models.

### Context algorithm

- fresh context reconstruction;
- warm latest-turn only;
- provider's own output excluded from external delta;
- other provider included exactly once;
- ordinary Pi tool result included; internal permission result consumed;
- compaction summary precedence;
- branch/rewind/prefix mismatch;
- truncation keeps system/latest data and valid UTF-8;
- image-only and mixed content;
- no session id does not cross-contaminate.

### Permission broker

- option token maps only to exact offered id;
- allow once, reject, cancelled;
- duplicate/stale/forged/cross-session/cross-generation result;
- no allow option;
- timeout and abort;
- multiple sequential permissions;
- bounded/escaped title, path, command, explanation, diff;
- permanent choice labels/scopes.

### Filesystem policy (before capability enabled)

Traversal, sibling prefix (`/root2`), symlink/junction escape, nonexistent parent, file swap, FIFO/socket/device, NUL, case sensitivity, Windows drive/UNC/ADS, oversized reads/writes, atomic failure, structured ENOENT.

## 3. Fake subprocess scenarios

The fake agent must be a real child process speaking NDJSON, configurable by scenario. Cover:

- successful initialize/new/model/prompt;
- frames split across arbitrary chunks and many frames in one chunk;
- CRLF/blank lines;
- malformed JSON, oversized line, non-JSON stdout, stderr burst;
- no executable (`ENOENT`) and exit before initialize;
- response id mismatch/duplicate/unknown response;
- update before/after response;
- notification for wrong session;
- permission request while prompt active;
- prompt completes while cancellation races;
- cancel unsupported (`-32601`), ignored, delayed, or successful;
- child hangs, closes stdout, closes stdin, crashes with pending requests;
- abrupt parent death closes ACP pipes and leaves no detached agent or tool grandchild;
- late events from old generation after replacement;
- backpressure on stdin;
- `session/load` replay before response;
- model method absent/invalid id;
- usage shape mutations.

After every scenario assert no unsettled promises, live child, referenced timer, open server, or event listener growth.

## 4. Pi provider conformance

Adapt Pi's own provider tests listed in its custom-provider documentation:

- `stream.test.ts`;
- `tokens.test.ts` and `total-tokens.test.ts`;
- `abort.test.ts`;
- `empty.test.ts`;
- `context-overflow.test.ts`;
- `image-limits.test.ts`;
- `unicode-surrogate.test.ts`;
- `tool-call-without-result.test.ts`;
- `image-tool-result.test.ts` where applicable;
- `cross-provider-handoff.test.ts`.

Add extension-level tests that load the actual entry and verify:

- provider registered once and reload replaces/cleans old runtime;
- models appear in registry according to auth strategy;
- `/login` entry and credential resolution;
- model switch is recorded/restored by Pi and applied to ACP;
- permission tool is always excluded from Gemini MCP exposure; if Pi cannot hide it from other providers, unmatched/hallucinated calls are harmless errors and temporary activation behavior is race-tested;
- `session_shutdown` awaits cleanup;
- no process starts merely by loading the extension.

## 5. Real bundled Gemini CLI contract suite

### Always-run, no credentials

- package entry resolves and reports exact expected version;
- initialize within deadline;
- advertised capabilities/auth methods match compatible expectations;
- unauthenticated session produces classified auth error, not hang/crash;
- graceful close leaves no child;
- PATH excludes global Gemini.

### Protected credential tests

Run in isolated `GEMINI_CLI_HOME`/HOME where supported, never developer default state:

1. authenticate API key via ACP metadata;
2. new session and capture model catalog;
3. simple text prompt with exact sentinel;
4. thought-producing prompt (assert shape, not private thought content);
5. image prompt;
6. select model A and prompt; select B and prompt;
7. ten serialized prompts, each answer tied to a unique nonce—detect drop/merge; fake-driver assertions deterministically prove old transcript content is absent from warm prompt payloads (real usage growth alone is not a reliable replay oracle because the server-side conversation legitimately grows);
8. permission-gated read/edit/shell in a disposable workspace: allow and deny;
9. abort during output and during permission;
10. forced child crash then Pi-context reconstruction;
11. two sessions in same cwd and in distinct cwd; verify isolation;
12. quota metadata parse and nonzero totals when returned;
13. required Pi-tool MCP visibility and round-trip contract before 1.0, including one valid and one omitted incompatible TypeBox schema;
14. filesystem proxy ENOENT/new-file contract before enabling fs.

Never run destructive tests against the source repository or user's normal Gemini home.

### `session/load` quarantine suite

Until enabled, run only in disposable home/workspace:

- create, prompt with sentinel, wait/no-wait minute boundaries, close, load;
- ensure original session file/state remains resumable;
- prompt asks for sentinel and validates memory;
- capture replay ordering and suppress it;
- test same-process and new-process;
- mark CLI version safe/unsafe. Failure never blocks reconstruction-based provider release, but blocks load feature.

## 6. Concurrency and isolation

Test schedules, not just outcomes:

- two calls same binding: second waits;
- two bindings: allowed concurrency respects pool bound;
- permission in A does not block/capture B;
- abort A does not kill shared process B (if multiplexing is introduced); otherwise process-per-binding behavior is explicit;
- model switch A does not alter B;
- update routing by session id;
- idle eviction cannot race acquisition;
- shutdown during spawn, auth, refresh, prompt, permission, and MCP call;
- model refresh and user prompt coexist without sharing probe history;
- loopback MCP server is ready before `session/new`, whose descriptor is non-empty whenever compatible Pi tools are active;
- Gemini-native and `pi_` tool name collisions cannot be mistaken in routing or policy diagnostics.

Use deterministic barriers rather than sleeps in unit/component tests.

## 7. Performance and resource gates

Record, do not hide:

- npm tarball size, the CLI package's own unpacked size, and total installed transitive size;
- cold spawn→initialize, initialize→session, session→first token;
- warm first-token and total turn latency;
- RSS per idle/active process;
- ten-turn token growth (detect replay amplification);
- model refresh latency;
- abort-to-process-exit latency;
- idle eviction accuracy.

Initial gates should be regression-relative because network/model latency varies. Hard local gates: no extension-load spawn, bounded process count, abort cleanup under 5 seconds for a hung fake, and no monotonic listener/heap growth in 1,000 fake turns.

## 8. Platform matrix

| Dimension | Required before 1.0 |
|---|---|
| Node | 20 LTS, 22 LTS, 24 current |
| Pi | minimum declared version and latest stable |
| OS | Ubuntu, macOS, Windows |
| Shell/PATH | no shell; restricted PATH; spaces/non-ASCII install path |
| Auth | ambient Google, fresh Google where automatable/manual release check, API key |
| Network | proxy/custom CA documented/tested where CLI supports; offline failure |
| Filesystem | normal workspace, symlinks, read-only dirs, long paths, Windows paths |
| Native install | prebuilt-addon path plus clean Debian and Alpine/musl probe; document any toolchain/unsupported target |

The minimum Pi version should be the first release with the complete Provider/auth/refresh API used, not guessed. Detect unsupported Pi at load with an actionable message.

## 9. Package and marketplace checks

Automate:

```bash
npm ci
npm run typecheck
npm test
npm run lint
npm pack --dry-run
npm pack
# install tarball in isolated clean directory and invoke Pi smoke
```

Assert tarball:

- contains extension source/build output, README, license, necessary docs/assets;
- excludes tests, coverage, raw probes, temp homes, logs, `.env`, keys, editor files;
- package manifest has exact `pi-package`, valid `pi.extensions`, public access, repository/bugs, Node engine;
- Pi dependencies are peer dependencies `*` and not duplicated in tarball;
- Gemini CLI/ACP SDK are production dependencies and install automatically;
- extension imports resolve after npm and Pi installation;
- no provider-authored postinstall mutation/download/global binary; native transitive install behavior is audited and clean-image tested;
- `pi install npm:<package>`/local tarball, `pi list`, update, disable, and remove work.

Recheck npm name immediately before first publish.

## 10. Upgrade compatibility policy

Every Gemini CLI or ACP SDK upgrade gets a standalone PR with:

- old/new versions and changelogs;
- initialize/session/model/update/usage fixture diff;
- no-credential and protected real contract suite;
- sequential, permission, abort, model, fs/MCP quarantine tests;
- cold/warm performance comparison;
- installed/tarball size delta;
- security/license/audit review;
- updated support matrix and known issues.

Dependabot should not auto-merge these dependencies. Stable package releases use an exact CLI pin. Users cannot self-update the bundled CLI independently except through an explicit unsupported developer override.

## 11. Release stages

### `0.0.x` internal

Transport and provider spikes; no marketplace claim.

### `0.1.x` public beta

Bundled CLI, provider, auth, text/thought/image, safe permission, sessions/reconstruction, model switching, usage, diagnostics. README labels beta and pinned CLI caveats.

### `0.5.x` release candidate

Platform matrix largely green, config stable, migration tests, multiple-user feedback, no critical leaks/duplicates.

### `1.0.0`

All Requirements Definition of Done met. `session/load`, expanded MCP parity, fs proxy, and rich cards may remain deferred; the baseline Pi/marketplace-tool MCP round trip is required by R14.

## 12. Release checklist

- [ ] Version/source baseline updated in [SOURCES.md](SOURCES.md).
- [ ] All unit/component/subprocess/Pi tests green.
- [ ] Real bundled CLI contract green on supported version.
- [ ] Sequential and context-duplication sentinel green.
- [ ] Permission allow/deny/abort green; default deny verified.
- [ ] Process cleanup soak green.
- [ ] Auth secrets absent from logs/artifacts.
- [ ] `npm pack --dry-run` manually reviewed.
- [ ] Packed clean install works without global `gemini`.
- [ ] Marketplace metadata and preview valid.
- [ ] SBOM/licenses/audit reviewed.
- [ ] Known upstream issues/status reviewed.
- [ ] Documentation matches actual defaults and limitations.
- [ ] npm name/version/tag/provenance/access verified.
- [ ] Rollback version known.
