import { Lexer, Token, Tokens } from "marked";
import {
  WorkspaceMessageBlock,
  WorkspacePayloadHeader,
  WorkspacePayloadMarkdown,
} from "../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceMessageTime from "./WorkspaceMessageTime";

/*
 * WHAT A NOTIFICATION OF A MESSAGE SAYS.
 *
 * A message OneUptime posts to Slack or Microsoft Teams is drawn from blocks,
 * and the phone or desktop notification for it shows none of them: it shows
 * Slack's top-level `text`, or the Teams card's `summary`
 * (WorkspaceMessagePayload.text). Without it, a new incident in its own
 * channel buzzed phones with nothing to read - "OneUptime: This content
 * can't be displayed", or "OneUptime sent a card".
 *
 * Messages that know what to say set it themselves (the on-call run
 * message, its alarms). Every other post - an incident created, a state
 * changed, a note, an owner added - says the start of what it shows, on one
 * line:
 *
 *   #### 🚨 Incident INC-8 Created:      ->  🚨 Incident INC-8 Created: Checkout is down
 *   **Checkout is down**:
 *   No description provided.
 *
 *   @nitin 📄 posted **private note**    ->  @nitin 📄 posted private note for this
 *   for this [Incident INC-8](...):          Incident INC-8: Rolled back the deploy.
 *   Rolled back the deploy.
 *
 * The first paragraph, and the one after it when the first ends with a
 * colon - it introduces it - read as text: links by their words, no
 * Markdown, moments in UTC (WorkspaceMessageTime.toPlainText), cut at a
 * word near MAX_LENGTH characters. Only the start of a message is read
 * (MAX_MARKDOWN_READ), so a long message costs no more than a short one.
 */

const ELLIPSIS: string = "…";

export interface WorkspaceNotificationTextOptions {
  /*
   * The first paragraph is a headline for the second - "🚨 New incident
   * assigned to you", then the incident - so the notification says both:
   * "🚨 New incident assigned to you: INC-8 — Checkout is down".
   */
  isFirstParagraphAHeadline?: boolean | undefined;
}

const WHITESPACE_RUN: RegExp = /\s+/g;

export default class WorkspaceNotificationText {
  // The longest notification line; a phone shows less anyway.
  public static readonly MAX_LENGTH: number = 200;

  /*
   * How much of a message is read for its notification: its start is all
   * a notification shows, and the Markdown lexer is given no more.
   */
  public static readonly MAX_MARKDOWN_READ: number = 4000;

  /*
   * The notification of a message made of `blocks`: from its header, or its
   * first Markdown block. Undefined when it has neither, or says nothing.
   */
  public static fromBlocks(
    blocks: Array<WorkspaceMessageBlock> | undefined,
    options?: WorkspaceNotificationTextOptions | undefined,
  ): string | undefined {
    for (const block of blocks || []) {
      if (block._type === "WorkspacePayloadHeader") {
        const text: string = WorkspaceNotificationText.fromMarkdown(
          (block as WorkspacePayloadHeader).text || "",
        );

        if (text) {
          return text;
        }
      }

      if (block._type === "WorkspacePayloadMarkdown") {
        const text: string = WorkspaceNotificationText.fromMarkdown(
          (block as WorkspacePayloadMarkdown).text || "",
          options,
        );

        if (text) {
          return text;
        }
      }
    }

    return undefined;
  }

  // The notification of a message written in Markdown (see the header).
  public static fromMarkdown(
    markdown: string,
    options?: WorkspaceNotificationTextOptions | undefined,
  ): string {
    if (!markdown) {
      return "";
    }

    const paragraphs: Array<string> = WorkspaceNotificationText.getParagraphs(
      markdown.substring(0, WorkspaceNotificationText.MAX_MARKDOWN_READ),
    );

    if (paragraphs.length === 0) {
      return "";
    }

    let line: string = paragraphs[0]!;

    // "Incident INC-8 Created:" introduces what follows it: say both.
    if (paragraphs.length > 1) {
      if (line.endsWith(":")) {
        line = `${line} ${paragraphs[1]!}`;
      } else if (options?.isFirstParagraphAHeadline) {
        line = `${line}: ${paragraphs[1]!}`;
      }
    }

    return WorkspaceNotificationText.cut(
      WorkspaceNotificationText.withoutTrailingColon(
        WorkspaceMessageTime.toPlainText(line),
      ),
    );
  }

  /*
   * The text of each block of the Markdown that holds any - headings,
   * paragraphs, list items, quotes - in order, each on one line.
   */
  private static getParagraphs(markdown: string): Array<string> {
    let tokens: Array<Token>;

    try {
      tokens = new Lexer({ gfm: true, breaks: false, pedantic: false }).lex(
        markdown,
      );
    } catch {
      // Text the lexer cannot read is read as one paragraph of text.
      return [WorkspaceNotificationText.oneLine(markdown)].filter(
        (text: string): boolean => {
          return Boolean(text);
        },
      );
    }

    const paragraphs: Array<string> = [];

    WorkspaceNotificationText.collectBlocks(tokens, paragraphs);

    return paragraphs;
  }

  private static collectBlocks(
    tokens: Array<Token>,
    paragraphs: Array<string>,
  ): void {
    for (const token of tokens) {
      // Two are all a notification uses.
      if (paragraphs.length >= 2) {
        return;
      }

      switch (token.type) {
        case "heading":
        case "paragraph":
        case "text": {
          const inline: Array<Token> | undefined = (
            token as Tokens.Heading | Tokens.Paragraph | Tokens.Text
          ).tokens;
          const text: string = WorkspaceNotificationText.oneLine(
            inline
              ? WorkspaceNotificationText.inlineText(inline)
              : (token as Tokens.Text).text || "",
          );

          if (text) {
            paragraphs.push(text);
          }
          break;
        }
        case "list":
          for (const item of (token as Tokens.List).items) {
            WorkspaceNotificationText.collectBlocks(item.tokens, paragraphs);
          }
          break;
        case "blockquote":
          WorkspaceNotificationText.collectBlocks(
            (token as Tokens.Blockquote).tokens,
            paragraphs,
          );
          break;
        default:
          // Code, tables, rules and HTML say nothing a notification needs.
          break;
      }
    }
  }

  // The words of inline Markdown: a link by its text, an image by its alt.
  private static inlineText(tokens: Array<Token>): string {
    let text: string = "";

    for (const token of tokens) {
      const children: Array<Token> | undefined = (
        token as { tokens?: Array<Token> }
      ).tokens;

      switch (token.type) {
        case "br":
          text += " ";
          break;
        case "image":
          text += (token as Tokens.Image).text || "";
          break;
        case "html":
          // A tag is not words; an entity's text is.
          break;
        case "codespan":
          text += WorkspaceNotificationText.decodeEntities(
            (token as Tokens.Codespan).text,
          );
          break;
        case "escape":
          // The lexer writes an escaped "<" as "&lt;".
          text += WorkspaceNotificationText.decodeEntities(
            (token as Tokens.Escape).text,
          );
          break;
        default:
          text +=
            children && children.length > 0
              ? WorkspaceNotificationText.inlineText(children)
              : WorkspaceNotificationText.decodeEntities(
                  (token as { text?: string }).text || "",
                );
      }
    }

    return text;
  }

  /*
   * The few entities the lexer leaves in text it read: "&amp;", "&lt;",
   * "&gt;", "&quot;" and "&#39;". One walk.
   */
  private static decodeEntities(text: string): string {
    if (text.indexOf("&") === -1) {
      return text;
    }

    const entities: Record<string, string> = {
      "&amp;": "&",
      "&lt;": "<",
      "&gt;": ">",
      "&quot;": '"',
      "&#39;": "'",
    };

    let decoded: string = "";
    let index: number = 0;

    while (index < text.length) {
      const ampersand: number = text.indexOf("&", index);

      if (ampersand === -1) {
        decoded += text.substring(index);
        break;
      }

      decoded += text.substring(index, ampersand);

      let replaced: boolean = false;

      for (const entity of Object.keys(entities)) {
        if (text.startsWith(entity, ampersand)) {
          decoded += entities[entity];
          index = ampersand + entity.length;
          replaced = true;
          break;
        }
      }

      if (!replaced) {
        decoded += "&";
        index = ampersand + 1;
      }
    }

    return decoded;
  }

  private static oneLine(text: string): string {
    return text.replace(WHITESPACE_RUN, " ").trim();
  }

  private static withoutTrailingColon(text: string): string {
    let end: number = text.length;

    while (end > 0 && (text.charAt(end - 1) === ":" || text.charAt(end - 1) === " ")) {
      end--;
    }

    return text.substring(0, end);
  }

  // Cut at the last space before MAX_LENGTH, with an ellipsis.
  private static cut(text: string): string {
    if (text.length <= WorkspaceNotificationText.MAX_LENGTH) {
      return text;
    }

    const room: number = WorkspaceNotificationText.MAX_LENGTH - 1;
    const lastSpace: number = text.lastIndexOf(" ", room);
    const cutAt: number = lastSpace > room / 2 ? lastSpace : room;

    // Never between the two halves of an emoji.
    const code: number = text.charCodeAt(cutAt - 1);
    const safeCutAt: number =
      code >= 0xd800 && code <= 0xdbff ? cutAt - 1 : cutAt;

    return `${text.substring(0, safeCutAt).trimEnd()}${ELLIPSIS}`;
  }
}
