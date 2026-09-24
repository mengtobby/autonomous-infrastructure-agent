import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = new URL("../../public/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]
  );
}

describe("dashboard static assets", () => {
  const scripts = files(join(root, "js")).filter((file) => file.endsWith(".js"));

  it("finds the browser modules", () => {
    expect(scripts.length).toBeGreaterThan(10);
  });

  it.each(scripts.map((file) => [relative(root, file), file]))("%s parses", (_name, file) => {
    // Browser modules are not covered by tsc or eslint; a syntax slip would blank the whole page.
    const result = spawnSync(process.execPath, ["--check", file as string], { encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("never sets markup from a template string outside the audited escape paths", () => {
    // `html:` props and innerHTML are the only ways to inject markup. They may only
    // receive output that highlight.js escaped, or static SVG from icons.js.
    const offenders = scripts
      .filter((file) => !/[\\/](icons|highlight|dom)\.js$/.test(file))
      .filter((file) => /innerHTML|insertAdjacentHTML|document\.write/.test(readFileSync(file, "utf8")))
      .map((file) => relative(root, file));
    expect(offenders).toEqual([]);
  });

  it("references only files that exist", () => {
    const html = readFileSync(join(root, "index.html"), "utf8");
    const referenced = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((match) => match[1] as string);
    const existing = new Set(files(root).map((file) => "/" + relative(root, file).replace(/\\/g, "/")));
    expect(referenced.filter((path) => !existing.has(path))).toEqual([]);
  });
});
