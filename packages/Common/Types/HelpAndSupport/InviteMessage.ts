import { getHelpEmailProblem, isSafeHelpLink } from "./HelpAndSupport";

/*
 * THE SINGLE SIGN-ON SCREEN'S OWN MESSAGE, AS THE SCREEN DRAWS IT (#10865).
 *
 * A server's admins may write what the "You need to be invited." screen
 * says, so the person reading it knows whom to ask: "Ask the IT service
 * desk, it-help@example.com or https://help.example.com/oneuptime." The
 * message is plain text, never HTML (getInviteMessageProblem refuses < and
 * >), and is drawn in a small safe subset of it:
 *
 *   - each line is a paragraph of its own; blank lines are dropped;
 *   - a whole https or http link, and a whole email address, becomes a link
 *     - the address as a mailto: link - with the punctuation around it (a
 *     full stop after it, brackets around it) left as text.
 *
 * Every part is text the view escapes as it writes it (Message.ejs, with
 * <%= %>), and a link's address is only ever one isSafeHelpLink accepts or
 * mailto: before an address getHelpEmailProblem accepts. Nothing a message
 * holds is written into the page as markup.
 */

export interface InviteMessageText {
  text: string;
  href?: undefined;
}

export interface InviteMessageLink {
  text: string;
  href: string;
  // An https or http link opens in a tab of its own; a mailto: link does not.
  isWebLink: boolean;
}

export type InviteMessagePart = InviteMessageText | InviteMessageLink;

export type InviteMessageParagraph = Array<InviteMessagePart>;

// Punctuation a sentence puts before or after a link that is no part of it.
const LEADING_PUNCTUATION: RegExp = /^[(\["'«“‘]+/;
const TRAILING_PUNCTUATION: RegExp = /[.,;:!?)\]"'»”’]+$/;

const WEB_LINK_START: RegExp = /^https?:\/\//i;

/*
 * One word of a line - text with no whitespace in it - as its parts: the
 * link or address in it, with what surrounds it as text, or the word as
 * text when it holds none.
 */
const toWordParts: (word: string) => Array<InviteMessagePart> = (
  word: string,
): Array<InviteMessagePart> => {
  const leading: string = (word.match(LEADING_PUNCTUATION) || [""])[0] || "";
  const afterLeading: string = word.slice(leading.length);
  const trailing: string =
    (afterLeading.match(TRAILING_PUNCTUATION) || [""])[0] || "";
  const core: string = afterLeading.slice(
    0,
    afterLeading.length - trailing.length,
  );

  let link: InviteMessageLink | null = null;

  if (WEB_LINK_START.test(core) && isSafeHelpLink(core)) {
    link = { text: core, href: core, isWebLink: true };
  } else if (core.includes("@") && getHelpEmailProblem(core) === null) {
    link = { text: core, href: `mailto:${core}`, isWebLink: false };
  }

  if (!link) {
    return [{ text: word }];
  }

  const parts: Array<InviteMessagePart> = [];

  if (leading) {
    parts.push({ text: leading });
  }

  parts.push(link);

  if (trailing) {
    parts.push({ text: trailing });
  }

  return parts;
};

// One line as its parts, neighbouring text joined into one part.
const toLineParts: (line: string) => InviteMessageParagraph = (
  line: string,
): InviteMessageParagraph => {
  const parts: InviteMessageParagraph = [];

  // Whitespace is kept as its own pieces, so the words keep their spacing.
  for (const piece of line.split(/(\s+)/)) {
    if (!piece) {
      continue;
    }

    const pieceParts: Array<InviteMessagePart> = /^\s+$/.test(piece)
      ? [{ text: piece }]
      : toWordParts(piece);

    for (const part of pieceParts) {
      const last: InviteMessagePart | undefined = parts[parts.length - 1];

      if (!part.href && last && !last.href) {
        last.text = last.text + part.text;
        continue;
      }

      parts.push({ ...part });
    }
  }

  return parts;
};

// The message as the screen draws it: a paragraph a line, links and addresses linked.
export const toInviteMessageParagraphs: (
  message: string,
) => Array<InviteMessageParagraph> = (
  message: string,
): Array<InviteMessageParagraph> => {
  if (typeof message !== "string") {
    return [];
  }

  return message
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line: string): string => {
      return line.trim();
    })
    .filter((line: string): boolean => {
      return line.length > 0;
    })
    .map(toLineParts);
};
