/*
 * HTML - or Markdown with HTML in it - read as text: every tag and comment
 * taken out (or replaced with text of the caller's choosing), the text
 * between them kept exactly as it is.
 *
 * Code scanning reported five places that took markup out of text with one
 * pass of /<[^>]*>/ (js/incomplete-multi-character-sanitization): an anchor
 * made from a docs heading (MarkdownSlugify), a docs tab's key
 * (MarkdownDocsExtensions), the docs search index (Docs/Utils/SearchIndex),
 * a Microsoft Teams message saved as a note (ReactionNoteSync), and the old
 * anchor rule of Scripts/Docs/FixAnchors. One pass leaves an unclosed tag
 * ("<script" with no ">" after it) exactly as it came in, ends a tag at a
 * ">" inside a quoted attribute value (title="a > b") and keeps the rest of
 * the value as text, and ends a comment at its first ">". Those places -
 * and MicrosoftTeamsUtil.stripHtmlTags, which reads Teams messages for AI
 * Ops, and OAuth2TokenClient's quote of a token endpoint's answer - read
 * text through this one walk now (the Dynamics 365 note template's script,
 * which runs where nothing can be imported, carries a copy of it):
 *
 *   - Every "<" opens markup. HTML a renderer or a chat client writes has a
 *     "<" that is text as "&lt;", and entities are left as they are.
 *   - A comment ends at the first "-->" after its "<!--" ("<!-->" and
 *     "<!--->" end at once, as in a browser); a tag, at the first ">" outside
 *     a quoted attribute value. Each is taken out whole, across lines too.
 *   - A "<" whose markup never ends is dropped on its own, and the text
 *     after it stays: a broken tag still shows what follows it.
 *
 * So the text removeHtmlMarkup returns holds no "<" at all, whatever it is
 * given: no tag is left, and none can form from the pieces either side of
 * one that was taken out. Taking markup out of that text again changes
 * nothing.
 *
 * Text that may be plain rather than HTML - an OAuth error's description,
 * a note an integration wrote - can hold a "<" that is text: "expires_in
 * must be < 3600". replaceHtmlMarkup's lessThanAsText (HtmlMarkupReading)
 * reads a "<" as a browser does: markup only before a letter, "/", "!" or
 * "?", text anywhere else, and kept. What it returns then holds no "<" that
 * starts markup.
 *
 * It reads a text in time that grows with its length alone. A tag's end is
 * looked for from its "<", which reads each tag once; but looking ahead from
 * every "<" that never closes would read the rest of the text again for each
 * of them - a run of "<" before an "=" and an unclosed quote took time that
 * grew with the square of its length. So once one tag is found never to
 * end, where every later tag ends is worked out once, from the end of the
 * text (findTagEnds), and looked up from then on.
 *
 * The docs tests read rendered pages the same way (stripHtmlTags in
 * App/Tests/FeatureSet/Docs/DocsHtmlText.ts).
 *
 * Imports nothing, on purpose: MarkdownSlugify imports it, and the docs
 * anchor scripts (Scripts/Docs) load MarkdownSlugify with nothing but the
 * repository's root npm install.
 */

// What may stand between an attribute's "=" and its quoted value, past ASCII.
const WHITESPACE_CHARACTER: RegExp = /\s/;

const GREATER_THAN: number = 0x3e;
const EQUALS_SIGN: number = 0x3d;
const DOUBLE_QUOTE: number = 0x22;
const SINGLE_QUOTE: number = 0x27;
const NO_QUOTE: number = -1;

const COMMENT_OPEN: string = "<!--";
const COMMENT_CLOSE: string = "-->";

export type IsWhitespaceFunction = (code: number) => boolean;

// Whether a character code is whitespace as \s reads it.
export const isWhitespace: IsWhitespaceFunction = (code: number): boolean => {
  if (code < 128) {
    // Tab, line feed, vertical tab, form feed, carriage return, space.
    return (code >= 0x09 && code <= 0x0d) || code === 0x20;
  }

  return WHITESPACE_CHARACTER.test(String.fromCharCode(code));
};

type ScanTagEndFunction = (html: string, body: number) => number;

/*
 * Where the tag whose body starts at `body` (the character after its "<")
 * ends: just past its first ">" outside a quoted attribute value, or -1 when
 * it never ends. A quote opens an attribute value only where a value can
 * start - after "=" and any whitespace - and the value runs to the next
 * quote of its kind, as a browser reads it; anywhere else a quote is text in
 * the tag.
 */
const scanTagEnd: ScanTagEndFunction = (html: string, body: number): number => {
  let quote: number = NO_QUOTE;
  let valueNext: boolean = false;

  for (let index: number = body; index < html.length; index++) {
    const code: number = html.charCodeAt(index);

    if (quote !== NO_QUOTE) {
      if (code === quote) {
        quote = NO_QUOTE;
      }

      continue;
    }

    if (code === GREATER_THAN) {
      return index + 1;
    }

    if (valueNext && (code === DOUBLE_QUOTE || code === SINGLE_QUOTE)) {
      quote = code;
      valueNext = false;
      continue;
    }

    if (code === EQUALS_SIGN) {
      valueNext = true;
    } else if (!isWhitespace(code)) {
      valueNext = false;
    }
  }

  return -1;
};

type FindTagEndsFunction = (html: string, from: number) => Int32Array;

/*
 * scanTagEnd for every body position from `from` to the end of the text at
 * once: entry 0 is position `from`. Worked out from the end of the text, so
 * each position is read once, however many tags never end.
 */
const findTagEnds: FindTagEndsFunction = (
  html: string,
  from: number,
): Int32Array => {
  const size: number = html.length - from;
  // The end, read from a position outside any attribute value.
  const tagEnds: Int32Array = new Int32Array(size + 1);
  // The end, read from a position after an "=", where a quote opens a value.
  const valueEnds: Int32Array = new Int32Array(size + 1);
  // The nearest quote of each kind after the position being read.
  let nextDoubleQuote: number = -1;
  let nextSingleQuote: number = -1;

  tagEnds[size] = -1;
  valueEnds[size] = -1;

  for (let entry: number = size - 1; entry >= 0; entry--) {
    const position: number = from + entry;
    const code: number = html.charCodeAt(position);
    const next: number = entry + 1;

    if (code === GREATER_THAN) {
      tagEnds[entry] = position + 1;
      valueEnds[entry] = position + 1;
    } else if (code === EQUALS_SIGN) {
      tagEnds[entry] = valueEnds[next]!;
      valueEnds[entry] = valueEnds[next]!;
    } else if (code === DOUBLE_QUOTE || code === SINGLE_QUOTE) {
      const close: number =
        code === DOUBLE_QUOTE ? nextDoubleQuote : nextSingleQuote;

      tagEnds[entry] = tagEnds[next]!;
      // The value runs to the next quote of its kind; the tag goes on after.
      valueEnds[entry] = close === -1 ? -1 : tagEnds[close - from + 1]!;
    } else if (isWhitespace(code)) {
      tagEnds[entry] = tagEnds[next]!;
      valueEnds[entry] = valueEnds[next]!;
    } else {
      tagEnds[entry] = tagEnds[next]!;
      // Anything else after an "=" is an unquoted value, which no quote opens.
      valueEnds[entry] = tagEnds[next]!;
    }

    if (code === DOUBLE_QUOTE) {
      nextDoubleQuote = position;
    } else if (code === SINGLE_QUOTE) {
      nextSingleQuote = position;
    }
  }

  return tagEnds;
};

/*
 * What a tag or comment becomes: given the markup as it is written - "<br/>",
 * '<li class="x">', "</p>", "<!-- note -->" - the text to put in its place.
 */
export type HtmlMarkupReplacer = (markup: string) => string;

/*
 * How markup is read.
 *
 * By default every "<" opens markup, which suits HTML a renderer or a chat
 * client writes: a "<" that is text is "&lt;" there.
 *
 * lessThanAsText reads a "<" as a browser reads one, for text that may be
 * plain rather than HTML - an OAuth error's description, a note written
 * through an API: it starts markup only before an ASCII letter, "/", "!" or
 * "?". Anywhere else - "x < y", "<= 5", "<3", a "<" at the end - it is
 * text, and stays. A run of "<" goes with the character after its last one:
 * before markup, the markup starts at the run's last "<" ("<<!-- c -->" is a
 * comment) and the "<" before it go on their own, so a "<" that stays is
 * never left next to what could start a tag once markup after it is taken
 * out. What the walk returns then holds no "<" that starts markup.
 *
 * rawTextElements reads by name the elements whose content a browser never
 * reads as markup. Script, style, iframe, noembed and noframes - what they
 * hold is never shown - are markup whole: from the start tag to the ">" of
 * the first end tag of the same name after it ("</script>", "</script >",
 * "</style foo>"), and `replace` is given the whole element. Title,
 * textarea and xmp hold text: what is between the start tag and the end
 * tag is read on its own, with no element in it, so nothing there - a
 * "<script", a comment - runs past the end tag. Names are read as a
 * browser reads them (a name ends at ASCII whitespace, a "/" or the ">"),
 * and found by the walk, so a "<script" in a comment or a quoted value
 * starts nothing. A start tag that no end tag follows is an ordinary tag,
 * and what follows it is read as usual. Not read: the escaped-comment
 * states a script's content can enter ("<!--<script>"), a quoted value in
 * an end tag, and SVG or MathML, where a title holds markup; each can only
 * leave text behind, never markup.
 */
export interface HtmlMarkupReading {
  lessThanAsText?: boolean | undefined;
  rawTextElements?: boolean | undefined;
}

const LESS_THAN: number = 0x3c;
const SLASH: number = 0x2f;

type StartsMarkupFunction = (code: number) => boolean;

/*
 * Whether a "<" before this character starts a tag, an end tag, a comment,
 * a declaration or a processing instruction, as a browser reads it.
 */
const startsMarkup: StartsMarkupFunction = (code: number): boolean => {
  return (
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    code === SLASH ||
    code === 0x21 ||
    code === 0x3f
  );
};

/*
 * Where a tag's name ends, as a browser's tokenizer reads one: at ASCII
 * whitespace (tab, line feed, form feed, carriage return, space), a "/" or
 * the ">". The one definition both start and end tags are read with.
 */
const TAG_NAME_END: RegExp = /[\t\n\f\r />]/;

type EndsTagNameFunction = (code: number) => boolean;

const endsTagName: EndsTagNameFunction = (code: number): boolean => {
  return TAG_NAME_END.test(String.fromCharCode(code));
};

type EndTagOfFunction = (name: string) => RegExp;

// Where an end tag of the named element starts: "</", the name, its end.
const endTagOf: EndTagOfFunction = (name: string): RegExp => {
  return new RegExp(`</${name}(?=${TAG_NAME_END.source})`, "gi");
};

/*
 * The elements rawTextElements reads by name (see HtmlMarkupReading): what
 * a hidden one holds is never shown, and a text one holds text.
 */
interface NamedElement {
  name: string;
  hidden: boolean;
  endTag: RegExp;
}

const NAMED_ELEMENTS: ReadonlyArray<NamedElement> = [
  ...["script", "style", "iframe", "noembed", "noframes"].map(
    (name: string): NamedElement => {
      return { name: name, hidden: true, endTag: endTagOf(name) };
    },
  ),
  ...["title", "textarea", "xmp"].map((name: string): NamedElement => {
    return { name: name, hidden: false, endTag: endTagOf(name) };
  }),
];

type NamedElementOfFunction = (html: string, open: number) => number;

/*
 * Which of NAMED_ELEMENTS the start tag at `open` starts - its index - or
 * -1: its name, in any letter case, then the end of a name. Compared a
 * character at a time, so an ordinary tag costs nothing to rule out.
 */
const namedElementOf: NamedElementOfFunction = (
  html: string,
  open: number,
): number => {
  for (let element: number = 0; element < NAMED_ELEMENTS.length; element++) {
    const name: string = NAMED_ELEMENTS[element]!.name;
    let at: number = 0;

    // A letter matches its lower case or its upper case, and nothing else.
    while (
      at < name.length &&
      (html.charCodeAt(open + 1 + at) | 0x20) === name.charCodeAt(at)
    ) {
      at++;
    }

    if (at === name.length && endsTagName(html.charCodeAt(open + 1 + at))) {
      return element;
    }
  }

  return -1;
};

export type ReplaceHtmlMarkupFunction = (
  html: string,
  replace: HtmlMarkupReplacer,
  reading?: HtmlMarkupReading | undefined,
) => string;

/**
 * The text of `html` with every tag and comment replaced by what `replace`
 * returns for it, read as the top of this file says: a tag ends at the
 * first ">" outside a quoted value, a comment at its "-->", and a "<" whose
 * markup never ends is dropped on its own (`replace` is not asked about it).
 * The text between them is kept exactly as it is, entities included.
 * `reading` can read a "<" as a browser does, and script and style
 * elements whole (see HtmlMarkupReading).
 *
 * What `replace` returns is put in place as it is: when it holds no "<",
 * neither does the result - or, read with lessThanAsText, no "<" that
 * starts markup.
 */
export const replaceHtmlMarkup: ReplaceHtmlMarkupFunction = (
  html: string,
  replace: HtmlMarkupReplacer,
  reading?: HtmlMarkupReading | undefined,
): string => {
  const lessThanAsText: boolean = Boolean(reading?.lessThanAsText);
  const rawTextElements: boolean = Boolean(reading?.rawTextElements);
  const firstOpen: number = html.indexOf("<");

  if (firstOpen === -1) {
    return html;
  }

  // No markup that starts after the last ">" can end.
  const lastGreaterThan: number = html.lastIndexOf(">");

  // With no ">" after the first "<", no markup ends: every "<" goes alone.
  if (!lessThanAsText && lastGreaterThan < firstOpen) {
    return html.split("<").join("");
  }

  /*
   * Where every tag ends, from the body of the first tag found never to end
   * on (see the top of this file); null until one is.
   */
  let tagEnds: Int32Array | null = null;
  let tagEndsFrom: number = 0;
  /*
   * The first "-->" at or after where one was last looked for, so the text
   * after a comment that never closes is not searched again for every
   * "<!--" in it. -2: not looked for yet.
   */
  let commentClose: number = -2;
  /*
   * Where the run of "<" that the last "<" read is part of ends, so a run
   * whose "<" are dropped one by one is measured once.
   */
  let lessThanRunEnd: number = -1;
  /*
   * For each of NAMED_ELEMENTS, whether a start tag was found that no end
   * tag of it follows: then none follows a later one either, and the text
   * after it is not searched again.
   */
  const noEndTag: Array<boolean> = [];
  let text: string = html.slice(0, firstOpen);
  let index: number = firstOpen;

  while (index < html.length) {
    const open: number = html.indexOf("<", index);

    if (open === -1) {
      return text + html.slice(index);
    }

    text += html.slice(index, open);

    if (lessThanAsText) {
      if (open >= lessThanRunEnd) {
        lessThanRunEnd = open + 1;

        while (html.charCodeAt(lessThanRunEnd) === LESS_THAN) {
          lessThanRunEnd++;
        }
      }

      // Past the end, charCodeAt is NaN: a "<" at the end is text.
      if (!startsMarkup(html.charCodeAt(lessThanRunEnd))) {
        text += html.slice(open, lessThanRunEnd);
        index = lessThanRunEnd;
        continue;
      }

      // The markup starts at the run's last "<"; the ones before it go.
      if (open < lessThanRunEnd - 1) {
        index = lessThanRunEnd - 1;
        continue;
      }
    }

    let end: number;

    if (open > lastGreaterThan) {
      end = -1;
    } else if (html.startsWith(COMMENT_OPEN, open)) {
      // Looked for from the second "-", so "<!-->" and "<!--->" end at once.
      const searchFrom: number = open + 2;

      if (
        commentClose === -2 ||
        (commentClose !== -1 && commentClose < searchFrom)
      ) {
        commentClose = html.indexOf(COMMENT_CLOSE, searchFrom);
      }

      end = commentClose === -1 ? -1 : commentClose + COMMENT_CLOSE.length;
    } else {
      if (tagEnds !== null) {
        end = tagEnds[open + 1 - tagEndsFrom]!;
      } else {
        end = scanTagEnd(html, open + 1);

        if (end === -1) {
          tagEnds = findTagEnds(html, open + 1);
          tagEndsFrom = open + 1;
        }
      }

      const element: number =
        rawTextElements && end !== -1 ? namedElementOf(html, open) : -1;

      if (element !== -1) {
        const named: NamedElement = NAMED_ELEMENTS[element]!;
        let endTagAt: number = -1;

        if (!noEndTag[element]) {
          named.endTag.lastIndex = end;
          endTagAt = named.endTag.exec(html)?.index ?? -1;
        }

        // A hidden element runs to the ">" of its end tag.
        const elementEnd: number =
          named.hidden && endTagAt !== -1
            ? html.indexOf(">", endTagAt + 2 + named.name.length)
            : -1;

        if (endTagAt === -1 || (named.hidden && elementEnd === -1)) {
          // No end tag follows this start, nor will one follow a later one.
          noEndTag[element] = true;
        } else if (named.hidden) {
          end = elementEnd + 1;
        } else {
          /*
           * A text element's content is read on its own, with no element in
           * it, so nothing in it runs past its end tag, which comes next.
           */
          text +=
            replace(html.slice(open, end)) +
            replaceHtmlMarkup(html.slice(end, endTagAt), replace, {
              lessThanAsText: lessThanAsText,
            });
          index = endTagAt;
          continue;
        }
      }
    }

    if (end === -1) {
      index = open + 1;
      continue;
    }

    text += replace(html.slice(open, end));
    index = end;
  }

  return text;
};

const NOTHING: HtmlMarkupReplacer = (): string => {
  return "";
};

export type RemoveHtmlMarkupFunction = (html: string) => string;

/**
 * The text of `html` with every tag and comment taken out, and every "<"
 * that opens nothing that ends dropped on its own (see the top of this
 * file). The text between them is kept exactly as it is, entities included.
 * What it returns holds no "<".
 */
export const removeHtmlMarkup: RemoveHtmlMarkupFunction = (
  html: string,
): string => {
  return replaceHtmlMarkup(html, NOTHING);
};

export default removeHtmlMarkup;
