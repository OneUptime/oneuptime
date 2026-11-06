/*
 * Syntax highlighting for CodeEditor.
 *
 * The grammars (CodeEditorGrammars: highlight.js core and the languages the
 * editor uses) are loaded the first time an editor with a grammar is drawn,
 * not before every page that draws a form can draw (issue #5619). Until they
 * arrive an editor shows its text plain - the same characters in the same
 * places, so nothing moves - and in colour once they are there.
 */
/*
 * Type-only, both: highlight.js ships its deep-path typings as ambient
 * `declare module` blocks inside its root types, which only enter the
 * program when something resolves the bare specifier.
 */
import type {} from "highlight.js";
import type HighlightJs from "highlight.js/lib/core";
import { LazyLibrary, useLazyLibrary } from "../../Utils/LazyLibrary";

// What highlightCode asks of highlight.js.
export type CodeHighlighter = Pick<
  typeof HighlightJs,
  "getLanguage" | "highlight"
>;

const codeHighlighter: LazyLibrary<CodeHighlighter> =
  new LazyLibrary<CodeHighlighter>(async (): Promise<CodeHighlighter> => {
    return (await import("./CodeEditorGrammars")).default;
  });

// The grammars, when an editor has loaded them already.
export function getLoadedCodeHighlighter(): CodeHighlighter | null {
  return codeHighlighter.getLoaded();
}

// Loads the grammars, once however many editors ask; a failed load is retried.
export function loadCodeHighlighter(): Promise<CodeHighlighter> {
  return codeHighlighter.load();
}

/*
 * The grammars for an editor whose language has one, once they are there:
 * null while they load, if they cannot, and for plain text, which loads
 * nothing.
 */
export function useCodeHighlighter(
  hasGrammar: boolean,
): CodeHighlighter | null {
  return useLazyLibrary(codeHighlighter, hasGrammar);
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
  highlighter?: CodeHighlighter | null | undefined,
) => string;

/**
 * HTML for `text`: highlight.js token spans when the grammar is known and the
 * text is not too long, escaped plain text otherwise - and while the
 * grammars have not loaded (highlighter: the loaded ones unless given).
 * Either way the result holds exactly the characters of `text`, in order -
 * the editor lays it under a transparent textarea, so one character more or
 * less would put every glyph after it in the wrong place.
 */
export const highlightCode: HighlightCodeFunction = (
  text: string,
  grammar: string | null,
  options?: { showTabs?: boolean | undefined } | undefined,
  highlighter: CodeHighlighter | null | undefined = getLoadedCodeHighlighter(),
): string => {
  let html: string | null = null;

  if (
    highlighter &&
    grammar &&
    text.length <= MAX_HIGHLIGHT_LENGTH &&
    highlighter.getLanguage(grammar)
  ) {
    try {
      // hljs escapes the source itself before wrapping tokens in spans.
      html = highlighter.highlight(text, {
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
