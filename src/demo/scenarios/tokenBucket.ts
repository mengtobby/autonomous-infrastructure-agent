import type { DemoScenario } from "../types.js";

const TOKEN_BUCKET_SOURCE = String.raw`import threading
import time
from typing import Callable


class TokenBucket:
    """Thread-safe token-bucket rate limiter.

    The bucket holds up to "capacity" tokens and refills continuously at
    refill_per_second. allow() spends tokens if enough are available and never
    blocks, so callers decide what to do with a rejected request.
    """

    def __init__(
        self,
        capacity: float,
        refill_per_second: float,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if capacity <= 0:
            raise ValueError("capacity must be positive")
        if refill_per_second <= 0:
            raise ValueError("refill_per_second must be positive")
        self._capacity = float(capacity)
        self._refill_per_second = float(refill_per_second)
        self._clock = clock
        self._tokens = float(capacity)
        self._updated_at = clock()
        self._lock = threading.Lock()

    def allow(self, cost: float = 1.0) -> bool:
        if cost <= 0:
            raise ValueError("cost must be positive")
        with self._lock:
            self._refill()
            if self._tokens >= cost:
                self._tokens -= cost
                return True
            return False

    def _refill(self) -> None:
        now = self._clock()
        elapsed = max(0.0, now - self._updated_at)
        self._tokens = min(self._capacity, self._tokens + elapsed * self._refill_per_second)
        self._updated_at = now
`;

const TEST_COMMAND =
  "python -c \"from ratelimit.token_bucket import TokenBucket; t = [0.0]; " +
  "b = TokenBucket(capacity=3, refill_per_second=1.0, clock=lambda: t[0]); " +
  "first = [b.allow() for _ in range(4)]; assert first == [True, True, True, False], first; " +
  "t[0] += 2.0; assert b.allow() and b.allow() and not b.allow(); print('VERIFIED')\"";

export const tokenBucketScenario: DemoScenario = {
  id: "token-bucket",
  title: "Rate limiter missing — API gateway won't start",
  blurb: "Time-dependent logic verified deterministically by injecting a fake clock — no sleeping, no flakiness.",
  tags: ["Python", "LOW risk", "first-try"],
  expectedVerdict: "VERIFIED",
  incident: {
    incident_id: "INC-20260924-GW-12",
    service_name: "api-gateway",
    timestamp: "2026-09-24T14:20:03Z",
    target_file_path: "/app/ratelimit/token_bucket.py",
    error_log: [
      "Traceback (most recent call last):",
      '  File "/app/gateway/app.py", line 8, in <module>',
      "    from ratelimit.token_bucket import TokenBucket",
      "ModuleNotFoundError: No module named 'ratelimit.token_bucket'",
      "gunicorn: worker failed to boot",
    ].join("\n"),
    service_requirements_context:
      "Provide a thread-safe TokenBucket(capacity, refill_per_second, clock=time.monotonic) with allow(cost=1.0) -> bool. " +
      "Tokens refill continuously up to capacity; allow() must never block. The clock is injectable for testing.",
  },
  recordedDrafts: [
    {
      root_cause_analysis: {
        error_type: "ModuleNotFoundError",
        failing_component: "/app/ratelimit/token_bucket.py",
        detailed_explanation:
          "The gateway imports TokenBucket at startup; the module is missing from the image so gunicorn workers cannot boot.",
      },
      module_summary: "Thread-safe token bucket with continuous refill and an injectable clock.",
      full_file_content: TOKEN_BUCKET_SOURCE,
      container_image: "python:3.11-slim",
      test_commands: [TEST_COMMAND],
      expected_output_pattern: "VERIFIED",
    },
  ],
};
