/*
 * THE TEXT OF AN INCOMING WEBHOOK'S MESSAGE CARD, READ IN LINEAR TIME.
 *
 * MicrosoftTeamsUtil builds a MessageCard from a notification's Markdown:
 * its links become buttons and its "**Label:** value" lines facts. Both were
 * read with regular expressions that looked from every "[" or "**" through
 * the rest of the line, so a line of "[[[" or "****" took seconds to build a
 * card from. These read the same links and facts in one pass over the line.
 *
 * Pure, with no Node or browser APIs.
 */

/*
 * A Markdown link, [text](url), as an incoming webhook's MessageCard turns it
 * into a button. Only a link Markdown itself would read: a "[" written as
 * "\[" - a title or a name escaped where it was placed (MarkdownEscape) - opens
 * no link, and a "]" written as "\]" does not end the link's text. A "["
 * after an even run of backslashes ("\\[") is not escaped: the backslashes
 * are a literal one, and a link follows. So text that only looks like a link
 * stays text, as it does in every other place the message is shown.
 *
 * Read in one pass (findMessageCardLinks), as the regular expression
 *
 *   /(?<!(?:^|[^\\])(?:\\\\)*\\)\[((?:[^\]\\]|\\.)+)\]\(([^)]+)\)/g
 *
 * read them - which looked for the end of every "[" through the rest of the
 * line: a line of "[[[" took 16 s to read on 64 KB.
 */
export interface MessageCardLink {
  // Where the link starts ("[") and ends (after ")") in its line.
  start: number;
  end: number;
  // Its text, as written: escapes and all.
  text: string;
  url: string;
}

const LEFT_BRACKET: number = 0x5b;
const RIGHT_BRACKET: number = 0x5d;
const LEFT_PARENTHESIS: number = 0x28;
const RIGHT_PARENTHESIS: number = 0x29;
const BACKSLASH_CODE: number = 0x5c;
// One character that "\s" takes.
const WHITESPACE_PATTERN: RegExp = /\s/;

// What "." in a regular expression does not match: a line terminator.
const isLineTerminator: (code: number) => boolean = (code: number): boolean => {
  return code === 0x0a || code === 0x0d || code === 0x2028 || code === 0x2029;
};

export type FindMessageCardLinksFunction = (
  line: string,
) => Array<MessageCardLink>;

/*
 * The links of a line (see MessageCardLink), left to right. For each
 * position, where a link's text starting there ends is found once, from the
 * line's end: at the first "]" a backslash does not escape, its text read
 * as the expression reads it - a backslash and the character after it as
 * one, and a backslash with nothing it can take after it ending the text
 * where no link can follow.
 */
export const findMessageCardLinks: FindMessageCardLinksFunction = (
  line: string,
): Array<MessageCardLink> => {
  const links: Array<MessageCardLink> = [];

  if (line.indexOf("[") === -1) {
    return links;
  }

  const length: number = line.length;
  // Where a text starting at each position ends ("]"), or -1.
  const textEnd: Int32Array = new Int32Array(length + 2).fill(-1);
  // The first ")" at or after each position, or -1.
  const nextRightParenthesis: Int32Array = new Int32Array(length + 2).fill(-1);

  for (let index: number = length - 1; index >= 0; index--) {
    const code: number = line.charCodeAt(index);

    nextRightParenthesis[index] =
      code === RIGHT_PARENTHESIS ? index : nextRightParenthesis[index + 1]!;

    if (code === RIGHT_BRACKET) {
      textEnd[index] = index;
    } else if (code === BACKSLASH_CODE) {
      textEnd[index] =
        index + 1 < length && !isLineTerminator(line.charCodeAt(index + 1))
          ? textEnd[index + 2]!
          : -1;
    } else {
      textEnd[index] = textEnd[index + 1]!;
    }
  }

  let backslashesBefore: number = 0;
  let index: number = 0;

  while (index < length) {
    const code: number = line.charCodeAt(index);

    if (code !== LEFT_BRACKET) {
      backslashesBefore = code === BACKSLASH_CODE ? backslashesBefore + 1 : 0;
      index++;
      continue;
    }

    // A "[" an odd run of backslashes escapes opens nothing.
    const isEscaped: boolean = backslashesBefore % 2 === 1;
    backslashesBefore = 0;

    const close: number = textEnd[index + 1]!;

    if (
      isEscaped ||
      close <= index + 1 ||
      line.charCodeAt(close + 1) !== LEFT_PARENTHESIS
    ) {
      index++;
      continue;
    }

    const urlEnd: number = nextRightParenthesis[close + 2]!;

    if (urlEnd === -1) {
      // No ")" is left in the line: no link can end in it.
      break;
    }

    if (urlEnd === close + 2) {
      index++;
      continue;
    }

    links.push({
      start: index,
      end: urlEnd + 1,
      text: line.slice(index + 1, close),
      url: line.slice(close + 2, urlEnd),
    });
    index = urlEnd + 1;
    backslashesBefore = 0;
  }

  return links;
};

export type WithLinksAsTextFunction = (
  line: string,
  links: Array<MessageCardLink>,
) => string;

// The line with each of its links replaced by the link's text.
export const withLinksAsText: WithLinksAsTextFunction = (
  line: string,
  links: Array<MessageCardLink>,
): string => {
  if (links.length === 0) {
    return line;
  }

  let text: string = "";
  let copiedUpTo: number = 0;

  for (const link of links) {
    text += line.slice(copiedUpTo, link.start) + link.text;
    copiedUpTo = link.end;
  }

  return text + line.slice(copiedUpTo);
};

export interface MessageCardFact {
  name: string;
  value: string;
}

export type FindFactFunction = (line: string) => MessageCardFact | null;

/*
 * A fact, "**Label:** value", as /\*\*(.*?):\*\*\s*(.*)/ read it - which
 * scanned the rest of the line from every "**" for a ":**": a line of
 * "*" took seconds. Read with indexOf instead, the same way: the label runs
 * from the first "**" to the first ":**" after it with no line terminator
 * between ("." takes none), and the value is the rest of that line once the
 * whitespace after the ":**" - line terminators too, as "\s" takes them -
 * is passed.
 */
export const findFact: FindFactFunction = (
  line: string,
): MessageCardFact | null => {
  let segmentStart: number = 0;

  while (segmentStart <= line.length) {
    let segmentEnd: number = segmentStart;

    while (
      segmentEnd < line.length &&
      !isLineTerminator(line.charCodeAt(segmentEnd))
    ) {
      segmentEnd++;
    }

    const segment: string = line.slice(segmentStart, segmentEnd);
    const open: number = segment.indexOf("**");
    const close: number = open === -1 ? -1 : segment.indexOf(":**", open + 2);

    if (close !== -1) {
      let valueStart: number = segmentStart + close + 3;

      while (
        valueStart < line.length &&
        WHITESPACE_PATTERN.test(line.charAt(valueStart))
      ) {
        valueStart++;
      }

      let valueEnd: number = valueStart;

      while (
        valueEnd < line.length &&
        !isLineTerminator(line.charCodeAt(valueEnd))
      ) {
        valueEnd++;
      }

      return {
        name: segment.slice(open + 2, close),
        value: line.slice(valueStart, valueEnd),
      };
    }

    segmentStart = segmentEnd + 1;
  }

  return null;
};
