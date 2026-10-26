/*
 * WHETHER A MAIL SERVICE REFUSED AN EMAIL FOR ITS INLINE IMAGES.
 *
 * An email is worth more than its images. A mail service that will not take
 * an email's inline images - OneUptime's logo in its header, a screenshot in
 * a description - refuses the whole email, and a password reset or an
 * on-call page is lost for a picture. So when a service's answer names the
 * images as what it would not take, MailService sends the same email once
 * more without them: its header shows the product's name alone, as it does
 * when the logo's file cannot be read, and each screenshot becomes a short
 * note (EmailInlineImages.leaveOut). The Email Log says the email went
 * without its images, and why.
 *
 * Only an answer that names the images counts. Any other refusal - the API
 * key, the sender, the recipient, a rate limit - would refuse the email
 * without them just the same, and is reported as it is:
 *
 *   - SendGrid: HTTP 400 with an error on a field of `attachments`
 *     ("attachments.0.content_id"), or HTTP 413, too large.
 *   - Microsoft Graph: HTTP 400 whose error names an attachment or the
 *     message's size, or HTTP 413.
 *   - SMTP: a server that will not take the message for its size or its
 *     parts - reply code 552, or the enhanced status 5.3.4 (message too big
 *     for the system) or 5.6.x (a media error, RFC 3463).
 *
 * The images are left out once and never sent again; a refusal of the
 * email without them is the email's own failure.
 */

// What the HTTP API providers set on the error they throw.
export interface InlineImageRefusalFlag {
  refusedInlineImages: boolean;
}

// What nodemailer puts on an error the SMTP server answered with.
interface SmtpErrorReply {
  responseCode?: unknown;
  response?: unknown;
}

// Words of a Graph error about an attachment or the message's size.
const GRAPH_ATTACHMENT_ERROR_PATTERN: RegExp =
  /attachment|contentBytes|contentId|isInline|MessageSizeExceeded/i;

/*
 * A reply whose enhanced status code (RFC 3463) is 5.3.4 or 5.6.x, as in
 * "552 5.3.4 Message size exceeds fixed maximum message size". Anchored, and
 * every repeat is bounded, so it reads any reply in time linear in its length.
 */
const SMTP_IMAGE_REFUSAL_STATUS_PATTERN: RegExp =
  /^5\d\d[ -]5\.(?:3\.4|6\.\d{1,3})(?:\s|$)/;

const ATTACHMENTS_FIELD: string = "attachments";

export default class InlineImageRefusal {
  // SendGrid's answer to a Mail Send, from its status and its errors' fields.
  public static isSendgridRefusal(
    statusCode: number | undefined,
    errorFields: Array<string>,
  ): boolean {
    if (statusCode === 413) {
      return true;
    }

    return (
      statusCode === 400 &&
      errorFields.some((field: string): boolean => {
        return (
          field === ATTACHMENTS_FIELD ||
          field.startsWith(`${ATTACHMENTS_FIELD}.`)
        );
      })
    );
  }

  // Microsoft Graph's answer to a sendMail, from its status and its error.
  public static isMicrosoftGraphRefusal(
    statusCode: number,
    errorDetail: string,
  ): boolean {
    if (statusCode === 413) {
      return true;
    }

    return (
      statusCode === 400 && GRAPH_ATTACHMENT_ERROR_PATTERN.test(errorDetail)
    );
  }

  // An SMTP server's answer, as nodemailer reports it.
  public static isSmtpRefusal(error: unknown): boolean {
    if (!error || typeof error !== "object") {
      return false;
    }

    const reply: SmtpErrorReply = error as SmtpErrorReply;

    if (reply.responseCode === 552) {
      return true;
    }

    return (
      typeof reply.response === "string" &&
      SMTP_IMAGE_REFUSAL_STATUS_PATTERN.test(reply.response)
    );
  }

  // What MailService asks of whatever a transport threw.
  public static isRefusalOfInlineImages(error: unknown): boolean {
    if (error && typeof error === "object") {
      const flag: unknown = (error as Partial<InlineImageRefusalFlag>)
        .refusedInlineImages;

      if (typeof flag === "boolean") {
        return flag;
      }
    }

    return InlineImageRefusal.isSmtpRefusal(error);
  }
}
