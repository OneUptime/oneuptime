/*
 * Rendered docs HTML as the text a reader sees, for the docs tests: the one
 * place they take tags out. It imports nothing, so a suite in any package
 * can read a page with it (Common/Tests/App/Docs/DocsHtmlTextReadsLikeABrowser
 * holds it to a browser's reading of the docs pages, with jsdom).
 *
 * The translation suites used to copy `line.replace(/<[^>]*>/g, "")`, a
 * single pass that code scanning reports as incomplete multi-character
 * sanitization (js/incomplete-multi-character-sanitization): taking out one
 * match can leave pieces that join into a new tag, and an unclosed "<script"
 * matches nothing and stays. DocsTagStripGuard keeps that from coming back.
 */

// What may stand between an attribute's "=" and its quoted value.
const WHITESPACE_CHARACTER: RegExp = /\s/;

/*
 * Where the markup that opens with the "<" at `open` ends - just past its
 * closing "-->" or ">" - or -1 when it never ends. A tag ends at its first
 * ">" outside a quoted attribute value, so title="a > b" does not end it.
 */
function markupEnd(html: string, open: number): number {
  if (html.startsWith("<!--", open)) {
    // Searched from the second "-", so "<!-->" and "<!--->" end at once.
    const close: number = html.indexOf("-->", open + 2);

    return close === -1 ? -1 : close + 3;
  }

  let quote: string | null = null;
  let valueNext: boolean = false;

  for (let index: number = open + 1; index < html.length; index++) {
    const character: string = html.charAt(index);

    if (quote !== null) {
      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === ">") {
      return index + 1;
    }

    if (valueNext && (character === '"' || character === "'")) {
      quote = character;
      valueNext = false;
      continue;
    }

    if (character === "=") {
      valueNext = true;
    } else if (!WHITESPACE_CHARACTER.test(character)) {
      valueNext = false;
    }
  }

  return -1;
}

/*
 * The HTML with every tag and comment taken out and the text between them
 * kept exactly as it is. It walks the HTML once, never removing a pattern
 * and reading the result again:
 *
 *   - every "<" opens markup. The renderer writes a "<" that is text as
 *     "&lt;", and entities are left as they are.
 *   - a comment ends at the first "-->", a tag at the first ">" outside a
 *     quoted attribute value, and each is dropped whole, across lines too.
 *   - a "<" whose markup never ends is dropped on its own and the text after
 *     it stays, so a broken tag still shows what follows it.
 *
 * So the text it returns holds no "<" at all, whatever it is given.
 */
export function stripHtmlTags(html: string): string {
  // After the last ">", no markup can end: each "<" there goes on its own.
  const lastClose: number = html.lastIndexOf(">");
  let text: string = "";
  let index: number = 0;

  while (index < html.length) {
    const open: number = html.indexOf("<", index);

    if (open === -1) {
      return text + html.slice(index);
    }

    text += html.slice(index, open);

    const end: number = open < lastClose ? markupEnd(html, open) : -1;

    index = end === -1 ? open + 1 : end;
  }

  return text;
}
