// Loaded synchronously in <head> so the correct theme is on the document
// before first paint (no flash). Kept as a separate file because the page's
// Content-Security-Policy forbids inline scripts.
(function () {
  try {
    var preference = localStorage.getItem("theme") || "system";
    var dark = preference === "dark" || (preference === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  } catch (error) {
    document.documentElement.dataset.theme = "light";
  }
})();
