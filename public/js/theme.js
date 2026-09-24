// Theme preference: "system" follows the OS, "light" and "dark" pin it.
// The very first paint is handled by theme-init.js; this keeps it in sync.

const ORDER = ["system", "light", "dark"];
const media = matchMedia("(prefers-color-scheme: dark)");

export function getPreference() {
  try {
    const stored = localStorage.getItem("theme");
    return ORDER.includes(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(preference) {
  const dark = preference === "dark" || (preference === "system" && media.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export function nextPreference(current) {
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
  try {
    localStorage.setItem("theme", next);
  } catch {
    // Storage can be unavailable (private mode); the choice then lasts for this visit only.
  }
  return next;
}

/** Re-applies the theme when the OS setting changes while on "system". */
export function watchSystemTheme(getCurrent) {
  media.addEventListener("change", () => applyTheme(getCurrent()));
}
