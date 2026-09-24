export const plural = (count, singular, pluralForm = `${singular}s`) => `${count} ${count === 1 ? singular : pluralForm}`;

/** "just now", "3 min ago", "2 h ago", or a date for anything older. */
export function timeAgo(iso, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString();
}

/** Human labels for verdicts, used everywhere a verdict is shown. */
export const VERDICT_LABEL = {
  VERIFIED: "Verified",
  FAILED_VERIFICATION: "Not verified",
  UNVERIFIED: "Unverified",
  BLOCKED: "Blocked",
};

export const VERDICT_ICON = {
  VERIFIED: "check",
  FAILED_VERIFICATION: "x",
  UNVERIFIED: "warning",
  BLOCKED: "ban",
};

/** A short label for a finished run: what happened, in the viewer's terms. */
export function outcomeHeadline(verdict, repairs) {
  switch (verdict) {
    case "VERIFIED":
      return repairs > 0 ? `Verified after ${plural(repairs, "repair")}` : "Verified on the first try";
    case "FAILED_VERIFICATION":
      return "No passing fix found";
    case "UNVERIFIED":
      return "Draft not verified";
    case "BLOCKED":
      return "Blocked by the policy gate";
    default:
      return "";
  }
}
