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
 *     parts. Its enhanced status code says so where it gives one (RFC
 *     3463): 5.2.3 (message length exceeds an administrative limit), 5.3.4
 *     (message too big for the system) or 5.6.x (a media error) - and any
 *     other, such as 552 5.2.2 for a full mailbox, is not about the images.
 *     A reply without one counts when its code is 552, "exceeded storage
 *     allocation", the classic answer to a message too big.
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
 * A reply's code and enhanced status code (RFC 3463) - its class, subject
 * and detail - as in "552 5.3.4 Message size exceeds fixed maximum message
 * size", or "552-5.2.2 The email account that you tried to reach is over
 * quota" on the first of several lines. Anchored, and every repeat is
 * bounded, so it reads any reply in time linear in its length.
 */
const SMTP_ENHANCED_STATUS_PATTERN: RegExp =
  /^\d{3}[ -]([245])\.(\d{1,3})\.(\d{1,3})(?:\s|$)/;

// The enhanced status code of an SMTP reply.
interface SmtpEnhancedStatus {
  statusClass: number;
  subject: number;
  detail: number;
}

const readEnhancedStatus: (response: unknown) => SmtpEnhancedStatus | null = (
  response: unknown,
): SmtpEnhancedStatus | null => {
  if (typeof response !== "string") {
    return null;
  }

  const match: RegExpExecArray | null =
    SMTP_ENHANCED_STATUS_PATTERN.exec(response);

  if (!match) {
    return null;
  }

  return {
    statusClass: Number(match[1]),
    subject: Number(match[2]),
    detail: Number(match[3]),
  };
};

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
    const status: SmtpEnhancedStatus | null = readEnhancedStatus(
      reply.response,
    );

    // What the server says was refused, where it says it.
    if (status) {
      return (
        status.statusClass === 5 &&
        ((status.subject === 2 && status.detail === 3) ||
          (status.subject === 3 && status.detail === 4) ||
          status.subject === 6)
      );
    }

    return reply.responseCode === 552;
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
