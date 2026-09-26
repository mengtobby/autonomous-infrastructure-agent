# Autonomous Infra Agent

**An AI agent that fixes a crashing service, tests the fix by running it, and repairs it when the tests fail.**

When a service crashes because a file is missing, the agent reads the alert, drafts the file and its tests, **executes those tests in a sandbox**, and, if they fail, sends the *real* error output back to the model and tries again. Every run ends in an explicit verdict, and a deterministic safety gate that no alert text can talk its way past decides what the agent may touch at all.

![A verified run: the first draft failed in the sandbox, the agent repaired it, and the diff shows the exact edit](docs/images/dashboard-verified-light.png)

## Try it in 60 seconds

```bash
npm install
npm run demo
# open http://localhost:8787
```

No GPU, no Ollama, no Docker. The demo serves six built-in, synthetic incidents. Open the dashboard, pick the first one, and press **Run this incident**: the first draft fails a real test in a real sandbox, the agent reads the traceback, repairs the code, and the second draft passes.

> **What is real and what is replayed.** In demo mode the model's *drafts* are recorded, which is what lets it run without a GPU and makes it deterministic. Everything after drafting genuinely runs: the policy gate, the static checks, **actual execution of the drafted code** (Python and Node processes), and the repair loop. The dashboard says this on screen. With `LLM_PROVIDER=ollama` the drafts come from a live local model instead.

## How it works

```mermaid
flowchart LR
    A[Incident alert] --> B{Policy gate<br/>file path only}
    B -- unsafe --> X[BLOCKED<br/>no model call]
    B -- allowed --> C[Draft<br/>local LLM]
    C --> D[Static checks]
    D -- problems --> R
    D -- clean --> E[Sandbox<br/>run the draft's tests]
    E -- passed --> V[VERIFIED]
    E -- failed --> R[Repair<br/>send real failure output back]
    R --> C
    R -. budget spent .-> F[FAILED_VERIFICATION]
```

1. **Policy gate.** Risk is classified from the target file path *only*, by plain code with no model involved. System directories, path traversal and secret-looking paths are refused before anything is drafted, so a prompt-injected alert cannot change the outcome. One built-in scenario is exactly such an attack.
2. **Draft.** A local model (via Ollama) writes the missing file, its own test commands, and the output marker that proves success.
3. **Static checks.** Fast, free checks catch failure modes seen from real local models before spending a sandbox run: code wrapped in JSON, markdown fences, placeholders, commands that need a network, and success patterns like `.*` that would make verification meaningless.
4. **Sandbox.** The draft's tests are executed. It only passes if it exits 0 *and* prints the expected marker. The tests must import or run the drafted file (a test that never touches it is rejected before it runs), and once the tests are sound they are **frozen**: a repair may change the file, never the tests.
5. **Repair.** On failure, the model receives its own previous answer plus the actual stderr/stdout tail and returns a corrected draft, up to `MAX_REPAIR_ATTEMPTS` times.

### Verdicts

| Verdict | Meaning |
|---|---|
| `VERIFIED` | The draft passed the tests it wrote, executed in the sandbox. |
| `FAILED_VERIFICATION` | Every attempt failed. Nothing is accepted; failing safe is the correct outcome. |
| `UNVERIFIED` | No sandbox was available, so the draft was never run. It is never presented as working. |
| `BLOCKED` | The policy gate refused before any model was called. |

Every attempt (its code, static-check findings, and sandbox output) is kept on the plan, so a verdict is auditable.

## The dashboard

A live view of the pipeline. Stages light up as they happen (streamed over Server-Sent Events), the failed first attempt is shown as prominently as the success, and when the agent repairs itself the default view is the diff between the two drafts with the exact edit marked, next to the sandbox output that motivated it.

It is built to be opened alone from a link, so it narrates itself in plain language. What the model is (recorded vs live) and how isolated the sandbox is are always visible and each explains itself in a popover. Light and dark themes, keyboard operable, screen-reader friendly, reduced-motion aware, and usable on a phone.

| A blocked attack (dark theme) | On a phone |
|---|---|
| ![Blocked by the policy gate](docs/images/dashboard-blocked-dark.png) | ![Mobile layout](docs/images/dashboard-mobile.png) |

## Modes

**Where drafts come from** (`LLM_PROVIDER`)

| Value | What it does |
|---|---|
| `ollama` (default) | Drafts and repairs come from a model running on this machine. Nothing leaves it. |
| `replay` | Recorded drafts for the built-in scenarios. Refuses, rather than improvises, for anything else, including a built-in incident with any field changed. |

**Where drafts are proven** (`SANDBOX_MODE`)

| Value | Isolation |
|---|---|
| `docker` (default) | Container with networking disabled, CPU/memory/pid limits, a read-only mount, an image allowlist, and a timed-out container killed by name. |
| `local` | A child process with a scrubbed environment, a throwaway directory, a hard timeout that kills the whole process tree, and capped output. **Not isolated**: it runs with your privileges, so it refuses to start without `SANDBOX_LOCAL_ACKNOWLEDGE=true`. |
| `off` | Drafts are never executed; every run ends `UNVERIFIED`. |

## Using it as a tool

```bash
npm run build

# Run a built-in scenario, live progress on stderr, plan JSON on stdout
node dist/cli.js analyze --scenario telemetry-exporter --verify

# Or your own incident (needs a live model: LLM_PROVIDER=ollama)
node dist/cli.js analyze examples/telemetry-collector-incident.json --verify --repair-attempts 3

# Write the file to disk, but only if it is VERIFIED and inside the current directory
node dist/cli.js analyze incident.json --verify --write
```

Exit codes say what happened: `0` verified (or unverified because verification wasn't requested), `1` error, `2` blocked, `3` failed verification, `4` verification requested but could not run. `--write` never writes a blocked draft or one that failed its own tests, and never replaces an existing file unless you add `--force`.

### HTTP API

| Endpoint | |
|---|---|
| `POST /api/runs` | Start a run from `{ "scenario_id": "…" }` or `{ "incident": {…} }`. Returns `202` with an id. |
| `GET /api/runs/:id/events` | Server-Sent Events: replays everything so far, then streams live. Resumable with `Last-Event-ID`. |
| `GET /api/runs`, `/api/runs/:id`, `/api/stats` | History, one run, aggregate counts. |
| `GET /api/scenarios`, `/api/meta` | Built-in incidents; the provider and sandbox currently in use. |
| `POST /incidents` | Synchronous webhook: submit an alert, get the finished plan. |
| `GET /healthz` | Liveness. |

Request bodies are schema-validated, oversized or malformed bodies get a JSON error (never a stack trace), and the endpoints that start work are rate limited.

## Hosting the demo

To share a link, run the demo container. The container is the isolation boundary for the local sandbox, so lock it down:

```bash
docker build -t autonomous-infra-agent .
docker run --rm -p 8787:8787 \
  --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges \
  --memory 512m --pids-limit 256 \
  autonomous-infra-agent
```

Set `TRUST_PROXY=1` behind a reverse proxy so each visitor gets their own rate limit. The demo only executes the drafts we recorded ourselves, and an incident that is not one of the recorded scenarios exactly as recorded (any field altered) is refused in replay mode, so a visitor cannot make it run their code. Error text shown to visitors has URLs and host paths removed, and open event streams are capped.

> The Dockerfile is provided but **has not been built or run in the environment this was developed in** (Docker isn't installed there). Treat it as a starting point and check it on your platform.

## What has been verified, and what hasn't

- **Automated tests (400+)** cover the policy gate (including adversarial fixtures), the engine's repair loop and every branch of it, the sandbox runners against *real processes* (including that a timeout kills the whole process tree and that secrets never reach generated code), the HTTP API and SSE stream, and the dashboard's logic. `npm run check` runs typecheck, lint and all of them.
- **A real-browser end-to-end suite** drives the actual dashboard against a real server and sandbox, including a phone-width overflow check and a test that hostile model output (`<img onerror>`, `<script>`) renders as inert text. It was confirmed to fail when escaping is disabled.
- **A contrast audit** reads the design tokens and fails the build if any text pair falls below WCAG AA in either theme. It was confirmed to catch a deliberately weakened token.
- **Every built-in scenario runs end to end** through the real engine and real sandbox and is asserted to end in its expected verdict.

Honest limits:

- **VERIFIED is evidence, not a guarantee.** The model writes the tests as well as the code, so it is graded on its own exam. The safeguards are that the tests must actually exercise the drafted file, the success marker must be specific, and the tests are frozen across repairs; the dashboard says "review the code before you deploy it" beside every verified result. It does not replace human review.
- **Model quality is the variable.** Repair only helps if the model can act on the failure. See "Live model results" below for what a real local model did.
- **The Docker sandbox** is covered by unit tests with a fake command runner, but was **not exercised against a real Docker daemon** in development. The local sandbox is what ran for real.
- **State is in memory.** Run history is lost on restart, and there is no authentication. Put it behind your own gateway before exposing it beyond a demo.
- It handles one incident shape: a missing or empty file. It does not edit existing code.
- Scenarios are synthetic. There are no customers, benchmarks or success-rate numbers here, and none should be inferred.

## Configuration

Everything has a working default; see [`.env.example`](.env.example) for the full annotated list.

| Variable | Default | |
|---|---|---|
| `LLM_PROVIDER` | `ollama` | `ollama` or `replay` |
| `OLLAMA_MODEL` | `qwen2.5-coder:7b` | Pull with `ollama pull` first |
| `MAX_REPAIR_ATTEMPTS` | `2` | Repair rounds (0-5) |
| `SANDBOX_MODE` | `docker` | `docker`, `local` or `off` |
| `SANDBOX_LOCAL_ACKNOWLEDGE` | `false` | Required to use `local` |
| `HOST` | `127.0.0.1` | Interface to listen on (the Docker image sets `0.0.0.0`). A live model with `SANDBOX_MODE=local` refuses to start on a non-loopback host |
| `PORT` | `8787` | |
| `TRUST_PROXY` | `0` | Reverse-proxy hops |

## Development

```bash
npm run check         # typecheck + lint + every test (the gate)
REQUIRE_E2E=1 npm run check   # same, but a missing browser, Python or sh fails instead of skipping
npm run test:watch
npm run eval          # fast: policy, adversarial and malformed-input fixtures
npm run eval:generate # adds real drafting against your OLLAMA_MODEL (slow)
```

Layout: `src/core` (policy gate, engine, static checks) · `src/llm` (Ollama and replay providers, prompts) · `src/sandbox` (Docker and local runners) · `src/runs` and `src/routes` (background runs, SSE, API) · `src/demo` (scenarios) · `public` (the dashboard) · `tests`, `evals`.

The design and product context for the dashboard are recorded in [`PRODUCT.md`](PRODUCT.md).
