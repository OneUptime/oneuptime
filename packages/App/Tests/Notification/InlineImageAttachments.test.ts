import { describe, expect, test } from "@jest/globals";
import { EmailInlineImage } from "Common/Server/Utils/Mail/EmailInlineImages";
import InlineImageAttachments from "../../FeatureSet/Notification/Services/MailProviders/InlineImageAttachments";

/*
 * Each mail service's names for an email's inline image, exactly
 * (InlineImageAttachments): SMTP's cid, SendGrid's content_id and Graph's
 * contentId with isInline. A field one service does not read makes it refuse
 * the whole email (issue #5308), so each mapping is held to its every key.
 * InlineImagesOnEveryMailTransport sends them through the real clients.
 */

const LOGO: EmailInlineImage = {
  contentId: "4f1e9c2a-6b7d-4e8f-9a0b-1c2d3e4f5a6b@oneuptime",
  fileName: "oneuptime-logo.png",
  mimeType: "image/png",
  base64:
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  byteLength: 70,
};

const SCREENSHOT: EmailInlineImage = {
  contentId: "0f8e6f5c-1d1b-4a5e-9c4f-3b2a1c0d9e8f@oneuptime",
  fileName: "image-1.jpg",
  mimeType: "image/jpeg",
  base64:
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  byteLength: 125,
};

describe("SMTP (nodemailer)", () => {
  test("an inline part whose cid is the Content-ID the HTML points at", () => {
    expect(InlineImageAttachments.forSmtp([LOGO])).toEqual([
      {
        filename: "oneuptime-logo.png",
        content: LOGO.base64,
        encoding: "base64",
        contentType: "image/png",
        contentDisposition: "inline",
        cid: LOGO.contentId,
      },
    ]);
  });
});

describe("SendGrid's v3 Mail Send", () => {
  test("content_id - SendGrid's word - beside the content, filename, type and an inline disposition", () => {
    expect(InlineImageAttachments.forSendgrid([LOGO])).toEqual([
      {
        content: LOGO.base64,
        filename: "oneuptime-logo.png",
        type: "image/png",
        disposition: "inline",
        content_id: LOGO.contentId,
      },
    ]);
  });

  test("never the client's typed name, contentId, which SendGrid does not read", () => {
    for (const attachment of InlineImageAttachments.forSendgrid([
      LOGO,
      SCREENSHOT,
    ])) {
      expect(Object.keys(attachment).sort()).toEqual([
        "content",
        "content_id",
        "disposition",
        "filename",
        "type",
      ]);
    }
  });
});

describe("Microsoft Graph's sendMail", () => {
  test("a fileAttachment with contentId and isInline", () => {
    expect(InlineImageAttachments.forMicrosoftGraph([LOGO])).toEqual([
      {
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: "oneuptime-logo.png",
        contentType: "image/png",
        contentBytes: LOGO.base64,
        contentId: LOGO.contentId,
        isInline: true,
      },
    ]);
  });
});

describe("every service", () => {
  test("each image in the order the email holds them, each with its own Content-ID", () => {
    const images: Array<EmailInlineImage> = [LOGO, SCREENSHOT];

    expect(
      InlineImageAttachments.forSmtp(images).map(
        (attachment: { cid?: string | undefined }) => {
          return attachment.cid;
        },
      ),
    ).toEqual([LOGO.contentId, SCREENSHOT.contentId]);
    expect(
      InlineImageAttachments.forSendgrid(images).map(
        (attachment: { content_id: string }) => {
          return attachment.content_id;
        },
      ),
    ).toEqual([LOGO.contentId, SCREENSHOT.contentId]);
    expect(
      InlineImageAttachments.forMicrosoftGraph(images).map(
        (attachment: { contentId: string }) => {
          return attachment.contentId;
        },
      ),
    ).toEqual([LOGO.contentId, SCREENSHOT.contentId]);
  });

  test("the image's own type and bytes, a JPEG as a JPEG", () => {
    expect(InlineImageAttachments.forSmtp([SCREENSHOT])[0]).toMatchObject({
      contentType: "image/jpeg",
      content: SCREENSHOT.base64,
    });
    expect(InlineImageAttachments.forSendgrid([SCREENSHOT])[0]).toMatchObject({
      type: "image/jpeg",
      content: SCREENSHOT.base64,
    });
    expect(
      InlineImageAttachments.forMicrosoftGraph([SCREENSHOT])[0],
    ).toMatchObject({
      contentType: "image/jpeg",
      contentBytes: SCREENSHOT.base64,
    });
  });

  test("no images, no attachments", () => {
    expect(InlineImageAttachments.forSmtp([])).toEqual([]);
    expect(InlineImageAttachments.forSendgrid([])).toEqual([]);
    expect(InlineImageAttachments.forMicrosoftGraph([])).toEqual([]);
  });
});
