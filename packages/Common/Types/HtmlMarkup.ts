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
 * rawTextElements reads script and style elements - HTML's raw text
 * elements, what they hold never shown - as markup whole: from the start
 * tag to the ">" of the first end tag of the same name after it ("</script>",
 * "</script >", "</style foo>"), and `replace` is given the whole element.
 * Their tags are found by the walk, so a "<script" inside a comment or a
 * quoted value is not one, and nothing a style holds starts a script. A
 * start tag that no end tag follows is an ordinary tag, and what follows it
 * stays text.
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

type KeepTextLessThansFunction = (html: string, firstOpen: number) => string;

/*
 * The text read with lessThanAsText when no markup in it can end - no ">"
 * comes after its first "<": each run of "<" before what starts markup goes,
 * and every other "<" stays. One loop, and nothing allocated but the text.
 */
const keepTextLessThans: KeepTextLessThansFunction = (
  html: string,
  firstOpen: number,
): string => {
  let text: string = html.slice(0, firstOpen);
  let index: number = firstOpen;

  for (;;) {
    const open: number = html.indexOf("<", index);

    if (open === -1) {
      return text + html.slice(index);
    }

    text += html.slice(index, open);

    let runEnd: number = open + 1;

    while (html.charCodeAt(runEnd) === LESS_THAN) {
      runEnd++;
    }

    if (!startsMarkup(html.charCodeAt(runEnd))) {
      text += html.slice(open, runEnd);
    }

    index = runEnd;
  }
};

// A raw text element, by name, and where its end tag starts.
interface RawTextElement {
  name: string;
  endTag: RegExp;
}

const RAW_TEXT_ELEMENTS: ReadonlyArray<RawTextElement> = [
  { name: "script", endTag: /<\/script(?=[\s/>])/gi },
  { name: "style", endTag: /<\/style(?=[\s/>])/gi },
];

type RawTextElementOfFunction = (html: string, open: number) => number;

/*
 * Which raw text element the start tag at `open` starts - its index in
 * RAW_TEXT_ELEMENTS - or -1: "<script" or "<style", in any letter case,
 * where the name then ends, at whitespace, a "/" or the ">".
 */
const rawTextElementOf: RawTextElementOfFunction = (
  html: string,
  open: number,
): number => {
  return RAW_TEXT_ELEMENTS.findIndex((element: RawTextElement): boolean => {
    const nameEnd: number = open + 1 + element.name.length;
    const after: number = html.charCodeAt(nameEnd);

    return (
      html.slice(open + 1, nameEnd).toLowerCase() === element.name &&
      (after === GREATER_THAN || after === SLASH || isWhitespace(after))
    );
  });
};

/*
 * The first end tag of one raw text element at or after where it was last
 * looked for: where its name starts, and just past its ">" (-1 when there is
 * none). Kept so the text after a start tag that no end tag follows is not
 * searched again for every later start tag.
 */
interface RawTextElementEnd {
  from: number;
  nameAt: number;
  end: number;
}

type FindRawTextElementEndFunction = (
  html: string,
  endTag: RegExp,
  from: number,
  last: RawTextElementEnd | undefined,
) => RawTextElementEnd;

const findRawTextElementEnd: FindRawTextElementEndFunction = (
  html: string,
  endTag: RegExp,
  from: number,
  last: RawTextElementEnd | undefined,
): RawTextElementEnd => {
  // The walk only moves forward, so the last answer holds until it is passed.
  if (last && from >= last.from && (last.end === -1 || from <= last.nameAt)) {
    return last;
  }

  endTag.lastIndex = from;

  const found: RegExpExecArray | null = endTag.exec(html);
  const close: number = found
    ? html.indexOf(">", found.index + found[0].length)
    : -1;

  return {
    from: from,
    nameAt: found ? found.index : -1,
    end: close === -1 ? -1 : close + 1,
  };
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

  // With no ">" after the first "<", no markup ends: every "<" goes alone.
  if (html.lastIndexOf(">") < firstOpen) {
    return lessThanAsText
      ? keepTextLessThans(html, firstOpen)
      : html.split("<").join("");
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
  // The end tag last found for each raw text element.
  const rawTextElementEnds: Array<RawTextElementEnd | undefined> = [];
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

    if (html.startsWith(COMMENT_OPEN, open)) {
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
        rawTextElements && end !== -1 ? rawTextElementOf(html, open) : -1;

      if (element !== -1) {
        const elementEnd: RawTextElementEnd = findRawTextElementEnd(
          html,
          RAW_TEXT_ELEMENTS[element]!.endTag,
          end,
          rawTextElementEnds[element],
        );

        rawTextElementEnds[element] = elementEnd;

        if (elementEnd.end !== -1) {
          end = elementEnd.end;
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
