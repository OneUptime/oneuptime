import FileAttachments from "./FileAttachments";
import InlineImageAttachments from "./InlineImageAttachments";
import { EmailInlineImage } from "Common/Server/Utils/Mail/EmailInlineImages";
import EmailPlainText from "Common/Server/Utils/Mail/EmailPlainText";
import EmailMessage from "Common/Types/Email/EmailMessage";
import {
  getCcAddresses,
  getReplyToAddress,
} from "Common/Types/Email/EmailRecipients";
import EmailServer from "Common/Types/Email/EmailServer";
import MailComposer from "nodemailer/lib/mail-composer";

/*
 * AN EMAIL AS ONE MIME MESSAGE, WRITTEN AS THE SMTP PATH WRITES IT.
 *
 * Amazon SES (SendEmail with Content.Raw) and Mailgun (messages.mime) take
 * the whole message as MIME, so they are handed the message nodemailer
 * writes for an SMTP server - by nodemailer's own MailComposer, the code
 * its SMTP transport writes with:
 *
 *   multipart/alternative
 *     text/plain                 the email as text (EmailPlainText)
 *     multipart/related          the HTML, and its inline images
 *       text/html
 *       image/png  Content-ID    each image the HTML points at as "cid:"
 *
 * So an email reads the same through every one of them: the same parts, the
 * same Content-IDs, the same encoded headers (a sender's name or a subject
 * in any script is written as RFC 2047 encoded words), and no line over the
 * 1,000 characters SMTP and SES allow. The sender is given as a name and an
 * address, never as one text, so a name with a comma in it ("Acme, Inc.")
 * stays one sender.
 */
export default class MimeMessage {
  public static async compose(data: {
    mail: EmailMessage;
    emailServer: EmailServer;
    inlineImages: Array<EmailInlineImage>;
  }): Promise<Buffer> {
    const html: string = data.mail.body || "";
    // Who is copied and where a reply goes (EmailRecipients, #8893).
    const ccAddresses: Array<string> = getCcAddresses(data.mail);
    const replyToAddress: string | null = getReplyToAddress(data.mail);

    const composer: MailComposer = new MailComposer({
      from: {
        name: MimeMessage.withoutLineBreaks(data.emailServer.fromName || ""),
        address: data.emailServer.fromEmail.toString(),
      },
      to: data.mail.toEmail.toString(),
      ...(ccAddresses.length > 0 ? { cc: ccAddresses } : {}),
      ...(replyToAddress ? { replyTo: replyToAddress } : {}),
      subject: MimeMessage.withoutLineBreaks(data.mail.subject || ""),
      text: EmailPlainText.fromHtml(html),
      html: html,
      // Its inline images, then the files it carries (FileAttachments).
      ...(data.inlineImages.length > 0 ||
      FileAttachments.of(data.mail).length > 0
        ? {
            attachments: [
              ...InlineImageAttachments.forSmtp(data.inlineImages),
              ...FileAttachments.forSmtp(FileAttachments.of(data.mail)),
            ],
          }
        : {}),
    });

    return await composer.compile().build();
  }

  /*
   * A header's value on one line: nothing a reader could take as a new
   * header. Split and joined rather than matched, so a value of any length
   * is read in one pass.
   */
  public static withoutLineBreaks(value: string): string {
    return value.split("\r").join(" ").split("\n").join(" ").trim();
  }
}
