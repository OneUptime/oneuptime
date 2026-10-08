import { randomUUID } from "crypto";
import {
  InlineImageDataUri,
  parseInlineImageDataUri,
} from "../../../Utils/Markdown/InlineImageDataUri";

/*
 * INLINE IMAGES GO OUT AS ATTACHMENTS THE HTML POINTS AT.
 *
 * The email renderer writes a screenshot in a description as the data: URL
 * it was written as (see Utils/Markdown/InlineImageDataUri). A data: URL in
 * an email's HTML is shown by Apple Mail and Thunderbird, but not by Gmail
 * or Outlook, and it makes the HTML as large as the image: Gmail clips an
 * HTML body over about 100 KB behind "View entire message", which a single
 * screenshot is, taking the rest of the email - the Acknowledge button
 * included - with it.
 *
 * So just before an email is sent, every <img> whose src is an inline raster
 * image becomes an attachment with a Content-ID, and the src becomes
 * "cid:" and that id (RFC 2392). Every mail client shows those, and the HTML
 * keeps its size. The same image twice is attached once.
 *
 * An email has to stay deliverable, so what it carries is capped: Microsoft
 * Graph refuses a sendMail request over 4 MB, and base64 adds a third. An
 * image that does not fit - more than MaxEmailInlineImageBytes in all, or
 * more than MaxEmailInlineImageCount images - is replaced by a short note
 * with its alt text, so the reader knows there was one. Nothing else in the
 * HTML is touched, and an <img> whose src is anything else - an https image,
 * or a data: URL that is not an inline raster image - is left as it is.
 *
 * Only images reach here that the email's own HTML holds: the renderer's,
 * and those a project's custom email template writes. Raw HTML in Markdown
 * is escaped by the renderer, and a value placed into a template is escaped
 * unless it is HTML this code made.
 */

// Decoded bytes, across every image in one email.
export const MaxEmailInlineImageBytes: number = 2 * 1024 * 1024;

export const MaxEmailInlineImageCount: number = 20;

export interface EmailInlineImage {
  // The id the HTML points at as "cid:<contentId>", without angle brackets.
  contentId: string;
  fileName: string;
  mimeType: string;
  // The image's bytes, as base64.
  base64: string;
  byteLength: number;
}

export interface EmailHtmlWithInlineImages {
  html: string;
  inlineImages: Array<EmailInlineImage>;
}

export interface EmailInlineImageLimits {
  maxTotalBytes?: number | undefined;
  maxCount?: number | undefined;
}

/*
 * An <img> tag. Neither "<" nor ">" can be inside one in the renderer's
 * output, where attribute values are escaped, and leaving both out keeps the
 * search linear: no tag can run on past the next one.
 */
const IMAGE_TAG_PATTERN: RegExp = /<img\b[^<>]*>/gi;

/*
 * One attribute in a tag: its name, then a double-quoted, single-quoted or
 * unquoted value, if it has one. An unquoted value runs to the next space or
 * the end of the tag, as a browser reads it.
 */
const ATTRIBUTE_PATTERN: RegExp =
  /\s([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

const DATA_URL_PATTERN: RegExp = /^data:/i;

// Whether a body could hold an inline image at all, before any tag is read.
const IMAGE_TAG_START_PATTERN: RegExp = /<img\b/i;
const DATA_URL_ANYWHERE_PATTERN: RegExp = /data:/i;

interface TagAttribute {
  value: string;
  // Where the value starts and ends within the tag, quotes excluded.
  valueStart: number;
  valueEnd: number;
}

// The first attribute named `name` in `tag` - the one HTML reads.
const findAttribute: (tag: string, name: string) => TagAttribute | null = (
  tag: string,
  name: string,
): TagAttribute | null => {
  const pattern: RegExp = new RegExp(ATTRIBUTE_PATTERN.source, "g");
  // Past "<img", so the tag's own name is not read as an attribute.
  pattern.lastIndex = "<img".length;

  for (
    let match: RegExpExecArray | null = pattern.exec(tag);
    match !== null;
    match = pattern.exec(tag)
  ) {
    if (match[1]!.toLowerCase() !== name) {
      continue;
    }

    const matchEnd: number = match.index + match[0].length;

    if (match[2] === undefined && match[3] === undefined) {
      // Unquoted, or no value at all ("<img src>").
      const value: string = match[4] ?? "";

      return {
        value: value,
        valueStart: matchEnd - value.length,
        valueEnd: matchEnd,
      };
    }

    // Quoted: the value ends just before the closing quote.
    const value: string = match[2] ?? match[3] ?? "";

    return {
      value: value,
      valueStart: matchEnd - 1 - value.length,
      valueEnd: matchEnd - 1,
    };
  }

  return null;
};

/*
 * What an image that did not fit becomes: its alt text, and why it is not
 * there. The alt text is escaped as an attribute value is, which is escaped
 * enough to be text. A tag found here holds no "<" or ">" (see
 * IMAGE_TAG_PATTERN); both are escaped anyway, so the note can never become
 * markup even if that changes.
 */
const getLeftOutImageNotice: (altText: string) => string = (
  altText: string,
): string => {
  const alt: string = altText
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .trim();

  const notice: string = alt
    ? `${alt}: image too large to include in this email`
    : "Image too large to include in this email";

  return `<span style="color:#64748b;font-style:italic;">[${notice}]</span>`;
};

export default class EmailInlineImages {
  /**
   * `html` with every inline raster image an <img> holds moved into an
   * attachment it points at by Content-ID (see above), and those attachments.
   * HTML with no such image comes back exactly as it was, with none.
   */
  public static attach(
    html: string,
    limits?: EmailInlineImageLimits | undefined,
  ): EmailHtmlWithInlineImages {
    if (
      !html ||
      !IMAGE_TAG_START_PATTERN.test(html) ||
      !DATA_URL_ANYWHERE_PATTERN.test(html)
    ) {
      return { html: html, inlineImages: [] };
    }

    const maxTotalBytes: number =
      limits?.maxTotalBytes ?? MaxEmailInlineImageBytes;
    const maxCount: number = limits?.maxCount ?? MaxEmailInlineImageCount;

    const inlineImages: Array<EmailInlineImage> = [];
    const contentIdsByData: Map<string, string> = new Map<string, string>();
    let totalBytes: number = 0;

    const attachedHtml: string = html.replace(
      IMAGE_TAG_PATTERN,
      (tag: string): string => {
        const source: TagAttribute | null = findAttribute(tag, "src");

        if (!source || !DATA_URL_PATTERN.test(source.value)) {
          return tag;
        }

        const image: InlineImageDataUri | null = parseInlineImageDataUri(
          source.value,
        );

        if (!image) {
          return tag;
        }

        let contentId: string | undefined = contentIdsByData.get(image.base64);

        if (contentId === undefined) {
          if (
            inlineImages.length >= maxCount ||
            totalBytes + image.byteLength > maxTotalBytes
          ) {
            return getLeftOutImageNotice(
              findAttribute(tag, "alt")?.value || "",
            );
          }

          contentId = `${randomUUID()}@oneuptime`;
          contentIdsByData.set(image.base64, contentId);
          totalBytes += image.byteLength;

          inlineImages.push({
            contentId: contentId,
            fileName: `image-${inlineImages.length + 1}.${image.fileExtension}`,
            mimeType: image.mimeType,
            base64: image.base64,
            byteLength: image.byteLength,
          });
        }

        return (
          tag.slice(0, source.valueStart) +
          `cid:${contentId}` +
          tag.slice(source.valueEnd)
        );
      },
    );

    return { html: attachedHtml, inlineImages: inlineImages };
  }
}
