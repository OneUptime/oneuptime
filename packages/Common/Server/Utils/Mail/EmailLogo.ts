import logger from "../Logger";
import EmailInlineImages, {
  EmailHtmlWithInlineImages,
} from "./EmailInlineImages";
import {
  InlineImageDataUri,
  parseInlineImageDataUri,
} from "../../../Utils/Markdown/InlineImageDataUri";
import fs from "fs";
import path from "path";

/*
 * ONEUPTIME'S LOGO TRAVELS INSIDE EVERY EMAIL IT HEADS.
 *
 * The header of an email that shows OneUptime's branding draws OneUptime's
 * logo (Templates/Partials/Logo.hbs). It used to be an address on
 * res.cloudinary.com (issue #5124): on a network without the internet every
 * email showed a broken image there, and everywhere else every email opened
 * asked a third party for it - telling it who opened which email, and when -
 * from an account that was never part of a release.
 *
 * So the logo is not an address at all. It is an inline image, the way a
 * screenshot in a description is (EmailInlineImages): an attachment the HTML
 * points at by Content-ID, which every mail client shows on any network
 * without asking anyone for anything - not even this installation, whose
 * HOST may be unset, or a name its readers' mail clients cannot reach. The
 * file ships with OneUptime: Common/Server/Static/Brand/oneuptime-email-logo.png,
 * OneUptime's tile at 96 x 96 for a header that draws it at 32 x 32, sharp
 * on a 3x screen, a few kilobytes.
 *
 * MailService.render writes it as the data: URL getDataUrl returns, which a
 * browser shows, so a preview of an email shows the logo; and just before
 * the email is sent, attach() moves it into its attachment
 * (EmailSize.attachWithinLimit). Unlike a screenshot it is never left out
 * to make an email fit, and never replaced by a note: its few kilobytes are
 * set aside before anything else is measured.
 *
 * A logo of the installation's own (product branding) is not this: it is
 * shown from the installation's own address, as the operator set it up
 * (Notification/Utils/EmailBranding.ts).
 */

export const EMAIL_LOGO_PATH: string = path.resolve(
  __dirname,
  "..",
  "..",
  "Static",
  "Brand",
  "oneuptime-email-logo.png",
);

// The name of the logo's attachment, where a mail client shows one.
export const EMAIL_LOGO_FILE_NAME: string = "oneuptime-logo.png";

export type ReadEmailLogoDataUrlFunction = (filePath: string) => string | null;

/**
 * The image at `filePath` as an inline image's data: URL - letters, digits
 * and "+/=:;," only, safe in an HTML attribute as it is - or null when it
 * cannot be read or is not a PNG, JPEG, GIF or WebP file.
 */
export const readEmailLogoDataUrl: ReadEmailLogoDataUrlFunction = (
  filePath: string,
): string | null => {
  let bytes: Buffer;

  try {
    bytes = fs.readFileSync(filePath);
  } catch (err) {
    logger.error(
      `OneUptime's email logo could not be read from ${filePath}. Emails show OneUptime's name in its place.`,
    );
    logger.error(err);
    return null;
  }

  const image: InlineImageDataUri | null = parseInlineImageDataUri(
    `data:image/png;base64,${bytes.toString("base64")}`,
  );

  if (!image) {
    logger.error(
      `OneUptime's email logo at ${filePath} is not a PNG, JPEG, GIF or WebP image. Emails show OneUptime's name in its place.`,
    );
    return null;
  }

  return image.dataUri;
};

export default class EmailLogo {
  // Read once: undefined until then, null when it could not be.
  private static dataUrl: string | null | undefined = undefined;

  /**
   * OneUptime's logo as the data: URL an email's header writes, or null
   * when its file cannot be read - the header then shows OneUptime's name
   * alone, never a broken image or an address elsewhere. Read once.
   */
  public static getDataUrl(): string | null {
    if (EmailLogo.dataUrl === undefined) {
      EmailLogo.dataUrl = readEmailLogoDataUrl(EMAIL_LOGO_PATH);
    }

    return EmailLogo.dataUrl;
  }

  /**
   * `html` with OneUptime's logo moved out of it: every <img> that shows the
   * logo's data: URL points at one attachment, named EMAIL_LOGO_FILE_NAME,
   * by Content-ID instead. HTML without the logo comes back as it was, with
   * no attachment.
   */
  public static attach(html: string): EmailHtmlWithInlineImages {
    const dataUrl: string | null = EmailLogo.getDataUrl();

    if (!dataUrl) {
      return { html: html, inlineImages: [] };
    }

    return EmailInlineImages.attachImage(html, {
      dataUri: dataUrl,
      fileName: EMAIL_LOGO_FILE_NAME,
    });
  }
}
