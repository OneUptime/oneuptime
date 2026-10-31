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
 *
 * The email's own images - OneUptime's logo in its header (EmailLogo), and
 * a logo an operator uploaded that it carries in place of the logo's
 * address (EmailCarriedLogos) - go out the same way, through attachImage:
 * under a name of their own, outside the limits above, and never replaced
 * by a note.
 *
 * A mail service can still refuse an email for its images (MailService:
 * InlineImageRefusal). The email then goes once more without any: leaveOut
 * replaces each image a text placed with a note of the same kind, and the
 * header is rendered without the logo, showing the product's name alone.
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

// One image of the email's own, and the name its attachment goes by.
export interface EmailOwnImage {
  // An inline raster image's data: URL (parseInlineImageDataUri).
  dataUri: string;
  fileName: string;
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

// Why an image is not in an email, as its note says it.
const TOO_LARGE_REASON: string = "too large to include in this email";
const NOT_TAKEN_REASON: string = "could not be included in this email";

/*
 * What an image left out of an email becomes: its alt text, and why it is
 * not there - it did not fit (attach), or the mail service would not take
 * it (leaveOut). The alt text is escaped as an attribute value is, which is
 * escaped enough to be text. A tag found here holds no "<" or ">" (see
 * IMAGE_TAG_PATTERN); both are escaped anyway, so the note can never become
 * markup even if that changes.
 */
const getLeftOutImageNotice: (altText: string, reason: string) => string = (
  altText: string,
  reason: string,
): string => {
  const alt: string = altText
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .trim();

  const notice: string = alt ? `${alt}: image ${reason}` : `Image ${reason}`;

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
              TOO_LARGE_REASON,
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

  /**
   * `html` with every inline raster image an <img> holds - each image
   * attach() would move into an attachment - replaced by a note with its
   * alt text, saying it could not be included: the email as it goes when a
   * mail service would not take its images (MailService). Everything else
   * is left as it is, and HTML with no such image comes back exactly as it
   * was.
   */
  public static leaveOut(html: string): string {
    if (
      !html ||
      !IMAGE_TAG_START_PATTERN.test(html) ||
      !DATA_URL_ANYWHERE_PATTERN.test(html)
    ) {
      return html;
    }

    return html.replace(IMAGE_TAG_PATTERN, (tag: string): string => {
      const source: TagAttribute | null = findAttribute(tag, "src");

      if (
        !source ||
        !DATA_URL_PATTERN.test(source.value) ||
        !parseInlineImageDataUri(source.value)
      ) {
        return tag;
      }

      return getLeftOutImageNotice(
        findAttribute(tag, "alt")?.value || "",
        NOT_TAKEN_REASON,
      );
    });
  }

  /**
   * `html` with the src of every <img> that `replace` answers for written
   * as its answer, and every other tag as it was. `replace` is handed each
   * src exactly as it is written - its character references not decoded -
   * and answers null to leave the tag alone. The answer goes into the
   * attribute as it is, so it must be a value an attribute holds as it is:
   * an inline image's data: URL (InlineImageDataUri writes nothing else).
   * HTML with no <img> comes back exactly as it was. For the images an
   * email carries in place of an address (EmailCarriedLogos).
   */
  public static replaceImageSources(
    html: string,
    replace: (source: string) => string | null,
  ): string {
    if (!html || !IMAGE_TAG_START_PATTERN.test(html)) {
      return html;
    }

    return html.replace(IMAGE_TAG_PATTERN, (tag: string): string => {
      const source: TagAttribute | null = findAttribute(tag, "src");

      if (!source) {
        return tag;
      }

      const replacement: string | null = replace(source.value);

      if (replacement === null) {
        return tag;
      }

      return (
        tag.slice(0, source.valueStart) +
        replacement +
        tag.slice(source.valueEnd)
      );
    });
  }

  /**
   * `html` with every <img> whose src is exactly `image.dataUri` pointing
   * at one attachment, named `image.fileName`, by Content-ID. For an image
   * of the email's own - OneUptime's logo in its header (EmailLogo) - rather
   * than one a text placed: it is held to no limit and never left out, so
   * the caller counts its bytes (EmailSize.attachWithinLimit). HTML with no
   * such image, or an image that is not an inline raster image, comes back
   * exactly as it was, with no attachment.
   */
  public static attachImage(
    html: string,
    image: EmailOwnImage,
  ): EmailHtmlWithInlineImages {
    const parsed: InlineImageDataUri | null = parseInlineImageDataUri(
      image.dataUri,
    );

    if (!html || !parsed || html.indexOf(image.dataUri) === -1) {
      return { html: html, inlineImages: [] };
    }

    const contentId: string = `${randomUUID()}@oneuptime`;
    let imagesPointed: number = 0;

    const attachedHtml: string = html.replace(
      IMAGE_TAG_PATTERN,
      (tag: string): string => {
        const source: TagAttribute | null = findAttribute(tag, "src");

        if (!source || source.value !== image.dataUri) {
          return tag;
        }

        imagesPointed++;

        return (
          tag.slice(0, source.valueStart) +
          `cid:${contentId}` +
          tag.slice(source.valueEnd)
        );
      },
    );

    // The data: URL was there, but not as an image's src.
    if (imagesPointed === 0) {
      return { html: html, inlineImages: [] };
    }

    return {
      html: attachedHtml,
      inlineImages: [
        {
          contentId: contentId,
          fileName: image.fileName,
          mimeType: parsed.mimeType,
          base64: parsed.base64,
          byteLength: parsed.byteLength,
        },
      ],
    };
  }
}
