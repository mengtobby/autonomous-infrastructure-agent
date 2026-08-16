# autonomous-infra-agent

An autonomous SRE remediation agent. It takes a microservice incident alert
(a missing or empty file crashing a service), determines the root cause,
drafts a complete implementation, and verifies it in a resource-bounded
Docker sandbox before you'd ever deploy it.

The design deliberately does **not** trust the LLM to decide what's safe to
change. A deterministic policy check (no model involved) runs first and
decides `is_safe_to_remediate` / `risk_level` purely from the target file
path. Only when that check passes does the agent call Claude to draft the
root cause analysis and file content — so a prompt-injected error log or a
hallucinated response can never talk its way into writing to `/etc`,
`C:\Windows`, or a path containing `..`.

## Architecture

```
Incident alert (JSON)
        │
        ▼
 policyChecker.ts ──────► BLOCKED (CRITICAL/HIGH risk) ──► RemediationPlan (no file content, LLM never called)
        │ safe (LOW/MEDIUM)
        ▼
 AnthropicLlmClient ──► root cause analysis + file content + sandbox test plan
        │
        ▼
 RemediationEngine ──► assembled, schema-validated RemediationPlan
        │
        ▼ (optional --verify)
 DockerSandboxRunner ──► runs test_commands in an isolated, resource-limited container
```

- `src/core/policyChecker.ts` — deterministic risk classification.
- `src/core/remediationEngine.ts` — orchestrates policy check → LLM draft → plan assembly.
- `src/llm/` — `LlmClient` interface, Anthropic implementation (tool-use forced JSON output), prompts.
- `src/sandbox/` — Docker-based sandbox verification: writes the drafted file into a throwaway temp
  workspace, bind-mounts it read-only into a `--network none`, CPU/memory-limited container, and runs
  the model's test commands.
- `src/cli.ts` — `infra-agent analyze <incident.json>` CLI.
- `src/server.ts` — optional Express webhook server (`POST /incidents`) for wiring this into an
  alerting pipeline.

## Setup

```bash
npm install
cp .env.example .env   # then set ANTHROPIC_API_KEY
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
runs with **no API key required**.

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
(with a fake `LlmClient`), the Anthropic client (with an injected mock SDK
client — no network calls), the sandbox workspace builder, the Docker
sandbox runner (with a fake `CommandRunner` — no real Docker calls), and the
webhook server's routes. Real Docker/Anthropic calls are exercised only via
the CLI/server at runtime, not in the unit suite.

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

See `.env.example`. `ANTHROPIC_API_KEY` is only required at the point a
remediation actually needs to be drafted — an incident blocked by the policy
check (e.g. a system path) runs end-to-end with no key configured.
