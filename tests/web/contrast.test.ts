import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Contrast is checked from the design tokens themselves, so a palette tweak
// that drops a pair below WCAG AA fails the build instead of shipping.

const css = readFileSync(new URL("../../public/css/tokens.css", import.meta.url), "utf8");

type Rgba = [number, number, number, number];

function themeTokens(theme: "light" | "dark"): Record<string, string> {
  const block = new RegExp(String.raw`:root\[data-theme="${theme}"\]\s*\{([\s\S]*?)\n\}`).exec(css)?.[1] ?? "";
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((match) => [match[1], (match[2] ?? "").trim()]));
}

function parse(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const digits = hex[1] ?? "";
    return [0, 2, 4].map((index) => Number.parseInt(digits.slice(index, index + 2), 16)).concat(1) as Rgba;
  }
  const rgb = /^rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)$/.exec(value);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), Number(rgb[4])];
  throw new Error(`Cannot parse colour: ${value}`);
}

/** Composites a possibly translucent colour over an opaque backdrop. */
function over(foreground: Rgba, backdrop: Rgba): Rgba {
  if (foreground[3] >= 1) return foreground;
  const mixed = [0, 1, 2].map((index) => (foreground[index] ?? 0) * foreground[3] + (backdrop[index] ?? 0) * (1 - foreground[3]));
  return [mixed[0] ?? 0, mixed[1] ?? 0, mixed[2] ?? 0, 1];
}

function luminance([red, green, blue]: Rgba): number {
  const channel = (value: number) => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

function contrast(a: Rgba, b: Rgba): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

/** [foreground token, background token, minimum ratio]. 4.5 is AA for text; 3 is AA for large text and UI. */
const PAIRS: Array<[string, string, number]> = [
  ["text", "bg", 4.5],
  ["text-2", "bg", 4.5],
  ["text-3", "bg", 4.5],
  ["text-2", "bg-subtle", 4.5],
  ["text-3", "bg-subtle", 4.5],
  ["text-3", "sunken", 4.5],
  ["text-3", "hover", 4.5],
  ["text-3", "selected", 4.5],
  ["text", "selected", 4.5],
  ["accent", "bg", 4.5],
  ["accent", "accent-soft", 4.5],
  ["primary-fg", "primary-bg", 4.5],
  ["success-strong", "success-soft", 4.5],
  ["danger-strong", "danger-soft", 4.5],
  ["warning-strong", "warning-soft", 4.5],
  ["success-strong", "bg", 4.5],
  ["danger-strong", "bg", 4.5],
  ["tok-keyword", "sunken", 4.5],
  ["tok-string", "sunken", 4.5],
  ["tok-comment", "sunken", 4.5],
  ["tok-number", "sunken", 4.5],
  ["tok-keyword", "add-bg", 4.5],
  ["tok-string", "add-bg", 4.5],
  ["tok-number", "add-bg", 4.5],
  ["tok-keyword", "del-bg", 4.5],
  ["tok-string", "del-bg", 4.5],
  ["tok-number", "del-bg", 4.5],
  ["tok-comment", "add-bg", 4.5],
  ["tok-comment", "del-bg", 4.5],
  ["text", "add-mark", 4.5],
  ["text", "del-mark", 4.5],
  ["success-strong", "add-bg", 4.5],
  ["danger-strong", "del-bg", 4.5],
  // Icons drawn on solid semantic fills, and semantic colours used as UI (not text) marks.
  ["bg", "success", 3],
  ["bg", "danger", 3],
  ["bg", "warning", 3],
  ["success", "bg", 3],
  ["danger", "bg", 3],
  ["warning", "bg", 3],
  ["border-strong", "bg", 1.4],
];

const TRANSLUCENT_ON_CODE = new Set(["add-bg", "del-bg", "add-mark", "del-mark"]);

describe.each(["light", "dark"] as const)("design tokens: %s theme", (theme) => {
  const tokens = themeTokens(theme);

  it("defines every token the audit relies on", () => {
    for (const [foreground, background] of PAIRS) {
      expect(tokens[foreground], `--${foreground}`).toBeDefined();
      expect(tokens[background], `--${background}`).toBeDefined();
    }
  });

  it.each(PAIRS)("--%s on --%s meets %s:1", (foregroundName, backgroundName, minimum) => {
    const page = parse(tokens.bg ?? "#ffffff");
    // Diff tints are translucent and sit on the code background, not the page.
    const canvas = over(parse(TRANSLUCENT_ON_CODE.has(backgroundName) ? (tokens.sunken ?? "#ffffff") : (tokens.bg ?? "#ffffff")), page);
    const background = over(parse(tokens[backgroundName] ?? "#ffffff"), canvas);
    const foreground = over(parse(tokens[foregroundName] ?? "#000000"), background);

    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(minimum);
  });
});
