import FeedMarkdown, { MarkdownText, MarkdownValue, mdText } from "./FeedMarkdown";

/*
 * A SLACK OR MICROSOFT TEAMS MESSAGE, AS THE MARKDOWN OF A NOTE.
 *
 * Pin a message in an incident's channel - or react to it with a note emoji
 * - and OneUptime saves it as a note. The note should read as the message
 * did: its bold and italics, its code, its lists and quotes, its links, the
 * people it mentions by name, and the files and images it carried as links
 * to them. It used to be its bare text: Slack's own markup ("*bold*",
 * "<@U0123|>", "<https://...|words>") was saved as it came, and a Microsoft
 * Teams message lost everything but its words.
 *
 * A message is what anyone in the channel typed - or an app, or somebody
 * from another company in a shared channel - and the note goes where no
 * chat message goes: the incident's timeline in the dashboard, rendered
 * without its safe mode; the owners' email; the record's other channels;
 * and, for a public note, the status page and its subscribers. So nothing
 * typed in it may act on its own there. Each chat's reader
 * (SlackMessageReader, MicrosoftTeamsMessageReader) turns the message into
 * the few things a chat message is made of - a ChatMessageContent - and this
 * writes that as Markdown, with every piece of text in it placed as text
 * (mdText): a "*", a "[", a "<", a "#" at the start of a line, a chat
 * mention reads as it was typed and does nothing. The only Markdown in a
 * note is what this writes around the text:
 *
 *   - emphasis, strikethrough and code, where the message had them;
 *   - lists, quotes and code blocks (fenced, with no language, so never a
 *     diagram);
 *   - links, to a web or mailto address only: one whose words look like an
 *     address elsewhere ("https://bank.example" over a link to another site)
 *     shows its real address instead;
 *   - files and images as links ("📎 screenshot.png"), never as images: an
 *     image is fetched when the note is shown, a link only when followed -
 *     and a note can be written without them (a public note: a link to a
 *     file in a company's chat opens for nobody outside it).
 *
 * Line breaks are kept (a hard break: two spaces at the end of the line, as
 * every renderer reads it). What is written is decided from the content
 * alone, in time that grows with its length: no pattern here reads the
 * message itself.
 *
 * Pure, with no database or React imports.
 */

// How a run of text was styled in the chat.
export interface ChatTextStyle {
  bold?: boolean | undefined;
  italic?: boolean | undefined;
  strike?: boolean | undefined;
  code?: boolean | undefined;
}

// A run of text: a line break is a "\n" in it.
export interface ChatTextInline {
  type: "text";
  text: string;
  style?: ChatTextStyle | undefined;
}

// A link, or a file or image the message carried (isAttachment).
export interface ChatLinkInline {
  type: "link";
  url: string;
  // The link's words; its address when there are none.
  text?: string | undefined;
  style?: ChatTextStyle | undefined;
  /*
   * A file or an image the message carried, as a link to it: left out of a
   * note written without them (ChatMessageMarkdownOptions).
   */
  isAttachment?: boolean | undefined;
}

export type ChatInline = ChatTextInline | ChatLinkInline;

export interface ChatParagraphBlock {
  type: "paragraph";
  inlines: Array<ChatInline>;
}

export interface ChatQuoteBlock {
  type: "quote";
  inlines: Array<ChatInline>;
}

export interface ChatCodeBlock {
  type: "code";
  text: string;
}

export interface ChatListBlock {
  type: "list";
  ordered: boolean;
  // The first item's number, for an ordered list. 1 when left out.
  start?: number | undefined;
  // How deep the list is nested: 0 for a list of its own.
  indent: number;
  // Each item's text: a line break is a "\n" in it.
  items: Array<Array<ChatInline>>;
}

export type ChatBlock =
  | ChatParagraphBlock
  | ChatQuoteBlock
  | ChatCodeBlock
  | ChatListBlock;

export interface ChatMessageContent {
  blocks: Array<ChatBlock>;
}

export interface ChatMessageMarkdownOptions {
  /*
   * Leave out the files and images the message carried: for a public note,
   * where a link into a company's chat opens for nobody.
   */
  withoutAttachments?: boolean | undefined;
}

// A list is nested at most this deep; deeper items stay at this depth.
const MAX_LIST_INDENT: number = 5;

// The spaces one level of a nested list is indented by.
const LIST_INDENT: string = "    ";

// What a line of a paragraph ends with when another follows: a hard break.
const HARD_BREAK: string = "  \n";

// What a file or an image is marked with: "📎 screenshot.png".
const ATTACHMENT_MARK: string = "📎 ";

/*
 * The longest run of text placed as one value. mdText reads each value's
 * bare web addresses to leave them as typed, at a cost that grows with how
 * many there are times the value's length; a run is cut at a space into
 * values no longer than this, so a message of thousands of addresses reads
 * in time that grows with its length.
 */
const MAX_TEXT_VALUE_LENGTH: number = 400;

// Whitespace, as CommonMark reads it next to an emphasis marker.
const WHITESPACE_CHARACTER: RegExp = /\s/u;

/*
 * Punctuation as every Markdown reader here agrees on it: Unicode
 * punctuation (P) and ASCII's own symbols. A symbol outside ASCII - an
 * emoji, "©" - is punctuation to some readers and a letter to others, so
 * PUNCTUATION_OR_SYMBOL_CHARACTER below counts it only where that is the
 * safer reading.
 */
const PUNCTUATION_CHARACTER: RegExp = /[\p{P}!-/:-@[-`{-~]/u;

const PUNCTUATION_OR_SYMBOL_CHARACTER: RegExp = /[\p{P}\p{S}]/u;

// An address a link may go to: a web page or an email address.
const LINKABLE_SCHEMES: ReadonlyArray<string> = ["http:", "https:", "mailto:"];

// A link's words that look like a web address of their own.
const WEB_ADDRESS_START: RegExp = /^(?:https?:\/\/|www\.)/i;

// An invisible character that keeps two markers apart (see renderLine).
const WORD_JOINER: string = "⁠";

// One run of a line, with what it renders as and its emphasis marker.
interface LineRun {
  // The run as Markdown, without its emphasis.
  inner: MarkdownText;
  innerText: string;
  // The emphasis around it: "~~" for strikethrough, "*", "**" or "***".
  strike: boolean;
  stars: number;
  // Whether it is wrapped in its emphasis (renderLine decides).
  isWrapped: boolean;
  // Whether a word joiner goes before it, to keep two markers apart.
  hasJoinerBefore: boolean;
}

type IsWhitespaceFunction = (character: string) => boolean;

const isWhitespace: IsWhitespaceFunction = (character: string): boolean => {
  return character === "" || WHITESPACE_CHARACTER.test(character);
};

export default class ChatMessageMarkdown {
  /*
   * The message as a note's Markdown: its blocks one after another, a
   * blank line between them - none between the lists of one nested list.
   * Empty for a message with nothing to show.
   */
  public static toMarkdown(
    content: ChatMessageContent,
    options?: ChatMessageMarkdownOptions | undefined,
  ): MarkdownText {
    const pieces: Array<MarkdownValue> = [];
    let previousWasList: boolean = false;

    for (const block of content.blocks || []) {
      const markdown: MarkdownText = ChatMessageMarkdown.renderBlock(
        block,
        options,
      );

      if (markdown.isEmpty()) {
        continue;
      }

      const isList: boolean = block.type === "list";

      if (pieces.length > 0) {
        pieces.push(
          isList && previousWasList
            ? FeedMarkdown.asMarkdown("\n")
            : FeedMarkdown.asMarkdown("\n\n"),
        );
      }

      pieces.push(markdown);
      previousWasList = isList;
    }

    return FeedMarkdown.join(pieces, "").trim();
  }

  /*
   * The message's text as one line of plain text, for what a notification
   * shows: its words and the addresses of its links, without any styling.
   */
  public static toPlainText(content: ChatMessageContent): string {
    const lines: Array<string> = [];

    for (const block of content.blocks || []) {
      if (block.type === "code") {
        lines.push(block.text);
        continue;
      }

      const inlineGroups: Array<Array<ChatInline>> =
        block.type === "list" ? block.items : [block.inlines];

      for (const inlines of inlineGroups) {
        lines.push(
          inlines
            .map((inline: ChatInline): string => {
              return inline.type === "text"
                ? inline.text
                : inline.text || inline.url;
            })
            .join(""),
        );
      }
    }

    return lines.join(" ").split("\n").join(" ").trim();
  }

  // Whether the content has nothing to show once written.
  public static isEmpty(
    content: ChatMessageContent,
    options?: ChatMessageMarkdownOptions | undefined,
  ): boolean {
    return ChatMessageMarkdown.toMarkdown(content, options).isEmpty();
  }

  /*
   * A link's address, if a note may link to it: a web or mailto address,
   * as it was given. Null for anything else - a relative address, which
   * would point into OneUptime itself, "javascript:", "slack://".
   */
  public static getLinkableAddress(url: string | undefined): string | null {
    const address: string = (url || "").trim();

    if (!address) {
      return null;
    }

    let parsed: URL;

    try {
      parsed = new URL(address);
    } catch {
      return null;
    }

    if (!LINKABLE_SCHEMES.includes(parsed.protocol.toLowerCase())) {
      return null;
    }

    return address;
  }

  /*
   * The words a link is shown with: its own, unless they look like a web
   * address on another host than the one it goes to - then the address
   * itself, so a link's words never name a site it does not go to.
   */
  public static getLinkWords(data: {
    url: string;
    text?: string | undefined;
  }): string {
    const words: string = (data.text || "").trim();

    if (!words) {
      return data.url;
    }

    if (!WEB_ADDRESS_START.test(words)) {
      return words;
    }

    const wordsHost: string | null = ChatMessageMarkdown.getHost(
      words.toLowerCase().startsWith("www.") ? `https://${words}` : words,
    );
    const addressHost: string | null = ChatMessageMarkdown.getHost(data.url);

    if (!wordsHost || !addressHost || wordsHost !== addressHost) {
      return data.url;
    }

    return words;
  }

  private static getHost(address: string): string | null {
    try {
      return new URL(address).host.toLowerCase() || null;
    } catch {
      return null;
    }
  }

  private static renderBlock(
    block: ChatBlock,
    options?: ChatMessageMarkdownOptions | undefined,
  ): MarkdownText {
    switch (block.type) {
      case "paragraph":
        return ChatMessageMarkdown.renderParagraphs(
          ChatMessageMarkdown.withoutLeftOut(block.inlines, options),
        );
      case "quote":
        return ChatMessageMarkdown.renderQuote(
          ChatMessageMarkdown.withoutLeftOut(block.inlines, options),
        );
      case "code":
        return ChatMessageMarkdown.renderCode(block.text);
      case "list":
        return ChatMessageMarkdown.renderList(block, options);
    }
  }

  // The inlines without the attachments a note is written without.
  private static withoutLeftOut(
    inlines: Array<ChatInline>,
    options?: ChatMessageMarkdownOptions | undefined,
  ): Array<ChatInline> {
    if (!options?.withoutAttachments) {
      return inlines || [];
    }

    return (inlines || []).filter((inline: ChatInline): boolean => {
      return !(inline.type === "link" && inline.isAttachment);
    });
  }

  /*
   * Paragraphs: a blank line ("\n\n") in the text ends one, a single line
   * break is a hard break inside one.
   */
  private static renderParagraphs(inlines: Array<ChatInline>): MarkdownText {
    const paragraphs: Array<MarkdownText> = [];

    for (const lines of ChatMessageMarkdown.splitParagraphs(inlines)) {
      const rendered: MarkdownText = ChatMessageMarkdown.joinLines(
        lines.map((line: Array<ChatInline>): MarkdownText => {
          return ChatMessageMarkdown.renderLine(line);
        }),
        "",
      );

      if (!rendered.isEmpty()) {
        paragraphs.push(rendered);
      }
    }

    return FeedMarkdown.join(paragraphs, "\n\n");
  }

  /*
   * A quote: each line after "> ", a hard break between lines, and a line
   * holding only ">" between paragraphs.
   */
  private static renderQuote(inlines: Array<ChatInline>): MarkdownText {
    const paragraphs: Array<MarkdownText> = [];

    for (const lines of ChatMessageMarkdown.splitParagraphs(inlines)) {
      const rendered: MarkdownText = ChatMessageMarkdown.joinLines(
        lines.map((line: Array<ChatInline>): MarkdownText => {
          return ChatMessageMarkdown.renderLine(line);
        }),
        "> ",
      );

      if (!rendered.isEmpty()) {
        paragraphs.push(mdText`> ${rendered}`);
      }
    }

    return FeedMarkdown.join(paragraphs, "\n>\n");
  }

  /*
   * Lines of one paragraph, a hard break between them, each later line
   * after `prefix` (a quote's "> ", a list item's indentation). Empty lines
   * are left out.
   */
  private static joinLines(
    lines: Array<MarkdownText>,
    prefix: string,
  ): MarkdownText {
    const kept: Array<MarkdownText> = lines.filter(
      (line: MarkdownText): boolean => {
        return !line.isEmpty();
      },
    );

    return FeedMarkdown.join(kept, `${HARD_BREAK}${prefix}`);
  }

  // A code block, fenced, with no language: shown as the text it is.
  private static renderCode(text: string): MarkdownText {
    const code: string = ChatMessageMarkdown.trimBlankLines(text || "");

    if (!code.trim()) {
      return FeedMarkdown.empty();
    }

    return mdText`\`\`\`
${code}
\`\`\``;
  }

  /*
   * A list: "- " or "1. " before each item, indented four spaces a level.
   * An item that spans lines goes on under its first line, indented to it.
   */
  private static renderList(
    block: ChatListBlock,
    options?: ChatMessageMarkdownOptions | undefined,
  ): MarkdownText {
    const indent: string = LIST_INDENT.repeat(
      Math.min(Math.max(Math.floor(block.indent || 0), 0), MAX_LIST_INDENT),
    );
    const start: number =
      block.ordered &&
      Number.isFinite(block.start) &&
      (block.start as number) >= 0
        ? Math.floor(block.start as number)
        : 1;

    const items: Array<MarkdownText> = [];
    let number: number = start;

    for (const item of block.items || []) {
      const lines: Array<MarkdownText> = [];

      for (const paragraph of ChatMessageMarkdown.splitParagraphs(
        ChatMessageMarkdown.withoutLeftOut(item, options),
      )) {
        for (const line of paragraph) {
          lines.push(ChatMessageMarkdown.renderLine(line));
        }
      }

      const marker: string = block.ordered ? `${number}. ` : "- ";
      const text: MarkdownText = ChatMessageMarkdown.joinLines(
        lines,
        indent + " ".repeat(marker.length),
      );

      if (text.isEmpty()) {
        continue;
      }

      items.push(
        FeedMarkdown.join(
          [FeedMarkdown.asMarkdown(`${indent}${marker}`), text],
          "",
        ),
      );
      number++;
    }

    return FeedMarkdown.join(items, "\n");
  }

  /*
   * The inlines split at their line breaks: paragraphs (at a blank line),
   * each a list of lines, each a list of inlines with no line break in
   * them. Lines are trimmed at both ends; runs of blank lines count as one.
   */
  private static splitParagraphs(
    inlines: Array<ChatInline>,
  ): Array<Array<Array<ChatInline>>> {
    const paragraphs: Array<Array<Array<ChatInline>>> = [];
    let lines: Array<Array<ChatInline>> = [];
    let line: Array<ChatInline> = [];

    const endLine: () => void = (): void => {
      const trimmed: Array<ChatInline> = ChatMessageMarkdown.trimLine(line);
      line = [];

      if (trimmed.length === 0) {
        // A blank line ends the paragraph.
        if (lines.length > 0) {
          paragraphs.push(lines);
          lines = [];
        }
        return;
      }

      lines.push(trimmed);
    };

    for (const inline of inlines || []) {
      if (inline.type === "link") {
        line.push(inline);
        continue;
      }

      const parts: Array<string> = (inline.text || "").split("\n");

      parts.forEach((part: string, index: number): void => {
        if (index > 0) {
          endLine();
        }

        if (part) {
          line.push({ type: "text", text: part, style: inline.style });
        }
      });
    }

    endLine();

    if (lines.length > 0) {
      paragraphs.push(lines);
    }

    return paragraphs;
  }

  /*
   * A line without the white space at its ends - a paragraph's leading
   * spaces would make it code - and without runs that are left empty.
   */
  private static trimLine(line: Array<ChatInline>): Array<ChatInline> {
    const kept: Array<ChatInline> = line.filter(
      (inline: ChatInline): boolean => {
        return inline.type === "link" || inline.text.length > 0;
      },
    );

    while (kept.length > 0) {
      const first: ChatInline = kept[0]!;

      if (first.type !== "text") {
        break;
      }

      const trimmed: string = first.text.trimStart();

      if (trimmed) {
        kept[0] = { ...first, text: trimmed };
        break;
      }

      kept.shift();
    }

    while (kept.length > 0) {
      const last: ChatInline = kept[kept.length - 1]!;

      if (last.type !== "text") {
        break;
      }

      const trimmed: string = last.text.trimEnd();

      if (trimmed) {
        kept[kept.length - 1] = { ...last, text: trimmed };
        break;
      }

      kept.pop();
    }

    return kept;
  }

  /*
   * One line: its runs one after another, each in the emphasis it had in
   * the chat, where Markdown can show it there.
   *
   * Emphasis is only read where its marker can open and close: an opening
   * "**" before punctuation needs white space or punctuation before it, a
   * closing one after punctuation the same after it ("a**(b)**c" is no
   * emphasis to a Markdown reader, and would show its asterisks). So each
   * run's emphasis is kept only where both its ends work with what is next
   * to them, and white space at a run's ends goes outside its markers. Two
   * runs' markers that would touch ("**a**" then "*b*", read as one "***")
   * get an invisible word joiner between them. A run whose emphasis cannot
   * be shown there is written as plain text: its words are kept, only the
   * styling is lost.
   */
  private static renderLine(line: Array<ChatInline>): MarkdownText {
    const pieces: Array<{ before: string; run: LineRun; after: string }> = [];

    for (const inline of ChatMessageMarkdown.mergeRuns(line)) {
      const split: {
        before: string;
        inline: ChatInline | null;
        after: string;
      } = ChatMessageMarkdown.splitOuterWhitespace(inline);

      if (!split.inline) {
        // White space alone: written as text, with no emphasis.
        pieces.push({
          before: split.before + split.after,
          run: ChatMessageMarkdown.makeRun(
            FeedMarkdown.empty(),
            "",
            undefined,
          ),
          after: "",
        });
        continue;
      }

      const inner: { markdown: MarkdownText; text: string } =
        ChatMessageMarkdown.renderInner(split.inline);

      const run: LineRun = ChatMessageMarkdown.makeRun(
        inner.markdown,
        inner.text,
        split.inline.style,
      );

      pieces.push({ before: split.before, run: run, after: split.after });
    }

    ChatMessageMarkdown.decideEmphasis(pieces);

    const values: Array<MarkdownValue> = [];

    for (const piece of pieces) {
      if (piece.before) {
        values.push(...ChatMessageMarkdown.splitTextValue(piece.before));
      }

      if (!piece.run.inner.isEmpty()) {
        if (piece.run.hasJoinerBefore) {
          values.push(FeedMarkdown.asMarkdown(WORD_JOINER));
        }

        values.push(ChatMessageMarkdown.wrap(piece.run));
      }

      if (piece.after) {
        values.push(...ChatMessageMarkdown.splitTextValue(piece.after));
      }
    }

    // The first value starts the line: a "#" or "- " typed there is text.
    return FeedMarkdown.join(values, "").trim();
  }

  /*
   * Plain text as values of at most MAX_TEXT_VALUE_LENGTH characters, cut
   * after a space where there is one: each placed as text by mdText.
   */
  private static splitTextValue(text: string): Array<MarkdownValue> {
    if (text.length <= MAX_TEXT_VALUE_LENGTH) {
      return [text];
    }

    const values: Array<MarkdownValue> = [];
    let start: number = 0;

    while (start < text.length) {
      let end: number = Math.min(start + MAX_TEXT_VALUE_LENGTH, text.length);

      if (end < text.length) {
        const space: number = text.lastIndexOf(" ", end);

        if (space > start) {
          end = space + 1;
        }
      }

      values.push(text.slice(start, end));
      start = end;
    }

    return values;
  }

  // Neighbouring runs styled alike, as one run.
  private static mergeRuns(line: Array<ChatInline>): Array<ChatInline> {
    const merged: Array<ChatInline> = [];

    for (const inline of line) {
      const previous: ChatInline | undefined = merged[merged.length - 1];

      if (
        previous &&
        previous.type === "text" &&
        inline.type === "text" &&
        ChatMessageMarkdown.isSameStyle(previous.style, inline.style)
      ) {
        merged[merged.length - 1] = {
          ...previous,
          text: previous.text + inline.text,
        };
        continue;
      }

      merged.push(inline);
    }

    return merged;
  }

  private static isSameStyle(
    a: ChatTextStyle | undefined,
    b: ChatTextStyle | undefined,
  ): boolean {
    return (
      Boolean(a?.bold) === Boolean(b?.bold) &&
      Boolean(a?.italic) === Boolean(b?.italic) &&
      Boolean(a?.strike) === Boolean(b?.strike) &&
      Boolean(a?.code) === Boolean(b?.code)
    );
  }

  /*
   * A styled text run's white space at either end, which goes outside its
   * emphasis ("**a **" is no emphasis), and the run without it - null when
   * it is all white space. Links and unstyled runs are kept whole.
   */
  private static splitOuterWhitespace(inline: ChatInline): {
    before: string;
    inline: ChatInline | null;
    after: string;
  } {
    if (inline.type !== "text" || !ChatMessageMarkdown.hasStyle(inline)) {
      return { before: "", inline: inline, after: "" };
    }

    const text: string = inline.text;
    const trimmedStart: string = text.trimStart();
    const trimmed: string = trimmedStart.trimEnd();

    if (!trimmed) {
      return { before: text, inline: null, after: "" };
    }

    return {
      before: text.slice(0, text.length - trimmedStart.length),
      inline: { ...inline, text: trimmed },
      after: trimmedStart.slice(trimmed.length),
    };
  }

  private static hasStyle(inline: ChatInline): boolean {
    return Boolean(
      inline.style &&
        (inline.style.bold ||
          inline.style.italic ||
          inline.style.strike ||
          inline.style.code),
    );
  }

  /*
   * A run as Markdown, before its emphasis: text as text, code as a code
   * span, a link as a link (an address a note may not link to is its words
   * and its address, as text).
   */
  private static renderInner(inline: ChatInline): {
    markdown: MarkdownText;
    text: string;
  } {
    if (inline.type === "text") {
      if (inline.style?.code) {
        const code: MarkdownText = FeedMarkdown.code(inline.text);
        return { markdown: code, text: code.toString() };
      }

      const text: MarkdownText = FeedMarkdown.join(
        ChatMessageMarkdown.splitTextValue(inline.text),
        "",
      );
      return { markdown: text, text: text.toString() };
    }

    const address: string | null = ChatMessageMarkdown.getLinkableAddress(
      inline.url,
    );
    const mark: string = inline.isAttachment ? ATTACHMENT_MARK : "";

    if (!address) {
      const words: string = (inline.text || "").trim();
      const url: string = (inline.url || "").trim();
      const text: MarkdownText =
        words && url && words !== url
          ? mdText`${mark}${words} (${url})`
          : mdText`${mark}${words || url}`;

      return { markdown: text, text: text.toString() };
    }

    const words: string = ChatMessageMarkdown.getLinkWords({
      url: address,
      text: inline.text,
    });

    const link: MarkdownText = inline.isAttachment
      ? mdText`${ATTACHMENT_MARK}[${words}](${address})`
      : mdText`[${words}](${address})`;

    return { markdown: link, text: link.toString() };
  }

  private static makeRun(
    inner: MarkdownText,
    innerText: string,
    style: ChatTextStyle | undefined,
  ): LineRun {
    return {
      inner: inner,
      innerText: innerText,
      strike: Boolean(style?.strike),
      stars: (style?.bold ? 2 : 0) + (style?.italic ? 1 : 0),
      isWrapped: Boolean(style?.strike) || Boolean(style?.bold || style?.italic),
      hasJoinerBefore: false,
    };
  }

  // The run in its emphasis, if it keeps it.
  private static wrap(run: LineRun): MarkdownText {
    if (!run.isWrapped) {
      return run.inner;
    }

    let markdown: MarkdownText = run.inner;

    if (run.stars === 1) {
      markdown = mdText`*${markdown}*`;
    } else if (run.stars === 2) {
      markdown = mdText`**${markdown}**`;
    } else if (run.stars === 3) {
      markdown = mdText`***${markdown}***`;
    }

    if (run.strike) {
      markdown = mdText`~~${markdown}~~`;
    }

    return markdown;
  }

  // The character a run starts or ends with, as it will be written.
  private static getEdge(run: LineRun, edge: "first" | "last"): string {
    if (run.isWrapped) {
      return run.strike ? "~" : "*";
    }

    const text: string = run.innerText;

    return edge === "first" ? text.charAt(0) : text.charAt(text.length - 1);
  }

  /*
   * Which runs keep their emphasis (see renderLine): every styled run
   * starts wrapped; one whose ends do not work where it is loses it, and
   * its neighbours are looked at again, since what is next to them changed.
   * Each run loses its emphasis at most once, so this ends.
   */
  private static decideEmphasis(
    pieces: Array<{ before: string; run: LineRun; after: string }>,
  ): void {
    const pending: Array<number> = [];

    pieces.forEach((_piece: unknown, index: number): void => {
      pending.push(index);
    });

    const characterBefore: (index: number) => string = (
      index: number,
    ): string => {
      const piece: { before: string; run: LineRun; after: string } =
        pieces[index]!;

      if (piece.before) {
        return piece.before.charAt(piece.before.length - 1);
      }

      for (let previous: number = index - 1; previous >= 0; previous--) {
        const candidate: { before: string; run: LineRun; after: string } =
          pieces[previous]!;

        if (candidate.after) {
          return candidate.after.charAt(candidate.after.length - 1);
        }

        if (!candidate.run.inner.isEmpty()) {
          return ChatMessageMarkdown.getEdge(candidate.run, "last");
        }

        if (candidate.before) {
          return candidate.before.charAt(candidate.before.length - 1);
        }
      }

      return "";
    };

    const characterAfter: (index: number) => string = (
      index: number,
    ): string => {
      const piece: { before: string; run: LineRun; after: string } =
        pieces[index]!;

      if (piece.after) {
        return piece.after.charAt(0);
      }

      for (let next: number = index + 1; next < pieces.length; next++) {
        const candidate: { before: string; run: LineRun; after: string } =
          pieces[next]!;

        if (candidate.before) {
          return candidate.before.charAt(0);
        }

        if (!candidate.run.inner.isEmpty()) {
          return candidate.run.hasJoinerBefore
            ? WORD_JOINER
            : ChatMessageMarkdown.getEdge(candidate.run, "first");
        }

        if (candidate.after) {
          return candidate.after.charAt(0);
        }
      }

      return "";
    };

    while (pending.length > 0) {
      const index: number = pending.pop()!;
      const piece: { before: string; run: LineRun; after: string } =
        pieces[index]!;
      const run: LineRun = piece.run;

      // A joiner is needed only where two markers of a kind would touch.
      const before: string = characterBefore(index);

      run.hasJoinerBefore =
        run.isWrapped &&
        !piece.before &&
        before !== "" &&
        before === ChatMessageMarkdown.getEdge(run, "first");

      if (!run.isWrapped) {
        continue;
      }

      const first: string = run.innerText.charAt(0);
      const last: string = run.innerText.charAt(run.innerText.length - 1);
      const opensHere: boolean = ChatMessageMarkdown.canOpen(
        run.hasJoinerBefore ? WORD_JOINER : before,
        first,
      );
      const closesHere: boolean = ChatMessageMarkdown.canClose(
        last,
        characterAfter(index),
      );

      if (opensHere && closesHere) {
        continue;
      }

      run.isWrapped = false;
      run.hasJoinerBefore = false;

      // What is next to the runs either side has changed: look again.
      if (index > 0) {
        pending.push(index - 1);
      }

      if (index + 1 < pieces.length) {
        pending.push(index + 1);
      }
    }
  }

  /*
   * Whether emphasis can open between `before` and the run's first
   * character `first`: the first is not white space, and when it is
   * punctuation (or a symbol), what is before is white space or
   * punctuation every reader agrees on.
   */
  private static canOpen(before: string, first: string): boolean {
    if (isWhitespace(first)) {
      return false;
    }

    if (!PUNCTUATION_OR_SYMBOL_CHARACTER.test(first)) {
      return true;
    }

    return isWhitespace(before) || PUNCTUATION_CHARACTER.test(before);
  }

  // The same for where it closes, between `last` and `after`.
  private static canClose(last: string, after: string): boolean {
    if (isWhitespace(last)) {
      return false;
    }

    if (!PUNCTUATION_OR_SYMBOL_CHARACTER.test(last)) {
      return true;
    }

    return isWhitespace(after) || PUNCTUATION_CHARACTER.test(after);
  }

  // The text without the blank lines at its ends.
  private static trimBlankLines(text: string): string {
    const lines: Array<string> = text.split("\n");

    while (lines.length > 0 && !lines[0]!.trim()) {
      lines.shift();
    }

    while (lines.length > 0 && !lines[lines.length - 1]!.trim()) {
      lines.pop();
    }

    return lines.join("\n");
  }
}
