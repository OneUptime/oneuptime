/*
 * Escaping for user-controlled text interpolated INTO a markdown sentence -
 * an SLO, monitor, rule, team or user name inside a feed item such as
 * "Added [SLO {name}](link) ...".
 *
 * Why this exists: feed items are rendered by ResourceFeed without the
 * viewer's safe mode, so a name is not inert text there. A name containing
 * `](` closes the surrounding link early and points the rest of the sentence
 * somewhere else; `![x](https://tracker)` renders as an image, which is a
 * zero-click request to a third party every time the feed is opened; `*` and
 * `_` restyle the sentence; `<img ...>` is raw HTML. Every one of those is a
 * character somebody can put in a name, so every one of them is escaped.
 *
 * What it does:
 *   - `null` / `undefined` become "" so callers can pass optional names
 *     straight through.
 *   - Line breaks (\r\n, \r, \n) become a single space. A newline inside a
 *     sentence can start a heading, a list or a block quote, which no escape
 *     character can undo, and a name has no business spanning lines anyway.
 *   - Chat control sequences are broken (neutralizeChatControlSequences
 *     below), as both escapers here do: the same Markdown is posted to Slack.
 *   - Each of \ ` * _ [ ] ( ) # + - ! | < > is prefixed with a backslash. All
 *     of them are ASCII punctuation, which CommonMark guarantees a backslash
 *     turns back into the literal character, so the rendered text reads
 *     exactly like the name that was typed.
 *
 * It is deliberately NOT idempotent: escaping an already-escaped value
 * escapes the backslashes it added, and the reader then sees them. Escape
 * exactly once, at the point the value is interpolated into markdown - never
 * store the escaped form, and never escape a value that is already markdown.
 */

const LINE_BREAK_PATTERN: RegExp = /\r\n|\r|\n/g;

/*
 * An invisible character that joins the characters on either side of it
 * without a break: put between two characters, it keeps them from being read
 * as one token while the text still reads exactly as typed.
 */
export const WORD_JOINER: string = "\u2060";

/*
 * Where a chat control sequence starts, as Slack reads one: "<!" and a word
 * (<!here>, <!channel>, <!everyone>, <!subteam^ID>, <!date^...>), "<@" and
 * a user id, "<#" and a channel id. Not an HTML comment (<!--), CDATA
 * (<![CDATA[), or a document type or other SGML declaration (<!DOCTYPE
 * html>, <!ENTITY ...>): none of them is a Slack sequence, and a reporter
 * pastes them in HTML. Nor a PowerShell block comment, "<#" and a space.
 */
const CHAT_CONTROL_SEQUENCE_START_PATTERN: RegExp =
  /<(?=[@#][a-z0-9]|!(?![-[]|(?:doctype|entity|element|attlist|notation)(?![a-z0-9])))/gi;

export type NeutralizeChatControlSequencesFunction = (
  value: string | undefined | null,
) => string;

/**
 * The text as typed, with every "<!", "<@" and "<#" that Slack could read
 * as a mention broken by an invisible word joiner (WORD_JOINER), so no chat
 * tool reads a mention in it. Idempotent: a joiner already there is not
 * doubled.
 *
 * A backslash escape alone does not do this. Markdown posted to Slack goes
 * through slackify, which reads the Markdown first - so "\<@U123>" is the
 * text "<@U123>" by then - and then writes that text out for Slack, leaving
 * "<@" as it is on purpose: it is how a Slack user mention is written. With
 * the joiner after the "<", slackify escapes the "<" like any other, and
 * Slack shows the characters.
 */
export const neutralizeChatControlSequences: NeutralizeChatControlSequencesFunction =
  (value: string | undefined | null): string => {
    if (value === undefined || value === null) {
      return "";
    }

    return String(value).replace(
      CHAT_CONTROL_SEQUENCE_START_PATTERN,
      `<${WORD_JOINER}`,
    );
  };

/*
 * Where Slack reads a link in text it is handed as it is - code, which
 * Slack's Markdown conversion passes through untouched: "<" and an address
 * ("<https://...|words>", "<mailto:...>"), shown as a link labelled with
 * whatever follows the "|".
 */
const CHAT_LINK_SEQUENCE_START_PATTERN: RegExp =
  /<(?=[A-Za-z][A-Za-z0-9+.-]*:)/g;

export type NeutralizeChatLinkSequencesFunction = (
  value: string | undefined | null,
) => string;

/**
 * The text as written, with every "<" that starts an address Slack could
 * read as a link ("<https://...|words>") broken by the word joiner, as
 * neutralizeChatControlSequences breaks a mention. For code, which reaches
 * Slack as it is: a heredoc ("<<EOF") or a redirect ("<file") is not an
 * address and keeps its characters. Idempotent.
 */
export const neutralizeChatLinkSequences: NeutralizeChatLinkSequencesFunction =
  (value: string | undefined | null): string => {
    if (value === undefined || value === null) {
      return "";
    }

    return String(value).replace(
      CHAT_LINK_SEQUENCE_START_PATTERN,
      `<${WORD_JOINER}`,
    );
  };

/*
 * Backslash comes first in the class only for readability; `replace` visits
 * the ORIGINAL string once, so the backslashes this adds are never re-escaped
 * within a single call.
 */
const MARKDOWN_INLINE_SPECIAL_CHARACTER_PATTERN: RegExp =
  /[\\`*_[\]()#+\-!|<>]/g;

export type EscapeMarkdownInlineFunction = (
  value: string | undefined | null,
) => string;

export const escapeMarkdownInline: EscapeMarkdownInlineFunction = (
  value: string | undefined | null,
): string => {
  if (value === undefined || value === null) {
    return "";
  }

  // Defensive: a caller typed `string` can still hand over a number at runtime.
  return neutralizeChatControlSequences(
    String(value).replace(LINE_BREAK_PATTERN, " "),
  ).replace(
    MARKDOWN_INLINE_SPECIAL_CHARACTER_PATTERN,
    (character: string): string => {
      return `\\${character}`;
    },
  );
};

/*
 * Escaping for a plain value placed into Markdown that a PERSON goes on to
 * read and edit before it is posted - an incident's title or a custom field
 * value filled into a note template's {{placeholders}} - and for a title or
 * a name placed into the prose of a feed item or a chat message.
 *
 * escapeMarkdownInline above is the wrong tool there. The note composer opens
 * in its visual mode, which shows a backslash escape exactly as written, so a
 * title such as "Site 03 - payments (EU)" would appear to the author as
 * "Site 03 \- payments \(EU\)". Restyling a value is harmless in a draft its
 * author reviews; what must not happen is the value turning into something
 * else once the note is rendered for subscribers. So only the characters that
 * can make a value into a link, an image or HTML are escaped:
 *
 *   - `[` and `]`: every link and image, inline or by reference, is built
 *     from brackets. `[Reset your password](https://evil.example)` in a title
 *     would otherwise arrive in subscribers' email as a live link, and
 *     `![](https://tracker.example/pixel)` as an image fetched on open. The
 *     closing bracket matters too: a template may put the value inside a link
 *     of its own, and a value must not be able to end that link's text.
 *   - `<`: raw HTML and `<https://...>` autolinks both start with it. (The
 *     renderers drop raw HTML as well; this keeps it readable as text.)
 *   - `\`: a value ending in a backslash would otherwise undo the escape
 *     that follows it.
 *
 * Chat control sequences are broken as well (neutralizeChatControlSequences),
 * so "<@U123>" or "<!channel>" mentions nobody once the text reaches Slack.
 *
 * A bare address in a value ("https://example.com") is still made a link by
 * the renderers, as it is when someone types one into a note - but such a
 * link shows the address it goes to. No value can make link text that hides
 * its destination.
 *
 * Inside a link's own text, use escapeMarkdownInline instead: marked undoes
 * "\[" and "\]" there before it reads the text, so escaping brackets alone
 * would let "![](...)" become an image inside the link.
 *
 * Line breaks become spaces unless `keepLineBreaks` is set (a long text
 * value): a newline could start a heading or a list, which a single-line
 * value has no business doing.
 *
 * Like escapeMarkdownInline, escape once, where the value is placed.
 */

const MARKDOWN_LINK_OR_HTML_CHARACTER_PATTERN: RegExp = /[\\[\]<]/g;

export type EscapeMarkdownValueFunction = (
  value: string | undefined | null,
  options?: { keepLineBreaks?: boolean | undefined },
) => string;

export const escapeMarkdownValue: EscapeMarkdownValueFunction = (
  value: string | undefined | null,
  options?: { keepLineBreaks?: boolean | undefined },
): string => {
  if (value === undefined || value === null) {
    return "";
  }

  let text: string = neutralizeChatControlSequences(String(value)).replace(
    MARKDOWN_LINK_OR_HTML_CHARACTER_PATTERN,
    (character: string): string => {
      return `\\${character}`;
    },
  );

  text = options?.keepLineBreaks
    ? text.replace(LINE_BREAK_PATTERN, "\n")
    : text.replace(LINE_BREAK_PATTERN, " ");

  return text;
};

/*
 * A value as an inline code span: text a monitored system or its telemetry
 * reported - a resource or attribute name, a label's value, a grouping key -
 * shown exactly as written, with nothing in it read as Markdown.
 *
 * Wrapping a value that contains a backtick in single backticks would close
 * the span early and spill the rest of the value - and whatever Markdown it
 * holds - into the text around it. So the fence is one backtick longer than
 * the longest run inside the value, and padded with a space on each side
 * when the value has any backticks at all (CommonMark strips exactly one from
 * each side, so the padding never shows). Line breaks become spaces: a code
 * span cannot hold one, and a newline inside a list item would end the item.
 *
 * Every "<" that something follows is broken here too, by the same word
 * joiner: Slack's Markdown conversion passes code through untouched, so
 * "<!channel>" or "<https://...|words>" inside a code span would otherwise
 * reach Slack as a mention or a link, and a Microsoft Teams message card,
 * which has no code spans, would read "<img ...>" in one as HTML. The word
 * joiner cannot be seen inside the span either.
 *
 * A value without backticks is a plain single-backtick span, so an ISO
 * timestamp still reaches the dashboard as the bare inline code it re-renders
 * in the viewer's timezone. "" (no span at all) for an empty value.
 */

const CODE_SPAN_LINE_BREAK_PATTERN: RegExp = /\s*[\r\n]+\s*/g;
const BACKTICK_RUN_PATTERN: RegExp = /`+/g;

// A "<" with something after it that is not already broken.
const OPEN_ANGLE_BRACKET_PATTERN: RegExp = /<(?![\s\u2060])/g;

export type MarkdownCodeSpanFunction = (
  value: string | undefined | null,
) => string;

export const markdownCodeSpan: MarkdownCodeSpanFunction = (
  value: string | undefined | null,
): string => {
  if (value === undefined || value === null) {
    return "";
  }

  const text: string = String(value)
    .replace(CODE_SPAN_LINE_BREAK_PATTERN, " ")
    .trim()
    .replace(OPEN_ANGLE_BRACKET_PATTERN, `<${WORD_JOINER}`);

  if (text.length === 0) {
    return "";
  }

  const backtickRuns: Array<string> = text.match(BACKTICK_RUN_PATTERN) || [];

  const longestRun: number = backtickRuns.reduce(
    (longest: number, run: string): number => {
      return Math.max(longest, run.length);
    },
    0,
  );

  if (longestRun === 0) {
    return `\`${text}\``;
  }

  const fence: string = "`".repeat(longestRun + 1);

  return `${fence} ${text} ${fence}`;
};

export default escapeMarkdownInline;
