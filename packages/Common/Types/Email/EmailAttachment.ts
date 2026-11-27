/*
 * A FILE SENT WITH AN EMAIL (#11009).
 *
 * A scheduled cloud cost report goes out with its figures as a CSV, so
 * finance opens the numbers in a spreadsheet straight from the email. The
 * file travels in the envelope (EmailEnvelope.attachments) from whoever
 * sends the email - through the burst rollup, which never holds back an
 * email that carries one, and the internal mail API, which reads it with
 * readEmailAttachments - to every way OneUptime sends mail: SMTP, SendGrid,
 * Microsoft Graph, Amazon SES, Mailgun, Postmark and Resend, each as its API
 * documents a file attachment (Notification's FileAttachments).
 *
 * Only small text files of the kinds OneUptime writes are carried: an email
 * is no file transfer, and a mail server refuses one that is too large.
 */

export interface EmailAttachment {
  // The file's name as the reader's mail program shows it: "report.csv".
  fileName: string;
  // Its type: one of EMAIL_ATTACHMENT_MIME_TYPES.
  mimeType: string;
  // Its bytes, as base64.
  contentBase64: string;
}

// The kinds of file an email carries.
export const EMAIL_ATTACHMENT_MIME_TYPES: ReadonlyArray<string> = ["text/csv"];

// How many files one email carries, and how large they may be together.
export const EMAIL_ATTACHMENTS_MAX_COUNT: number = 3;
export const EMAIL_ATTACHMENTS_MAX_BYTES: number = 512 * 1024;

// A file's name as an attachment carries it: no path, no line break, no quote.
export function toEmailAttachmentFileName(value: string): string {
  const name: string = Array.from(
    (value || "").split(/[\\/]/).pop() || "",
  )
    .filter((char: string): boolean => {
      // No control character - a line break among them - and no quote.
      return char.charCodeAt(0) >= 32 && !'"<>:|?*'.includes(char);
    })
    .join("")
    .trim()
    .slice(0, 120);

  return name || "attachment";
}

// How many bytes a base64 text stands for.
export function getBase64ByteLength(base64: string): number {
  const text: string = (base64 || "").replace(/\s/g, "");
  const padding: number = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;

  return Math.max(0, Math.floor((text.length * 3) / 4) - padding);
}

const BASE64: RegExp = /^[A-Za-z0-9+/]*={0,2}$/;

/*
 * The files a request carries, read: each of a kind an email may carry,
 * named safely and in base64, no more of them than an email carries and no
 * larger together. Anything else is left out - an email is still sent
 * without it - and nothing that is not one is read as one.
 */
export function readEmailAttachments(value: unknown): Array<EmailAttachment> {
  if (!Array.isArray(value)) {
    return [];
  }

  const attachments: Array<EmailAttachment> = [];
  let bytes: number = 0;

  for (const item of value) {
    if (attachments.length >= EMAIL_ATTACHMENTS_MAX_COUNT) {
      break;
    }

    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const record: Record<string, unknown> = item as Record<string, unknown>;
    const mimeType: string = String(record["mimeType"] || "")
      .trim()
      .toLowerCase();
    const contentBase64: string = String(record["contentBase64"] || "").replace(
      /\s/g,
      "",
    );

    if (
      !EMAIL_ATTACHMENT_MIME_TYPES.includes(mimeType) ||
      !contentBase64 ||
      !BASE64.test(contentBase64)
    ) {
      continue;
    }

    const size: number = getBase64ByteLength(contentBase64);

    if (bytes + size > EMAIL_ATTACHMENTS_MAX_BYTES) {
      continue;
    }

    bytes += size;
    attachments.push({
      fileName: toEmailAttachmentFileName(String(record["fileName"] || "")),
      mimeType,
      contentBase64,
    });
  }

  return attachments;
}
