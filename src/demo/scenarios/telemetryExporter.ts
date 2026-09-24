import type { DemoScenario } from "../types.js";

/** Shared by both recorded attempts, so the only difference between the
 * failing draft and the repaired one is the code under test. */
const TEST_COMMAND =
  "python -c \"from collectors.metrics_exporter import PrometheusMetricsExporter as P; e = P(); " +
  "e.export_gauge('cpu_usage', 42.0, {'host': 'srv1'}); out = e.get_metrics(); q = chr(34); " +
  "assert 'cpu_usage{host=' + q + 'srv1' + q + '} 42.0' in out, 'unexpected exposition output: ' + out; " +
  "print('VERIFIED')\"";

const COMMON_HEAD = String.raw`import re
import threading
from typing import Dict, Mapping, Optional, Tuple

_METRIC_NAME = re.compile(r"^[a-zA-Z_:][a-zA-Z0-9_:]*$")
_LABEL_NAME = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")

LabelSet = Tuple[Tuple[str, str], ...]
`;

const COMMON_BODY = String.raw`

class PrometheusMetricsExporter:
    """Thread-safe in-memory gauge registry that renders Prometheus text."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._gauges: Dict[str, Dict[LabelSet, float]] = {}

    def export_gauge(self, name: str, value: float, labels: Optional[Mapping[str, str]] = None) -> None:
        if not _METRIC_NAME.match(name):
            raise ValueError(f"invalid metric name: {name!r}")
        label_set: LabelSet = tuple(sorted((labels or {}).items()))
        for label_name, _ in label_set:
            if not _LABEL_NAME.match(label_name):
                raise ValueError(f"invalid label name: {label_name!r}")
        with self._lock:
            self._gauges.setdefault(name, {})[label_set] = float(value)

    def get_metrics(self) -> str:
        lines = []
        with self._lock:
            for name in sorted(self._gauges):
                lines.append(f"# TYPE {name} gauge")
                for label_set, value in sorted(self._gauges[name].items()):
                    lines.append(f"{name}{self._format_labels(label_set)} {value}")
        return "\n".join(lines) + "\n" if lines else ""
`;

/** First attempt: renders label values bare (host=srv1). Prometheus requires
 * quoted, escaped values, so the sandbox assertion fails. */
const FLAWED_FORMATTER = String.raw`
    @staticmethod
    def _format_labels(label_set: LabelSet) -> str:
        if not label_set:
            return ""
        return "{" + ",".join(f"{key}={val}" for key, val in label_set) + "}"
`;

/** Repaired attempt: quoted values with the exposition-format escapes. */
const FIXED_FORMATTER = String.raw`
    @staticmethod
    def _format_labels(label_set: LabelSet) -> str:
        if not label_set:
            return ""
        rendered = ",".join(f'{key}="{_escape_label_value(val)}"' for key, val in label_set)
        return "{" + rendered + "}"
`;

const ESCAPE_HELPER = String.raw`

def _escape_label_value(value: str) -> str:
    """Escape a label value per the Prometheus text exposition format."""
    return value.replace("\\", "\\\\").replace("\n", "\\n").replace('"', '\\"')
`;

const ROOT_CAUSE = {
  error_type: "ModuleNotFoundError",
  failing_component: "/app/collectors/metrics_exporter.py",
  detailed_explanation:
    "main.py imports PrometheusMetricsExporter from collectors.metrics_exporter, but that file is missing from the " +
    "image, so the worker exits with status 1 before any telemetry is collected.",
};

export const telemetryExporterScenario: DemoScenario = {
  id: "telemetry-exporter",
  title: "Metrics exporter missing — worker crashes on boot",
  blurb: "The first draft has a subtle Prometheus formatting bug. Watch the sandbox catch it and the agent repair it.",
  tags: ["Python", "LOW risk", "self-repair"],
  expectedVerdict: "VERIFIED",
  incident: {
    incident_id: "INC-20260924-TEL-01",
    service_name: "telemetry-collector",
    timestamp: "2026-09-24T14:02:11Z",
    target_file_path: "/app/collectors/metrics_exporter.py",
    error_log: [
      "ModuleNotFoundError: No module named 'collectors.metrics_exporter'",
      '  File "/app/main.py", line 12, in <module>',
      "    from collectors.metrics_exporter import PrometheusMetricsExporter",
      "CRITICAL:worker: Failed to initialize metrics exporter. Exiting with status 1.",
    ].join("\n"),
    service_requirements_context:
      "Service requires a PrometheusMetricsExporter class with an export_gauge(name: str, value: float, labels: dict) " +
      "method and a get_metrics() method returning Prometheus text exposition format, e.g. " +
      'cpu_usage{host="srv1"} 42.0. It is called from multiple worker threads.',
  },
  recordedDrafts: [
    {
      root_cause_analysis: ROOT_CAUSE,
      module_summary: "Thread-safe gauge registry with Prometheus text rendering.",
      full_file_content: COMMON_HEAD + COMMON_BODY + FLAWED_FORMATTER,
      container_image: "python:3.11-slim",
      test_commands: [TEST_COMMAND],
      expected_output_pattern: "VERIFIED",
    },
    {
      root_cause_analysis: ROOT_CAUSE,
      module_summary: "Repaired: label values are now quoted and escaped as the Prometheus exposition format requires.",
      full_file_content: COMMON_HEAD + ESCAPE_HELPER + COMMON_BODY + FIXED_FORMATTER,
      container_image: "python:3.11-slim",
      test_commands: [TEST_COMMAND],
      expected_output_pattern: "VERIFIED",
    },
  ],
};
