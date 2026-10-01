/*
 * Syntax highlighting for CodeEditor.
 *
 * highlight.js core plus only the grammars the editor's languages use. Every
 * frontend renders forms, and every form can hold a code field, so this sits
 * in every bundle: registering all of CodeBlock's languages here would put
 * C#, Rust and Swift grammars in the status page for nothing. Both modules
 * register onto the same core, and a grammar already registered is left
 * alone.
 */
/*
 * highlight.js ships its deep-path typings as ambient `declare module`
 * blocks inside its root types, which only enter the program when something
 * resolves the bare specifier. `import type` is erased at emit.
 */
import type {} from "highlight.js";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import sql from "highlight.js/lib/languages/sql";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

const GRAMMARS: Array<[string, typeof json]> = [
  ["bash", bash],
  ["css", css],
  ["javascript", javascript],
  ["json", json],
  ["markdown", markdown],
  ["sql", sql],
  ["xml", xml],
  ["yaml", yaml],
];

for (const [name, grammar] of GRAMMARS) {
  if (!hljs.getLanguage(name)) {
    hljs.registerLanguage(name, grammar);
  }
}

/*
 * Above this many characters the document is shown as plain text.
 * Highlighting runs on every keystroke and costs about half a millisecond
 * per KB, so this keeps a keystroke inside a frame; documents that large are
 * pasted exports, not code anyone types.
 */
export const MAX_HIGHLIGHT_LENGTH: number = 30000;

export type EscapeHtmlFunction = (text: string) => string;

export const escapeHtml: EscapeHtmlFunction = (text: string): string => {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
};

export type HighlightCodeFunction = (
  text: string,
  grammar: string | null,
  options?: { showTabs?: boolean | undefined } | undefined,
) => string;

/**
 * HTML for `text`: highlight.js token spans when the grammar is known and the
 * text is not too long, escaped plain text otherwise. Either way the result
 * holds exactly the characters of `text`, in order - the editor lays it
 * under a transparent textarea, so one character more or less would put
 * every glyph after it in the wrong place.
 */
export const highlightCode: HighlightCodeFunction = (
  text: string,
  grammar: string | null,
  options?: { showTabs?: boolean | undefined } | undefined,
): string => {
  let html: string | null = null;

  if (
    grammar &&
    text.length <= MAX_HIGHLIGHT_LENGTH &&
    hljs.getLanguage(grammar)
  ) {
    try {
      // hljs escapes the source itself before wrapping tokens in spans.
      html = hljs.highlight(text, {
        language: grammar,
        ignoreIllegals: true,
      }).value;
    } catch {
      html = null;
    }
  }

  if (html === null) {
    html = escapeHtml(text);
  }

  if (options?.showTabs && html.includes("\t")) {
    html = html.replace(/\t/g, '<span class="ou-code-editor__tab">\t</span>');
  }

  return html;
};
