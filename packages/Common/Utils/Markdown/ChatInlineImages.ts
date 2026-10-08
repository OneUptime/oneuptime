import { InlineImageDataUri } from "./InlineImageDataUri";
import { escapeMarkdownInline } from "./MarkdownEscape";
import MarkdownDataUrls, {
  DataUrlUse,
  DataUrlUseKind,
  LinkDefinition,
  MarkdownDataUrlUses,
  ParagraphLine,
} from "./MarkdownDataUrls";

/*
 * IMAGES THAT CARRY THEMSELVES, IN A SLACK OR MICROSOFT TEAMS MESSAGE.
 *
 * A synthetic monitor's screenshot reaches an incident's or an alert's
 * description as an image whose address is the image itself (see
 * InlineImageDataUri):
 *
 *   Timeout 30000ms exceeded
 *   ![Login page](data:image/png;base64,iVBORw0KGgo...)
 *
 * The dashboard and the emails show it. The same Markdown is posted to Slack
 * and Microsoft Teams, which cannot show a data: URL: Slack's conversion
 * turned the image into a link to one, <data:image/png;base64,...|Login
 * page>, 30 KB to 2 MB of base64 that filled the message's sections and was
 * cut short, and a Teams message that size is refused outright.
 *
 * So a chat message gets the screenshot as an image of its own, where the
 * description had it, and never its base64 as text. Whatever reads the
 * Markdown for a chat calls one of two things here:
 *
 *   - split: the text in pieces, and each inline raster image as a piece of
 *     its own between them, for a message that can show images. An image
 *     alone on a line of a paragraph (the way a template writes one) takes
 *     that line's place, with the text before and after it around it; any
 *     other image - mid-sentence, in a list, a quote or a table - leaves its
 *     alt text where it was and is shown after the top-level block it was in.
 *     Each image piece carries the Markdown to show instead of it when the
 *     chat cannot show it after all: its alt text, or "[image]" when it has
 *     none.
 *
 *   - toText: the text alone, every such image replaced by its alt text, for
 *     a message that cannot show one (an incoming webhook, a text reply).
 *
 * Either way, images and links whose address is any other data: URL (an
 * SVG, a file) become their alt text or their text, a link reference
 * definition to one goes, and an autolink to an image becomes "[image]" -
 * no chat can open a data: URL, and its base64 would only fill the message.
 * Everything else - code spans and code blocks above all, byte for byte,
 * and https images, which chats show by themselves - stays as it was.
 *
 * Which images, links and definitions there are, and where, is read the way
 * the dashboard's Markdown parser reads them (MarkdownDataUrls), in time
 * linear in the length of the text, megabytes of base64 included.
 *
 * Pure, with no Node or browser APIs.
 */

// What stands for an image with no alt text that cannot be shown.
export const CHAT_IMAGE_PLACEHOLDER: string = "[image]";

export enum ChatMarkdownPieceKind {
  Markdown = "Markdown",
  Image = "Image",
}

export interface ChatMarkdownText {
  kind: ChatMarkdownPieceKind.Markdown;
  markdown: string;
}

export interface ChatInlineImage {
  kind: ChatMarkdownPieceKind.Image;
  // The image, as checked: what its bytes are, and its base64.
  image: InlineImageDataUri;
  // Its alt text as plain text; empty when it has none.
  altText: string;
  /*
   * Markdown to show in its place when it cannot be shown: its alt text, or
   * "[image]". Empty when its alt text already reads in the text before it.
   */
  fallbackMarkdown: string;
}

export type ChatMarkdownPiece = ChatMarkdownText | ChatInlineImage;

export interface ChatMarkdownSplit {
  // The text and the images, in the order they read.
  pieces: Array<ChatMarkdownPiece>;
  /*
   * The text's link reference definitions, one per line. They are not in
   * the pieces - a piece of nothing but definitions would be shown as text
   * by Slack's conversion - so a converter that reads each piece on its own
   * places them before it, where they resolve its [text][label] links
   * without showing. Empty when there are none.
   */
  linkDefinitionsMarkdown: string;
}

// A change to the text: what goes in place of [start, end).
interface Edit {
  start: number;
  end: number;
  replacement: string;
}

// A line of a paragraph that holds images and nothing else.
interface ImageLine {
  line: ParagraphLine;
  // Its images, in order, raster or not.
  images: Array<DataUrlUse>;
}

const PLACEHOLDER_MARKDOWN: string = escapeMarkdownInline(
  CHAT_IMAGE_PLACEHOLDER,
);

const DATA_IMAGE_URL_PATTERN: RegExp = /^data:image\//i;

// What else could restyle text: strikethrough and a setext underline.
const MORE_SPECIAL_CHARACTERS_PATTERN: RegExp = /[~=]/g;

// A number that would start an ordered list: "1." or "1)" first.
const ORDERED_LIST_START_PATTERN: RegExp = /^(\d{1,9})([.)])/;

// An odd number of backslashes at the end: a hard line break's.
const TRAILING_HARD_BREAK_PATTERN: RegExp = /(?:^|[^\\])(?:\\\\)*\\$/;

const SPACE_OR_TAB_ONLY_PATTERN: RegExp = /^[ \t]*$/;

const LINE_BREAK_PATTERN: RegExp = /[\r\n]+/g;

type ChatTextFunction = (text: string) => string;

/*
 * Plain text as Markdown that reads exactly as it was typed, wherever it is
 * placed: in a sentence, at the start of a line, in a table cell. No mention
 * in it reaches Slack.
 */
const toChatText: ChatTextFunction = (text: string): string => {
  return escapeMarkdownInline(text)
    .replace(MORE_SPECIAL_CHARACTERS_PATTERN, (character: string): string => {
      return `\\${character}`;
    })
    .replace(ORDERED_LIST_START_PATTERN, "$1\\$2");
};

export default class ChatInlineImages {
  // Whether the Markdown could hold anything this changes - a quick check.
  public static mayHaveInlineImages(
    markdown: string | null | undefined,
  ): boolean {
    return MarkdownDataUrls.mayHaveDataUrl(markdown);
  }

  /**
   * The Markdown with every image whose address is a data: URL replaced by
   * its alt text (or "[image]"), and the rest of what is described above.
   * Markdown without any comes back exactly as it was.
   */
  public static toText(markdown: string | null | undefined): string {
    const text: string = markdown || "";

    if (!ChatInlineImages.mayHaveInlineImages(text)) {
      return text;
    }

    const found: MarkdownDataUrlUses = MarkdownDataUrls.find(text);

    if (found.uses.length === 0) {
      return text;
    }

    return ChatInlineImages.applyEdits({
      source: text,
      edits: ChatInlineImages.getEdits(found.uses, new Set<DataUrlUse>()),
      start: 0,
      end: text.length,
    });
  }

  /**
   * The Markdown in pieces of text and images, in the order they read (see
   * above). Markdown with no inline raster image is one piece: toText's.
   */
  public static split(markdown: string | null | undefined): ChatMarkdownSplit {
    const text: string = markdown || "";
    const found: MarkdownDataUrlUses = ChatInlineImages.mayHaveInlineImages(
      text,
    )
      ? MarkdownDataUrls.find(text)
      : { uses: [], linkDefinitions: [] };

    const imageLines: Array<ImageLine> = ChatInlineImages.getImageLines(
      found.uses,
      text,
    );
    const standalone: Set<DataUrlUse> = new Set<DataUrlUse>();

    for (const imageLine of imageLines) {
      for (const image of imageLine.images) {
        standalone.add(image);
      }
    }

    const shownAfterBlock: Array<DataUrlUse> =
      ChatInlineImages.getImagesShownAfterTheirBlock(found.uses, standalone);

    if (imageLines.length === 0 && shownAfterBlock.length === 0) {
      return {
        pieces: ChatInlineImages.withText([], ChatInlineImages.toText(text)),
        linkDefinitionsMarkdown: "",
      };
    }

    const edits: Array<Edit> = ChatInlineImages.withDefinitionsRemoved(
      ChatInlineImages.getEdits(found.uses, standalone),
      found.linkDefinitions,
    );
    const pieces: Array<ChatMarkdownPiece> = [];
    let cursor: number = 0;
    let afterBlockIndex: number = 0;

    // Shows every image waiting for a place that starts before `position`.
    const showWaitingImages: (position: number) => void = (
      position: number,
    ): void => {
      while (
        afterBlockIndex < shownAfterBlock.length &&
        shownAfterBlock[afterBlockIndex]!.start < position
      ) {
        pieces.push(
          ChatInlineImages.toImagePiece(shownAfterBlock[afterBlockIndex]!, ""),
        );
        afterBlockIndex++;
      }
    };

    const textUpTo: (end: number) => string = (end: number): string => {
      return ChatInlineImages.applyEdits({
        source: text,
        edits: edits,
        start: cursor,
        end: Math.max(cursor, end),
      });
    };

    // Where text ends and images are shown, in the order they come.
    const stops: Array<{ position: number; imageLine: ImageLine | null }> = [];

    for (const imageLine of imageLines) {
      stops.push({ position: imageLine.line.start, imageLine: imageLine });
    }

    for (const image of shownAfterBlock) {
      stops.push({ position: image.topLevelBlockEnd, imageLine: null });
    }

    stops.sort(
      (
        first: { position: number; imageLine: ImageLine | null },
        second: { position: number; imageLine: ImageLine | null },
      ): number => {
        return first.position - second.position;
      },
    );

    for (const stop of stops) {
      if (stop.position < cursor) {
        continue;
      }

      if (!stop.imageLine) {
        ChatInlineImages.withText(pieces, textUpTo(stop.position));
        cursor = stop.position;
        showWaitingImages(cursor);
        continue;
      }

      const line: ParagraphLine = stop.imageLine.line;

      ChatInlineImages.withText(
        pieces,
        ChatInlineImages.withoutTrailingHardBreak(
          textUpTo(
            line.previousLineEnd === null ? line.start : line.previousLineEnd,
          ),
        ),
      );
      showWaitingImages(line.start);

      for (const image of stop.imageLine.images) {
        const fallbackMarkdown: string =
          toChatText(image.text) || PLACEHOLDER_MARKDOWN;

        if (image.image) {
          pieces.push(ChatInlineImages.toImagePiece(image, fallbackMarkdown));
        } else {
          ChatInlineImages.withText(pieces, fallbackMarkdown);
        }
      }

      cursor = line.nextLineStart === null ? line.end : line.nextLineStart;
    }

    ChatInlineImages.withText(pieces, textUpTo(text.length));
    showWaitingImages(Infinity);

    return {
      pieces: pieces,
      linkDefinitionsMarkdown: found.linkDefinitions
        .map((definition: LinkDefinition): string => {
          return `[${definition.label.replace(LINE_BREAK_PATTERN, " ")}]: ${definition.destination}`;
        })
        .join("\n"),
    };
  }

  /*
   * The lines of top-level paragraphs that hold images and nothing else but
   * spaces, at least one of them an inline raster image: each such line
   * becomes its images. Not when the line after it, read where a text
   * starts, would start a list, a table or the like that it is not in the
   * paragraph: the text after the images could not start a piece of its own
   * as it is.
   */
  private static getImageLines(
    uses: Array<DataUrlUse>,
    source: string,
  ): Array<ImageLine> {
    const imageLines: Array<ImageLine> = [];
    const outermost: Array<DataUrlUse> = ChatInlineImages.getOutermost(uses);
    let index: number = 0;

    while (index < outermost.length) {
      const first: DataUrlUse = outermost[index]!;
      const line: ParagraphLine | null = first.paragraphLine;
      let next: number = index + 1;

      while (
        next < outermost.length &&
        line !== null &&
        outermost[next]!.paragraphLine !== null &&
        outermost[next]!.paragraphLine!.start === line.start
      ) {
        next++;
      }

      const onLine: Array<DataUrlUse> = outermost.slice(index, next);

      index = next;

      if (
        line === null ||
        line.nextLineStartsBlock ||
        !onLine.some((use: DataUrlUse): boolean => {
          return use.kind === DataUrlUseKind.Image && use.image !== null;
        }) ||
        !onLine.every((use: DataUrlUse): boolean => {
          return use.kind === DataUrlUseKind.Image && use.end <= line.end;
        })
      ) {
        continue;
      }

      imageLines.push({ line: line, images: onLine });
    }

    return imageLines.filter((imageLine: ImageLine): boolean => {
      return ChatInlineImages.isOnlyImages(imageLine, source);
    });
  }

  // Whether nothing but spaces and tabs is on the line around its images.
  private static isOnlyImages(imageLine: ImageLine, source: string): boolean {
    let position: number = imageLine.line.start;

    for (const image of imageLine.images) {
      if (
        !SPACE_OR_TAB_ONLY_PATTERN.test(source.slice(position, image.start))
      ) {
        return false;
      }

      position = image.end;
    }

    return SPACE_OR_TAB_ONLY_PATTERN.test(
      source.slice(position, imageLine.line.end),
    );
  }

  /*
   * The inline raster images shown after the top-level block they were in:
   * every one that is not alone on its line, and not part of another
   * image's alt text (which shows no image of its own).
   */
  private static getImagesShownAfterTheirBlock(
    uses: Array<DataUrlUse>,
    standalone: Set<DataUrlUse>,
  ): Array<DataUrlUse> {
    const images: Array<DataUrlUse> = [];
    const open: Array<DataUrlUse> = [];

    for (const use of uses) {
      while (open.length > 0 && open[open.length - 1]!.end <= use.start) {
        open.pop();
      }

      const isInsideImage: boolean = open.some(
        (ancestor: DataUrlUse): boolean => {
          return ancestor.kind === DataUrlUseKind.Image;
        },
      );

      if (
        use.kind === DataUrlUseKind.Image &&
        use.image !== null &&
        !isInsideImage &&
        !standalone.has(use)
      ) {
        images.push(use);
      }

      open.push(use);
    }

    return images;
  }

  /*
   * What the text gets in place of each outermost use: an image its alt
   * text (or "[image]"), a link its text, a definition nothing, an autolink
   * to an image "[image]". A use inside another one is part of that one's
   * text already. Images alone on their line are left to `split`.
   */
  private static getEdits(
    uses: Array<DataUrlUse>,
    standalone: Set<DataUrlUse>,
  ): Array<Edit> {
    const edits: Array<Edit> = [];

    for (const use of ChatInlineImages.getOutermost(uses)) {
      switch (use.kind) {
        case DataUrlUseKind.Image:
          if (!standalone.has(use)) {
            edits.push({
              start: use.start,
              end: use.end,
              replacement: toChatText(use.text) || PLACEHOLDER_MARKDOWN,
            });
          }
          break;
        case DataUrlUseKind.Link:
          edits.push({
            start: use.start,
            end: use.end,
            replacement: toChatText(use.text),
          });
          break;
        case DataUrlUseKind.Autolink:
          if (DATA_IMAGE_URL_PATTERN.test(use.url)) {
            edits.push({
              start: use.start,
              end: use.end,
              replacement: PLACEHOLDER_MARKDOWN,
            });
          }
          break;
        default:
          edits.push({ start: use.start, end: use.end, replacement: "" });
          break;
      }
    }

    return edits;
  }

  // The edits, and the removal of every other link reference definition.
  private static withDefinitionsRemoved(
    edits: Array<Edit>,
    definitions: Array<LinkDefinition>,
  ): Array<Edit> {
    if (definitions.length === 0) {
      return edits;
    }

    return edits
      .concat(
        definitions.map((definition: LinkDefinition): Edit => {
          return {
            start: definition.start,
            end: definition.end,
            replacement: "",
          };
        }),
      )
      .sort((first: Edit, second: Edit): number => {
        return first.start - second.start;
      });
  }

  // The uses that are not inside another one, in order.
  private static getOutermost(uses: Array<DataUrlUse>): Array<DataUrlUse> {
    const outermost: Array<DataUrlUse> = [];
    let coveredUntil: number = -1;

    for (const use of uses) {
      if (use.start >= coveredUntil) {
        outermost.push(use);
        coveredUntil = use.end;
      }
    }

    return outermost;
  }

  // The text from `start` to `end`, with the edits inside it made.
  private static applyEdits(data: {
    source: string;
    edits: Array<Edit>;
    start: number;
    end: number;
  }): string {
    let result: string = "";
    let position: number = data.start;

    for (const edit of ChatInlineImages.editsWithin(data)) {
      result += data.source.slice(position, edit.start) + edit.replacement;
      position = edit.end;
    }

    return result + data.source.slice(position, data.end);
  }

  private static editsWithin(data: {
    edits: Array<Edit>;
    start: number;
    end: number;
  }): Array<Edit> {
    let low: number = 0;
    let high: number = data.edits.length;

    while (low < high) {
      const middle: number = (low + high) >> 1;

      if (data.edits[middle]!.start < data.start) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }

    const within: Array<Edit> = [];

    for (
      let index: number = low;
      index < data.edits.length && data.edits[index]!.end <= data.end;
      index++
    ) {
      within.push(data.edits[index]!);
    }

    return within;
  }

  /*
   * A piece's last line break, when it was a backslash's, would be read as
   * a backslash at its end: the backslash goes.
   */
  private static withoutTrailingHardBreak(text: string): string {
    const trimmed: string = text.replace(/[ \t]+$/, "");

    return TRAILING_HARD_BREAK_PATTERN.test(trimmed)
      ? trimmed.slice(0, -1)
      : text;
  }

  private static toImagePiece(
    use: DataUrlUse,
    fallbackMarkdown: string,
  ): ChatInlineImage {
    return {
      kind: ChatMarkdownPieceKind.Image,
      image: use.image!,
      altText: use.text,
      fallbackMarkdown: fallbackMarkdown,
    };
  }

  /*
   * Adds text to the pieces: to the last one when that is text too, and not
   * at all when there is nothing in it to read.
   */
  private static withText(
    pieces: Array<ChatMarkdownPiece>,
    markdown: string,
  ): Array<ChatMarkdownPiece> {
    if (!markdown.trim()) {
      return pieces;
    }

    const last: ChatMarkdownPiece | undefined = pieces[pieces.length - 1];

    if (last && last.kind === ChatMarkdownPieceKind.Markdown) {
      last.markdown += `\n\n${markdown}`;
    } else {
      pieces.push({ kind: ChatMarkdownPieceKind.Markdown, markdown: markdown });
    }

    return pieces;
  }
}
