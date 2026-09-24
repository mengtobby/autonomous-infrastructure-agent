// Small, dependency-free syntax highlighter for the languages the agent
// drafts most often. Output is always HTML-escaped: the code being shown is
// model output, so it must never be trusted as markup.

const KEYWORDS = {
  py: "def class import from return if elif else for while try except finally with as lambda pass raise in is not and or None True False yield assert global nonlocal del async await break continue",
  js: "const let var function return if else for while do switch case break continue new class extends import export from default async await try catch finally throw typeof instanceof in of this null undefined true false void static get set",
  yaml: "true false null yes no",
};

const LANGUAGE_BY_EXTENSION = {
  py: "py",
  js: "js",
  mjs: "js",
  cjs: "js",
  ts: "js",
  tsx: "js",
  jsx: "js",
  yml: "yaml",
  yaml: "yaml",
};

// Comment, string (triple-quoted and template literals may span lines), number, identifier.
const PATTERNS = {
  py: /(#[^\n]*)|("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)/g,
  js: /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)/g,
  yaml: /(#[^\n]*)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][\w-]*)/g,
};

export function languageFor(path) {
  const extension = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase() ?? "";
  return LANGUAGE_BY_EXTENSION[extension] ?? "plain";
}

/**
 * @param {string} text
 * @param {string} language  'py' | 'js' | 'yaml' | 'plain'
 * @returns {Array<Array<{cls: string, text: string}>>} one token list per line
 */
export function highlight(text, language) {
  const source = text.replace(/\r\n/g, "\n");
  const tokens = language === "plain" || !PATTERNS[language] ? [{ cls: "", text: source }] : tokenize(source, language);
  return toLines(tokens);
}

function tokenize(source, language) {
  const pattern = new RegExp(PATTERNS[language].source, "g");
  const keywords = new Set(KEYWORDS[language].split(" "));
  const tokens = [];
  let cursor = 0;

  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    if (match.index > cursor) {
      tokens.push({ cls: "", text: source.slice(cursor, match.index) });
    }
    const [text, comment, string, number, word] = match;
    const cls = comment ? "tok-comment" : string ? "tok-string" : number ? "tok-number" : word && keywords.has(word) ? "tok-keyword" : "";
    tokens.push({ cls, text });
    cursor = match.index + text.length;
  }
  if (cursor < source.length) {
    tokens.push({ cls: "", text: source.slice(cursor) });
  }
  return tokens;
}

/** Splits tokens at newlines so multi-line strings and comments keep their colour on every line. */
function toLines(tokens) {
  const lines = [[]];
  for (const token of tokens) {
    const parts = token.text.split("\n");
    parts.forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (part !== "") lines[lines.length - 1].push({ cls: token.cls, text: part });
    });
  }
  // A trailing newline terminates the last line rather than starting another.
  if (lines.length > 1 && lines[lines.length - 1].length === 0) lines.pop();
  return lines;
}

export function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

/**
 * Render one line's tokens as HTML, optionally wrapping the character range
 * [start, end) in <mark> to show what changed within a line.
 */
export function renderLine(tokens, range) {
  let offset = 0;
  const html = tokens.map((token) => {
    const start = offset;
    offset += token.text.length;
    const inner = range ? markRange(token.text, start, range) : escapeHtml(token.text);
    return token.cls ? `<span class="${token.cls}">${inner}</span>` : inner;
  });
  return html.join("");
}

function markRange(text, tokenStart, [from, to]) {
  const localFrom = Math.max(0, from - tokenStart);
  const localTo = Math.min(text.length, to - tokenStart);
  if (localFrom >= localTo) return escapeHtml(text);
  return `${escapeHtml(text.slice(0, localFrom))}<mark>${escapeHtml(text.slice(localFrom, localTo))}</mark>${escapeHtml(text.slice(localTo))}`;
}
