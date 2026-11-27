import { EmailAttachment } from "Common/Types/Email/EmailAttachment";
import type Mailer from "nodemailer/lib/mailer";

/*
 * HOW EACH MAIL SERVICE IS HANDED AN EMAIL'S FILES (#11009).
 *
 * A file sent with an email - a scheduled cloud cost report's CSV - is an
 * attachment the reader opens, beside the inline images the HTML points at
 * (InlineImageAttachments). Each way OneUptime sends email names its parts
 * in words of its own, as its API documents a file attachment:
 *
 *   - SMTP (nodemailer): filename, content, encoding and contentType, with
 *     contentDisposition "attachment" - and no cid, so it is not "related"
 *     to the HTML.
 *   - SendGrid's v3 Mail Send API: content, filename, type and disposition
 *     "attachment".
 *   - Microsoft Graph's sendMail: a fileAttachment with name, contentType
 *     and contentBytes, isInline false.
 *   - Amazon SES's v2 SendEmail: an Attachment with FileName, RawContent,
 *     ContentDisposition ATTACHMENT, ContentTransferEncoding BASE64 and
 *     ContentType (https://docs.aws.amazon.com/ses/latest/dg/attachments.html).
 *   - Postmark's Email API: Name, Content and ContentType, with no ContentID
 *     (https://postmarkapp.com/developer/api/email-api).
 *   - Resend's Emails API: content, filename and content_type
 *     (https://resend.com/docs/api-reference/emails/send-email).
 *   - Mailgun's messages.mime: the SMTP message itself (MimeMessage), so its
 *     files are the parts nodemailer writes, as over SMTP.
 */

export interface SendgridFileAttachment {
  content: string;
  filename: string;
  type: string;
  disposition: "attachment";
}

export interface MicrosoftGraphFileAttachment {
  "@odata.type": "#microsoft.graph.fileAttachment";
  name: string;
  contentType: string;
  contentBytes: string;
  isInline: false;
}

export interface AmazonSesFileAttachment {
  FileName: string;
  RawContent: string;
  ContentDisposition: "ATTACHMENT";
  ContentTransferEncoding: "BASE64";
  ContentType: string;
}

export interface PostmarkFileAttachment {
  Name: string;
  Content: string;
  ContentType: string;
}

export interface ResendFileAttachment {
  content: string;
  filename: string;
  content_type: string;
}

export default class FileAttachments {
  // An email's files, or none.
  public static of(
    mail: { attachments?: Array<EmailAttachment> | undefined } | undefined,
  ): Array<EmailAttachment> {
    return mail?.attachments || [];
  }

  public static forSmtp(
    files: Array<EmailAttachment>,
  ): Array<Mailer.Attachment> {
    return files.map((file: EmailAttachment): Mailer.Attachment => {
      return {
        filename: file.fileName,
        content: file.contentBase64,
        encoding: "base64",
        contentType: file.mimeType,
        contentDisposition: "attachment",
      };
    });
  }

  public static forSendgrid(
    files: Array<EmailAttachment>,
  ): Array<SendgridFileAttachment> {
    return files.map((file: EmailAttachment): SendgridFileAttachment => {
      return {
        content: file.contentBase64,
        filename: file.fileName,
        type: file.mimeType,
        disposition: "attachment",
      };
    });
  }

  public static forMicrosoftGraph(
    files: Array<EmailAttachment>,
  ): Array<MicrosoftGraphFileAttachment> {
    return files.map((file: EmailAttachment): MicrosoftGraphFileAttachment => {
      return {
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: file.fileName,
        contentType: file.mimeType,
        contentBytes: file.contentBase64,
        isInline: false,
      };
    });
  }

  public static forAmazonSes(
    files: Array<EmailAttachment>,
  ): Array<AmazonSesFileAttachment> {
    return files.map((file: EmailAttachment): AmazonSesFileAttachment => {
      return {
        FileName: file.fileName,
        RawContent: file.contentBase64,
        ContentDisposition: "ATTACHMENT",
        ContentTransferEncoding: "BASE64",
        ContentType: file.mimeType,
      };
    });
  }

  public static forPostmark(
    files: Array<EmailAttachment>,
  ): Array<PostmarkFileAttachment> {
    return files.map((file: EmailAttachment): PostmarkFileAttachment => {
      return {
        Name: file.fileName,
        Content: file.contentBase64,
        ContentType: file.mimeType,
      };
    });
  }

  public static forResend(
    files: Array<EmailAttachment>,
  ): Array<ResendFileAttachment> {
    return files.map((file: EmailAttachment): ResendFileAttachment => {
      return {
        content: file.contentBase64,
        filename: file.fileName,
        content_type: file.mimeType,
      };
    });
  }
}
