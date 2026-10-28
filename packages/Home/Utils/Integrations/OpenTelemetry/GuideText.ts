import { InlineText } from "./GuideTypes";

/*
 * A guide's inline text: plain words with three marks in them.
 *
 *   `code`            a name to type as it is: a package, a variable, a span
 *   **bold**          a label to find on screen: **Traces**, **Create Ingestion Key**
 *   [words](/address) a link, to a docs page, another guide or another site
 *
 * The page draws them as HTML (toHtml), its Markdown copy keeps them as they
 * are (Markdown reads the same marks), and its structured data and meta
 * description take the words alone (toPlainText). Everything else is text:
 * toHtml escapes it, so a "<" in a guide is a "<" on the page.
 *
 * Read with a scanner, character by character, in one pass: a mark that
 * never closes is kept as the characters it is, and inlineTextProblems
 * reports it so a guide cannot ship one.
 */

export interface InlinePart {
  kind: "text" | "code" | "bold" | "link";
  text: string;
  href?: string | undefined;
}

function escapeHtml(text: string): string {
  let escaped: string = "";

  for (const character of text) {
    switch (character) {
      case "&":
        escaped += "&amp;";
        break;
      case "<":
        escaped += "&lt;";
        break;
      case ">":
        escaped += "&gt;";
        break;
      case '"':
        escaped += "&quot;";
        break;
      case "'":
        escaped += "&#39;";
        break;
      default:
        escaped += character;
    }
  }

  return escaped;
}

// Where `mark` next appears at or after `from`, or -1.
function indexFrom(text: string, mark: string, from: number): number {
  return text.indexOf(mark, from);
}

/*
 * The text split into its parts. A mark with no end - a lone backtick, "**"
 * with no partner, "[" with no "](...)" - stays text.
 */
export function parseInlineText(text: InlineText): Array<InlinePart> {
  const parts: Array<InlinePart> = [];
  let plain: string = "";
  let index: number = 0;

  const flush: () => void = (): void => {
    if (plain) {
      parts.push({ kind: "text", text: plain });
      plain = "";
    }
  };

  while (index < text.length) {
    const character: string = text.charAt(index);

    if (character === "`") {
      const end: number = indexFrom(text, "`", index + 1);

      if (end > index + 1) {
        flush();
        parts.push({ kind: "code", text: text.slice(index + 1, end) });
        index = end + 1;
        continue;
      }
    }

    if (character === "*" && text.charAt(index + 1) === "*") {
      const end: number = indexFrom(text, "**", index + 2);

      if (end > index + 2) {
        flush();
        parts.push({ kind: "bold", text: text.slice(index + 2, end) });
        index = end + 2;
        continue;
      }
    }

    if (character === "[") {
      const close: number = indexFrom(text, "](", index + 1);
      const newline: number = indexFrom(text, "\n", index + 1);

      if (close > index + 1 && (newline === -1 || newline > close)) {
        const end: number = indexFrom(text, ")", close + 2);

        if (end > close + 2) {
          flush();
          parts.push({
            kind: "link",
            text: text.slice(index + 1, close),
            href: text.slice(close + 2, end),
          });
          index = end + 1;
          continue;
        }
      }
    }

    plain += character;
    index++;
  }

  flush();

  return parts;
}

function isExternal(href: string): boolean {
  return href.startsWith("https://") || href.startsWith("http://");
}

/*
 * Inline code. A name too long for its line breaks, and each line it spans
 * keeps a box of its own (box-decoration-clone) instead of a box left open
 * at one line's end and closed at the next one's start.
 */
const CODE_CLASS: string =
  "box-decoration-clone rounded-md bg-gray-100 px-1.5 py-0.5 font-mono text-[0.85em] text-gray-900 ring-1 ring-inset ring-gray-200 break-words";

/*
 * A short one - a command of two words such as `bun add`, a flag with its
 * value - is read as one thing, so it never breaks across lines: it moves
 * to the next line whole. At most this many characters fit any line of a
 * phone's column (about 200 pixels).
 */
export const UNBROKEN_CODE_LENGTH: number = 24;

const SHORT_CODE_CLASS: string = `${CODE_CLASS} whitespace-nowrap`;

function codeClassFor(code: string): string {
  return code.length <= UNBROKEN_CODE_LENGTH ? SHORT_CODE_CLASS : CODE_CLASS;
}

const LINK_CLASS: string =
  "font-medium text-indigo-600 underline decoration-indigo-200 underline-offset-2 hover:decoration-indigo-500";

// The text as HTML: escaped, with its marks drawn.
export function inlineTextToHtml(text: InlineText): string {
  return parseInlineText(text)
    .map((part: InlinePart): string => {
      switch (part.kind) {
        case "code":
          return `<code class="${codeClassFor(part.text)}">${escapeHtml(part.text)}</code>`;
        case "bold":
          return `<strong class="font-semibold text-gray-900">${escapeHtml(part.text)}</strong>`;
        case "link": {
          const href: string = part.href || "";
          const external: string = isExternal(href)
            ? ' target="_blank" rel="noopener"'
            : "";

          return `<a href="${escapeHtml(href)}"${external} class="${LINK_CLASS}">${inlineLinkTextToHtml(part.text)}</a>`;
        }
        default:
          return escapeHtml(part.text);
      }
    })
    .join("");
}

// A link's words may hold `code`: "[`register()`](/docs/...)".
function inlineLinkTextToHtml(text: string): string {
  return parseInlineText(text)
    .map((part: InlinePart): string => {
      if (part.kind === "code") {
        return `<code class="font-mono text-[0.85em]">${escapeHtml(part.text)}</code>`;
      }

      return escapeHtml(part.text);
    })
    .join("");
}

// The words alone, for a meta description or structured data.
export function inlineTextToPlainText(text: InlineText): string {
  return parseInlineText(text)
    .map((part: InlinePart): string => {
      if (part.kind === "link") {
        return inlineTextToPlainText(part.text);
      }

      return part.text;
    })
    .join("");
}

/*
 * What is wrong with a guide's inline text: a mark left open, a link to an
 * address the site does not write, an empty mark. Empty for good text.
 */
export function inlineTextProblems(text: InlineText): Array<string> {
  const problems: Array<string> = [];

  for (const part of parseInlineText(text)) {
    if (part.kind === "text") {
      if (part.text.includes("`")) {
        problems.push(`a backtick that never closes in "${text}"`);
      }

      if (part.text.includes("**")) {
        problems.push(`a bold mark that never closes in "${text}"`);
      }

      if (part.text.includes("](")) {
        problems.push(`a link that never closes in "${text}"`);
      }
    }

    if (part.kind === "link") {
      const href: string = part.href || "";

      if (!href.startsWith("/") && !href.startsWith("https://")) {
        problems.push(`a link to "${href}": write /path or https://`);
      }

      if (!part.text.trim()) {
        problems.push(`a link with no words in "${text}"`);
      }
    }
  }

  return problems;
}

// Every link a text holds.
export function inlineTextLinks(text: InlineText): Array<string> {
  return parseInlineText(text)
    .filter((part: InlinePart): boolean => {
      return part.kind === "link";
    })
    .map((part: InlinePart): string => {
      return part.href || "";
    });
}

export { escapeHtml };
