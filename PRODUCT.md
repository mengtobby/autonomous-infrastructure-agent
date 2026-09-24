# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Plain static HTML, CSS and vanilla ES modules in `public/`, served by the project's existing Express server. No framework and no build step for the dashboard. Confirmed by the founder's brief ("dependency-free static page").

## Users

Primary (confirmed): investors evaluating the project, opening it **alone from a link** with no narrator. They are technically literate but are not necessarily SREs. They decide within minutes whether this is real. The page must therefore explain itself: what is happening, why it matters, and what to click first.

Secondary (inferred, not confirmed): the founder, who may also drive it live.

## Product Purpose

When a microservice crashes because a file is missing or empty, the agent reads the alert, drafts the missing file, **proves the draft by executing it in a sandbox**, and, when the proof fails, feeds the real failure back to the model and repairs it. It ends in an explicit verdict: VERIFIED, FAILED_VERIFICATION, UNVERIFIED or BLOCKED. Success means an operator can trust a fix because it was run, not because a model said it was right.

## Positioning

The claim a neighbouring product could not truthfully copy: **the agent fixes its own mistakes, grounded in real execution.** The repair prompt contains the actual stderr of the failed run, and a deterministic policy gate (the file path only, never the alert text) decides what may be touched at all, so a hostile alert cannot talk its way past it.

The one belief an investor should leave with (confirmed): *it fixes its own mistakes.*

## Operating Context

An incident alert arrives (service name, timestamp, target file path, error log, requirements). The pipeline runs: policy gate, draft, static checks, sandbox execution, repair loop, verdict. Runs take seconds to a minute. Outputs are a remediation plan, every attempt's code, and the sandbox's real output. Sandbox mode is Docker (isolated) or local process (explicitly not isolated). The model is a local Ollama model, or **replay** of recorded drafts for the built-in scenarios.

## Capabilities and Constraints

- Six built-in scenarios, all synthetic: four that pass (one requires a genuine self-repair), two that the policy gate blocks.
- Replay mode serves recorded model output. Only drafting is replayed; the policy gate, static checks, sandbox execution and repair loop all really run.
- The local sandbox is not isolated. The UI must say so wherever it appears.
- Custom incidents cannot be drafted in replay mode (no recording); a live Ollama model is required for that.
- Custom incident input, run history and stats exist; state is in memory only.
- Terminology: "verdict", "attempt", "repair", "policy gate", "static checks", "sandbox".

## Brand Commitments

The name is **Autonomous Infra Agent**, used as-is (confirmed). There is no logo; do not invent one. Voice is plain and precise, without hype.

Standing visual preference (confirmed by the founder): the **category standard played straight**, executed at full fidelity, with no irony and no smuggled quirks. The craft-level peers are **Linear and Vercel**: crisp, quiet, high-contrast developer tooling with tight type, generous space, subtle motion, and an excellent dark mode. This was chosen over a distinctive concept world (an investigation-docket direction was offered and declined).

## Evidence on Hand

- A test suite of 200+ passing tests, including end-to-end runs of every scenario through real Python and Node processes.
- Real captured sandbox output and real tracebacks from those runs.
- **Absent, and must not be fabricated:** customers, testimonials, benchmarks, success-rate percentages, pricing, production deployments, funding, team, or any claim about model quality beyond what a run shows. Numbers on the page must come from the visitor's own runs.

## Product Principles

1. **Show the work, not a claim.** Every statement is backed by a run the visitor can watch or inspect.
2. **Truth over polish.** Replay mode, the non-isolated local sandbox, and synthetic scenarios are labelled where a visitor could mistake them for something else.
3. **Failure is the feature.** The failed first attempt is displayed as prominently as the success; it is the proof the loop is real.
4. **Self-explanatory alone.** A first-time visitor with no narrator can reach the "aha" in under a minute.
5. **Safety is visible.** Blocked runs are a first-class outcome, not an error state.

## Accessibility & Inclusion

Keyboard operable, visible focus, sufficient contrast, status never conveyed by colour alone, and `prefers-reduced-motion` respected. Investors may view on a laptop or a phone.
