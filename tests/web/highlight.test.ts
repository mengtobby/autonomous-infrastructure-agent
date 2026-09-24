import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain browser ES module with no type declarations
import { escapeHtml, highlight, languageFor, renderLine } from "../../public/js/highlight.js";

type Token = { cls: string; text: string };
const classesOf = (tokens: Token[]) => tokens.filter((token) => token.cls).map((token) => `${token.cls}:${token.text}`);

describe("languageFor", () => {
  it.each([
    ["/app/x.py", "py"],
    ["/app/x.js", "js"],
    ["/app/src/x.ts", "js"],
    ["deploy/docker-compose.yml", "yaml"],
    ["/app/README", "plain"],
    ["/app/x.unknown", "plain"],
  ])("maps %s to %s", (path, expected) => {
    expect(languageFor(path)).toBe(expected);
  });
});

describe("highlight", () => {
  it("colours python keywords, strings, comments and numbers", () => {
    const [line]: Token[][] = highlight('def f(): return "x"  # note 42', "py");
    expect(classesOf(line)).toEqual(["tok-keyword:def", "tok-keyword:return", 'tok-string:"x"', "tok-comment:# note 42"]);
  });

  it("does not colour an identifier that merely contains a keyword", () => {
    const [line]: Token[][] = highlight("definition = important_value", "py");
    expect(classesOf(line)).toEqual([]);
  });

  it("keeps a multi-line python docstring coloured on every line", () => {
    const lines: Token[][] = highlight('"""one\ntwo\nthree"""\nx = 1', "py");
    expect(lines).toHaveLength(4);
    expect(lines.slice(0, 3).every((line) => line.every((token) => token.cls === "tok-string"))).toBe(true);
  });

  it("colours javascript, including template literals and block comments", () => {
    const lines: Token[][] = highlight("const a = `t\nu`; /* c */ let b = 3;", "js");
    expect(classesOf(lines[0])).toContain("tok-keyword:const");
    expect(lines[1].some((token) => token.cls === "tok-string")).toBe(true);
    expect(classesOf(lines[1])).toContain("tok-comment:/* c */");
    expect(classesOf(lines[1])).toContain("tok-number:3");
  });

  it("leaves plain text uncoloured", () => {
    const lines: Token[][] = highlight("just words\nmore words", "plain");
    expect(lines).toHaveLength(2);
    expect(lines.flat().every((token) => token.cls === "")).toBe(true);
  });

  it("does not add a phantom empty line after a trailing newline", () => {
    expect(highlight("a = 1\n", "py")).toHaveLength(1);
  });

  it("preserves every character, so what is displayed is what was drafted", () => {
    const source = 'class A:\n    """doc"""\n    x = "y"  # z\n';
    const rebuilt = highlight(source, "py")
      .map((line: Token[]) => line.map((token) => token.text).join(""))
      .join("\n");
    expect(rebuilt).toBe(source.replace(/\n$/, ""));
  });

  it("handles an unterminated string without hanging or losing text", () => {
    const [line]: Token[][] = highlight('x = "never closed', "py");
    expect(line.map((token) => token.text).join("")).toBe('x = "never closed');
  });
});

describe("escaping (model output is untrusted)", () => {
  it("escapes markup characters", () => {
    expect(escapeHtml(`<img src=x onerror="alert('1')"> & more`)).toBe(
      "&lt;img src=x onerror=&quot;alert(&#39;1&#39;)&quot;&gt; &amp; more"
    );
  });

  it("never emits raw markup from drafted code", () => {
    const [line]: Token[][] = highlight('print("<script>alert(1)</script>")', "py");
    const html = renderLine(line);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("never emits raw markup inside a marked range either", () => {
    const [line]: Token[][] = highlight("<b>x</b>", "plain");
    const html = renderLine(line, [0, 8]);
    expect(html).toBe("<mark>&lt;b&gt;x&lt;/b&gt;</mark>");
  });
});

describe("renderLine", () => {
  it("wraps only the requested range in <mark>, across token boundaries", () => {
    const [line]: Token[][] = highlight('x = "abc"', "py");
    const html = renderLine(line, [5, 8]);
    expect(html).toContain("<mark>");
    // Tags stripped and entities decoded, the displayed text is unchanged.
    expect(html.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"')).toBe('x = "abc"');
    // Only the requested characters are marked.
    expect(/<mark>([^<]*)<\/mark>/.exec(html)?.[1]).toBe("abc");
  });

  it("renders without marks when no range is given", () => {
    const [line]: Token[][] = highlight("x = 1", "py");
    expect(renderLine(line)).not.toContain("<mark>");
  });
});
