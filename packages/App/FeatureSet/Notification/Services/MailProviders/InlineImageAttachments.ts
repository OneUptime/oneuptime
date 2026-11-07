import { EmailInlineImage } from "Common/Server/Utils/Mail/EmailInlineImages";
import type Mailer from "nodemailer/lib/mailer";

/*
 * HOW EACH MAIL SERVICE IS HANDED AN EMAIL'S INLINE IMAGES.
 *
 * An inline image - OneUptime's logo in an email's header (EmailLogo), a
 * screenshot in a description (EmailInlineImages) - goes out as an
 * attachment the HTML points at as "cid:" and its Content-ID (RFC 2392).
 * Each way OneUptime sends email names that attachment's parts in words of
 * its own, and a service that does not find the name it reads the
 * Content-ID from refuses the whole email. SendGrid did, for every email
 * that carried an image (issue #5308): from 14.0.23 every email with a
 * screenshot in it, and from 14.0.82, when OneUptime's logo began to head
 * its emails, nearly every email - password resets and on-call pages too.
 *
 * So each service's names are written here, once, as its API documents
 * them, and InlineImagesOnEveryMailTransport sends an email through each
 * one's real client to a stand-in for the service and reads what arrives:
 *
 *   - SMTP (nodemailer): `cid`, which nodemailer writes as the part's
 *     Content-ID header, in a multipart/related message.
 *   - SendGrid's v3 Mail Send API: `content_id`. @sendgrid/mail sends an
 *     attachment given as a plain object exactly as it is given, in every
 *     8.x release. Its typings call the field `contentId`, a name only its
 *     own Attachment class renames, so a plain `contentId` reached SendGrid
 *     as a field it does not read.
 *   - Microsoft Graph's sendMail: a fileAttachment with `contentId` and
 *     `isInline`.
 *   - Amazon SES's v2 SendEmail: an Attachment with `ContentId`,
 *     ContentDisposition INLINE and its RawContent as base64
 *     (https://docs.aws.amazon.com/ses/latest/dg/attachments.html: the ID
 *     bare, as the HTML's "cid:" points at it).
 *   - Postmark's Email API: `ContentID` beside Name, Content and
 *     ContentType, written "cid:" and the ID, as Postmark's examples write
 *     it (https://postmarkapp.com/developer/api/email-api).
 *   - Resend's Emails API: `content_id` beside content, filename and
 *     content_type, the ID bare
 *     (https://resend.com/docs/dashboard/emails/embed-inline-images).
 *   - Mailgun's messages.mime: the SMTP message itself (MimeMessage), so its
 *     images are the parts nodemailer writes, as over SMTP.
 */

// One inline image as SendGrid's v3 Mail Send API reads it.
export interface SendgridInlineAttachment {
  // The image's bytes, as base64.
  content: string;
  filename: string;
  type: string;
  disposition: "inline";
  // What the HTML points at as "cid:" - SendGrid's own name for it.
  content_id: string;
}

// One inline image as Microsoft Graph's sendMail reads it.
export interface MicrosoftGraphInlineAttachment {
  "@odata.type": "#microsoft.graph.fileAttachment";
  name: string;
  contentType: string;
  // The image's bytes, as base64.
  contentBytes: string;
  contentId: string;
  isInline: true;
}

// One inline image as Amazon SES's v2 SendEmail reads it (API_Attachment).
export interface AmazonSesInlineAttachment {
  FileName: string;
  // The image's bytes, as base64: RawContent is base64 over HTTPS.
  RawContent: string;
  ContentDisposition: "INLINE";
  ContentId: string;
  ContentTransferEncoding: "BASE64";
  ContentType: string;
}

// One inline image as Postmark's Email API reads it.
export interface PostmarkInlineAttachment {
  Name: string;
  // The image's bytes, as base64.
  Content: string;
  ContentType: string;
  // "cid:" and what the HTML points at, as Postmark's own examples write it.
  ContentID: string;
}

// One inline image as Resend's Emails API reads it.
export interface ResendInlineAttachment {
  // The image's bytes, as base64.
  content: string;
  filename: string;
  content_type: string;
  // What the HTML points at as "cid:" - Resend's own name for it.
  content_id: string;
}

export default class InlineImageAttachments {
  // For nodemailer: each image an inline part of a multipart/related message.
  public static forSmtp(
    images: Array<EmailInlineImage>,
  ): Array<Mailer.Attachment> {
    return images.map((image: EmailInlineImage): Mailer.Attachment => {
      return {
        filename: image.fileName,
        content: image.base64,
        encoding: "base64",
        contentType: image.mimeType,
        contentDisposition: "inline",
        cid: image.contentId,
      };
    });
  }

  // For SendGrid's v3 Mail Send API.
  public static forSendgrid(
    images: Array<EmailInlineImage>,
  ): Array<SendgridInlineAttachment> {
    return images.map((image: EmailInlineImage): SendgridInlineAttachment => {
      return {
        content: image.base64,
        filename: image.fileName,
        type: image.mimeType,
        disposition: "inline",
        content_id: image.contentId,
      };
    });
  }

  // For Microsoft Graph's sendMail.
  public static forMicrosoftGraph(
    images: Array<EmailInlineImage>,
  ): Array<MicrosoftGraphInlineAttachment> {
    return images.map(
      (image: EmailInlineImage): MicrosoftGraphInlineAttachment => {
        return {
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: image.fileName,
          contentType: image.mimeType,
          contentBytes: image.base64,
          contentId: image.contentId,
          isInline: true,
        };
      },
    );
  }

  // For Amazon SES's v2 SendEmail, as Content.Simple.Attachments.
  public static forAmazonSes(
    images: Array<EmailInlineImage>,
  ): Array<AmazonSesInlineAttachment> {
    return images.map((image: EmailInlineImage): AmazonSesInlineAttachment => {
      return {
        FileName: image.fileName,
        RawContent: image.base64,
        ContentDisposition: "INLINE",
        ContentId: image.contentId,
        ContentTransferEncoding: "BASE64",
        ContentType: image.mimeType,
      };
    });
  }

  // For Postmark's Email API.
  public static forPostmark(
    images: Array<EmailInlineImage>,
  ): Array<PostmarkInlineAttachment> {
    return images.map((image: EmailInlineImage): PostmarkInlineAttachment => {
      return {
        Name: image.fileName,
        Content: image.base64,
        ContentType: image.mimeType,
        ContentID: `cid:${image.contentId}`,
      };
    });
  }

  // For Resend's Emails API.
  public static forResend(
    images: Array<EmailInlineImage>,
  ): Array<ResendInlineAttachment> {
    return images.map((image: EmailInlineImage): ResendInlineAttachment => {
      return {
        content: image.base64,
        filename: image.fileName,
        content_type: image.mimeType,
        content_id: image.contentId,
      };
    });
  }
}
