import EmailInlineImages, {
  EmailHtmlWithInlineImages,
  EmailInlineImage,
} from "./EmailInlineImages";

/*
 * HOW BIG AN EMAIL IS.
 *
 * A mail server refuses a message over its limit, and the notification is
 * lost: Postfix takes 10 MB unless told otherwise, Microsoft Graph refuses a
 * sendMail request over 4 MB, Gmail takes 25 MB and SendGrid 30 MB. A
 * notification's text can be megabytes - a response body or a log a
 * description template placed - and a table's HTML is some thirty times
 * its Markdown.
 *
 * So an email is held to a size every one of them takes, in three steps:
 *
 *   - each Markdown field renders to at most MAX_EMAIL_FIELD_HTML_BYTES of
 *     HTML, its inline images aside (Server/Types/Markdown: convertToHTML
 *     cuts the text to fit and ends it with EMAIL_TRUNCATED_TEXT_NOTE);
 *   - inline images (screenshots) go out as attachments, at most
 *     MaxEmailInlineImageBytes of them in all (EmailInlineImages);
 *   - and just before it is sent, the whole of it - the HTML and every
 *     attachment, as base64 - is held to MAX_EMAIL_BYTES (attachWithinLimit):
 *     images that do not fit beside the HTML are left out, each with a
 *     note, and HTML that does not fit on its own - an email of many long
 *     fields - is cut, with the note.
 *
 * An email within the limit is sent exactly as it always was.
 */

/*
 * The most an email is, its HTML and its attachments as base64 together:
 * well under the 10 MB a mail server takes by default, and under the 4 MB
 * of a Microsoft Graph sendMail request once its JSON has escaped the HTML.
 */
export const MAX_EMAIL_BYTES: number = 3 * 1024 * 1024;

/*
 * The most HTML one Markdown field of an email - a description, a note, a
 * root cause - renders to, its inline images aside: far more text than an
 * email is read for, and a few of them fit in MAX_EMAIL_BYTES beside the
 * images.
 */
export const MAX_EMAIL_FIELD_HTML_BYTES: number = 256 * 1024;

// What a cut text ends with: the words a cut chat message ends with.
export const EMAIL_TRUNCATED_TEXT_NOTE: string =
  "… (truncated — see OneUptime for the full text)";

export const EMAIL_TRUNCATED_TEXT_NOTE_HTML: string = `<p style="color:#64748b;font-style:italic;">${EMAIL_TRUNCATED_TEXT_NOTE}</p>`;

export interface EmailWithinLimit extends EmailHtmlWithInlineImages {
  // Whether anything was left out or cut to fit MAX_EMAIL_BYTES.
  wasFitted: boolean;
}

// The bytes a code unit takes in UTF-8; a surrogate pair's two take 4.
const getUtf8Length: (code: number) => number = (code: number): number => {
  if (code < 0x80) {
    return 1;
  }

  if (code < 0x800) {
    return 2;
  }

  // Each half of a surrogate pair: 2 of the pair's 4 bytes.
  if (code >= 0xd800 && code <= 0xdfff) {
    return 2;
  }

  return 3;
};

export default class EmailSize {
  // HTML's size as it is sent: UTF-8.
  public static getHtmlSizeInBytes(html: string): number {
    return Buffer.byteLength(html, "utf8");
  }

  // An email's size: its HTML and its attachments, as base64.
  public static getSizeInBytes(email: EmailHtmlWithInlineImages): number {
    return (
      EmailSize.getHtmlSizeInBytes(email.html) +
      email.inlineImages.reduce(
        (total: number, image: EmailInlineImage): number => {
          return total + image.base64.length;
        },
        0,
      )
    );
  }

  /*
   * The size of the HTML a Markdown field puts into an email: with its
   * inline images as the attachments they go out as (EmailInlineImages),
   * so a screenshot counts for the few bytes of its "cid:" address.
   */
  public static getFieldSizeInBytes(html: string): number {
    return EmailSize.getHtmlSizeInBytes(EmailInlineImages.attach(html).html);
  }

  /*
   * `html` with its inline images attached (EmailInlineImages.attach), the
   * whole held to `maxBytes` (see the top of this file): as it is when it
   * fits; else with only the images that fit beside the HTML, the others
   * each a note; else, when the HTML alone is too big, with no images and
   * the HTML cut (cutHtml).
   */
  public static attachWithinLimit(
    html: string,
    maxBytes: number = MAX_EMAIL_BYTES,
  ): EmailWithinLimit {
    const attached: EmailHtmlWithInlineImages = EmailInlineImages.attach(html);

    if (EmailSize.getSizeInBytes(attached) <= maxBytes) {
      return { ...attached, wasFitted: false };
    }

    const htmlBytes: number = EmailSize.getHtmlSizeInBytes(attached.html);

    if (htmlBytes < maxBytes) {
      // Base64 is a third more than the bytes it carries.
      const fewerImages: EmailHtmlWithInlineImages = EmailInlineImages.attach(
        html,
        { maxTotalBytes: Math.floor(((maxBytes - htmlBytes) * 3) / 4) },
      );

      if (EmailSize.getSizeInBytes(fewerImages) <= maxBytes) {
        return { ...fewerImages, wasFitted: true };
      }
    }

    const noImages: EmailHtmlWithInlineImages = EmailInlineImages.attach(html, {
      maxTotalBytes: 0,
    });

    return {
      html: EmailSize.cutHtml(noImages.html, maxBytes),
      inlineImages: [],
      wasFitted: true,
    };
  }

  /*
   * HTML cut to at most `maxBytes` of UTF-8, ending with
   * EMAIL_TRUNCATED_TEXT_NOTE_HTML: never inside a tag or a character
   * reference, and never between the two halves of a surrogate pair. The
   * elements left open are closed by the mail client, as it closes them
   * in any HTML that stops. HTML that fits is returned as it is.
   */
  public static cutHtml(html: string, maxBytes: number): string {
    if (EmailSize.getHtmlSizeInBytes(html) <= maxBytes) {
      return html;
    }

    const budget: number = Math.max(
      0,
      maxBytes - EmailSize.getHtmlSizeInBytes(EMAIL_TRUNCATED_TEXT_NOTE_HTML),
    );

    // How many characters fit in the budget.
    let bytes: number = 0;
    let cut: number = 0;

    while (cut < html.length) {
      const size: number = getUtf8Length(html.charCodeAt(cut));

      if (bytes + size > budget) {
        break;
      }

      bytes += size;
      cut++;
    }

    // Not between the halves of a surrogate pair.
    const before: number = html.charCodeAt(cut - 1);

    if (cut > 0 && before >= 0xd800 && before <= 0xdbff) {
      cut--;
    }

    // Not inside a tag: a "<" after the last ">" opened one.
    const lastTagStart: number = html.lastIndexOf("<", cut - 1);
    const lastTagEnd: number = html.lastIndexOf(">", cut - 1);

    if (lastTagStart > lastTagEnd) {
      cut = lastTagStart;
    }

    // Not inside a character reference ("&amp;", "&#8212;").
    const lastAmpersand: number = html.lastIndexOf("&", cut - 1);

    if (
      lastAmpersand !== -1 &&
      lastAmpersand > html.lastIndexOf(";", cut - 1) &&
      lastAmpersand > html.lastIndexOf(">", cut - 1) &&
      cut - lastAmpersand <= 32
    ) {
      cut = lastAmpersand;
    }

    return html.slice(0, cut) + EMAIL_TRUNCATED_TEXT_NOTE_HTML;
  }
}
