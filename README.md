# autonomous-infra-agent

An autonomous SRE remediation agent that runs entirely on your machine — no
cloud API, no API key. It takes a microservice incident alert (a missing or
empty file crashing a service), determines the root cause, drafts a complete
implementation with a local [Ollama](https://ollama.com) model, and verifies
it in a resource-bounded Docker sandbox before you'd ever deploy it.

The design deliberately does **not** trust the LLM to decide what's safe to
change. A deterministic policy check (no model involved) runs first and
decides `is_safe_to_remediate` / `risk_level` purely from the target file
path. Only when that check passes does the agent call the local model to
draft the root cause analysis and file content — so a prompt-injected error
log or a hallucinated response can never talk its way into writing to
`/etc`, `C:\Windows`, or a path containing `..`.

## What you need to provide

1. **[Ollama](https://ollama.com/download) installed and running.**
   `ollama serve` (it also auto-starts after install on most platforms).
   Default endpoint: `http://localhost:11434`.
2. **A model pulled locally.** Code-capable models work best since the
   agent is drafting full source files:
   ```bash
   ollama pull qwen2.5-coder:7b   # default; ~4.7GB, good speed/quality balance on most laptops
   ```
   Alternatives: `qwen2.5-coder:14b` / `:32b` (better quality, more RAM/VRAM),
   `deepseek-coder-v2:16b`, or `llama3.1:8b` (more general-purpose, weaker at
   strict JSON-schema following). Set `OLLAMA_MODEL` in `.env` to whichever
   you pull.
3. **Docker Desktop / Docker Engine** — only if you want `--verify` to
   actually execute the drafted file's test commands in a sandboxed
   container. Not required for drafting remediation plans.
4. **Node.js 20+** to run this project itself.

Nothing else. No accounts, no billing, no outbound network calls beyond your
own `localhost:11434` and whatever base images Docker needs to pull for
`--verify`.

## Architecture

```
Incident alert (JSON)
        │
        ▼
 policyChecker.ts ──────► BLOCKED (CRITICAL/HIGH risk) ──► RemediationPlan (no file content, LLM never called)
        │ safe (LOW/MEDIUM)
        ▼
 OllamaLlmClient ──► root cause analysis + file content + sandbox test plan
  (local /api/chat, JSON-schema-constrained output, no network egress)
        │
        ▼
 RemediationEngine ──► assembled, schema-validated RemediationPlan
        │
        ▼ (optional --verify)
 DockerSandboxRunner ──► runs test_commands in an isolated, resource-limited container
```

- `src/core/policyChecker.ts` — deterministic risk classification.
- `src/core/remediationEngine.ts` — orchestrates policy check → LLM draft → plan assembly.
- `src/llm/` — `LlmClient` interface, `OllamaLlmClient` (talks to a local Ollama server's
  `/api/chat`, constraining output via a JSON schema `format`), prompts.
- `src/sandbox/` — Docker-based sandbox verification: writes the drafted file into a throwaway temp
  workspace, bind-mounts it read-only into a `--network none`, CPU/memory-limited container, and runs
  the model's test commands.
- `src/cli.ts` — `infra-agent analyze <incident.json>` CLI.
- `src/server.ts` — optional Express webhook server (`POST /incidents`) for wiring this into an
  alerting pipeline.

## Setup

```bash
npm install
cp .env.example .env   # defaults already point at a local Ollama; edit OLLAMA_MODEL if you pulled a different one
ollama pull qwen2.5-coder:7b
```

## CLI usage

```bash
# Draft a remediation plan (prints RemediationPlan JSON to stdout)
npm run cli -- analyze examples/telemetry-collector-incident.json

# Also run the drafted file through Docker sandbox verification (requires Docker running)
npm run cli -- analyze examples/telemetry-collector-incident.json --verify

# Write the remediation file to disk if (and only if) the policy check allows it
npm run cli -- analyze examples/telemetry-collector-incident.json --write

# Write the plan to a file instead of stdout
npm run cli -- analyze examples/telemetry-collector-incident.json --out plan.json
```

Exit code is `0` when `policy_check.is_safe_to_remediate` is `true`, `2` when the
incident was blocked, `1` on an unexpected error.

`examples/blocked-incident.json` demonstrates the policy gate: it targets
`/etc/nginx/nginx.conf`, so it's rejected before the LLM is ever called and
runs with **Ollama not even required to be running**.

## Server usage

```bash
npm run server
curl -X POST localhost:8787/incidents -H 'content-type: application/json' \
  -d @examples/telemetry-collector-incident.json
```

The server validates every request body against the incident schema, rate-limits
to 30 requests/minute/IP, and sets standard security headers via `helmet`. It has
no built-in authentication — put it behind your gateway/service mesh before
exposing it beyond localhost.

## Development

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # vitest
npm run build       # compiles to dist/
```

Tests cover the policy checker, schema validation, the remediation engine
(with a fake `LlmClient`), the Ollama client (with an injected mock `fetch` —
no real Ollama server needed), the sandbox workspace builder, the Docker
sandbox runner (with a fake `CommandRunner` — no real Docker calls), and the
webhook server's routes. Real Ollama/Docker calls are exercised only via the
CLI/server at runtime, not in the unit suite.

## Sandbox verification model

`--verify` requires a local `docker` CLI on `PATH`. The runner:

1. Writes `remediation.full_file_content` into a throwaway temp directory,
   mirroring `target_file_path` relative to a recognized app root (`/app/`,
   `/src/`, `/workspace/`).
2. Runs `docker run --rm --network none --pids-limit 128 --cpus <limit>
   --memory <limit> -v <workspace>:/workspace:ro -w /workspace <container_image>
   sh -c "<test_commands joined with &&>"`.
3. Kills the container if it exceeds `SANDBOX_TIMEOUT_SECONDS`.
4. Marks the run `passed` only if the exit code is `0`, it didn't time out, and
   the combined stdout/stderr matches `expected_output_pattern`.

Since the container runs with `--network none`, `container_image` should
already include any runtime/interpreter needed to execute the test commands
(e.g. `python:3.11-slim`, `node:20-slim`).

## Environment variables

See `.env.example`. Everything has a working local default — `OLLAMA_BASE_URL`
defaults to `http://localhost:11434`, `OLLAMA_MODEL` to `qwen2.5-coder:7b`. An
incident blocked by the policy check (e.g. a system path) runs end-to-end even
with Ollama not running at all, since the LLM is never called for it.

## Troubleshooting

- **"Failed to generate a valid remediation draft ... Confirm Ollama is
  running"** — start it with `ollama serve`, and confirm the model in
  `OLLAMA_MODEL` has been pulled (`ollama list`).
- **Truncated or invalid JSON from the model** — smaller/weaker models can
  struggle to fill a large JSON schema (especially `full_file_content` for a
  big file) within the default context window. Raise `OLLAMA_NUM_CTX`, or
  switch to a larger/more capable coding model.
- **`--verify` hangs or fails immediately** — make sure Docker is running and
  `container_image` (drafted by the model) is a real, pullable image.
