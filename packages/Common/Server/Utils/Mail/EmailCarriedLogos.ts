import logger from "../Logger";
import EmailInlineImages, { EmailOwnImage } from "./EmailInlineImages";
import { decodeCharacterReferences } from "./EmailPlainText";
import {
  InlineImageDataUri,
  InlineImageMimeType,
  parseInlineImageDataUri,
} from "../../../Utils/Markdown/InlineImageDataUri";

/*
 * A LOGO AN OPERATOR UPLOADED TRAVELS INSIDE THE EMAIL THAT SHOWS IT.
 *
 * OneUptime's own logo goes out inside every email it heads (EmailLogo,
 * issue #5124). A logo an operator uploaded - the installation's own logo
 * (product branding), or a status page's logo - is written into the email
 * by its address on this installation, and used to stay an address. Every
 * mail client then had to fetch it when the email was opened, and many do
 * not: Outlook blocks remote images until the reader allows them, Gmail
 * fetches them through its own servers on the internet, which cannot reach
 * an installation on a private network, and an installation whose readers'
 * mail clients cannot reach its address showed a broken image in every
 * email. Each fetch also told the installation who opened which email, and
 * when.
 *
 * So, just before an email is sent, every <img> whose src is the address
 * of such a logo shows the logo itself instead: its data: URL, which
 * EmailSize.attachWithinLimit then sends as an attachment the HTML points
 * at by Content-ID, as it sends OneUptime's logo - outside the screenshots'
 * limits, counted first, and never left out to make the email fit. The
 * templates are not changed, and neither is what render() shows: a preview
 * of an email shows the logo from its address, as before.
 *
 * Which addresses are logos, and what each logo is, a reader says
 * (CarriedLogoReader): App's EmailBranding knows the installation's own
 * logo, and StatusPageCarriedLogo a status page's, read with the rules its
 * logo route serves it by. A logo travels only when every mail client can
 * draw it and it is small enough to go in every email: a PNG, JPEG or GIF
 * of at most MAX_CARRIED_LOGO_BYTES, the most the installation's own logo
 * may be. Any other logo - an SVG, a WebP, a larger file - and any address
 * no reader knows, stays the address it was, so nothing is shown worse
 * than before. A reader that fails leaves the address too: an email is
 * never held up, or lost, for its logo.
 */

/*
 * The largest logo an email carries: the most the installation's own logo
 * may be (the enterprise module refuses a larger upload), far more than a
 * header drawn 32 to 48 pixels tall needs. A status page's logo may be
 * larger, and then loads from its address.
 */
export const MAX_CARRIED_LOGO_BYTES: number = 512 * 1024;

// The types every mail client draws: not WebP, which Outlook does not.
export const CARRIED_LOGO_TYPES: ReadonlyArray<InlineImageMimeType> = [
  "image/png",
  "image/jpeg",
  "image/gif",
];

/*
 * The most uploaded logos one email carries. OneUptime's own templates show
 * one; a project's custom template could name many, and the rest stay the
 * addresses they were.
 */
export const MAX_CARRIED_LOGOS_PER_EMAIL: number = 3;

/*
 * The most image addresses of one email a reader is asked about: every
 * logo address is near the top of an email, and an email of thousands of
 * images is never read through for them.
 */
export const MAX_ADDRESSES_READ_PER_EMAIL: number = 50;

// A logo, as the image an email carries: its data: URL and attachment name.
export type CarriedLogo = EmailOwnImage;

/*
 * The logo an image's address shows, as an email carries it, or null when
 * the address is not a logo this reader knows, or the logo cannot be
 * carried. Handed the address with its character references decoded.
 */
export type CarriedLogoReader = (
  address: string,
) => Promise<CarriedLogo | null> | CarriedLogo | null;

export interface EmailWithCarriedLogos {
  // The HTML, each carried logo's <img> showing its data: URL.
  html: string;
  // The logos it carries, each once, for EmailSize.attachWithinLimit.
  logos: Array<CarriedLogo>;
}

const HTTP_PREFIX: string = "http://";
const HTTPS_PREFIX: string = "https://";

/*
 * The longest image address read as a logo's: far longer than any the
 * readers know, and a screenshot's megabytes of data: URL in a src are
 * never copied, decoded or handed to a reader.
 */
export const MAX_LOGO_ADDRESS_LENGTH: number = 2048;

// An attachment's name: a plain file name, as toCarriedLogo writes one.
const ATTACHMENT_NAME: RegExp = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const DEFAULT_ATTACHMENT_NAME: string = "logo";

/*
 * An image's src as an address - its character references decoded, as a
 * mail client reads it, and trimmed - or null when it is not a web address
 * a logo could be at.
 */
const toWebAddress: (source: string) => string | null = (
  source: string,
): string | null => {
  if (source.length > MAX_LOGO_ADDRESS_LENGTH) {
    return null;
  }

  const address: string = decodeCharacterReferences(source).trim();
  const lower: string = address.toLowerCase();

  return lower.startsWith(HTTP_PREFIX) || lower.startsWith(HTTPS_PREFIX)
    ? address
    : null;
};

/**
 * A logo's bytes as the image an email carries, its attachment named
 * `name` and the extension of the type its bytes are - or null when an
 * email cannot carry it: no bytes, more than MAX_CARRIED_LOGO_BYTES, or not
 * a PNG, JPEG or GIF file (read from its own first bytes, whatever it was
 * uploaded as).
 */
export const toCarriedLogo: (
  bytes: Buffer | null | undefined,
  name: string,
) => CarriedLogo | null = (
  bytes: Buffer | null | undefined,
  name: string,
): CarriedLogo | null => {
  if (
    !bytes ||
    !Buffer.isBuffer(bytes) ||
    bytes.length === 0 ||
    bytes.length > MAX_CARRIED_LOGO_BYTES
  ) {
    return null;
  }

  // The bytes decide the type; the media type written here is only a start.
  const image: InlineImageDataUri | null = parseInlineImageDataUri(
    `data:image/png;base64,${bytes.toString("base64")}`,
  );

  if (!image || !CARRIED_LOGO_TYPES.includes(image.mimeType)) {
    return null;
  }

  return {
    dataUri: image.dataUri,
    fileName: `${name}.${image.fileExtension}`,
  };
};

export default class EmailCarriedLogos {
  /**
   * `html` with every <img> that shows a logo `read` knows from its address
   * showing the logo itself (its data: URL), and those logos, for
   * EmailSize.attachWithinLimit to attach first (see the top of this file).
   * HTML with no such image comes back exactly as it was, with none.
   */
  public static async carry(
    html: string,
    read: CarriedLogoReader,
  ): Promise<EmailWithCarriedLogos> {
    const addresses: Array<string> = [];

    // The web addresses its images show, in order, each once.
    EmailInlineImages.replaceImageSources(html, (source: string): null => {
      const address: string | null = toWebAddress(source);

      if (
        address &&
        addresses.length < MAX_ADDRESSES_READ_PER_EMAIL &&
        !addresses.includes(address)
      ) {
        addresses.push(address);
      }

      return null;
    });

    const carried: Map<string, CarriedLogo> = new Map<string, CarriedLogo>();

    for (const address of addresses) {
      if (carried.size >= MAX_CARRIED_LOGOS_PER_EMAIL) {
        break;
      }

      const logo: CarriedLogo | null = await EmailCarriedLogos.readLogo(
        read,
        address,
      );

      if (logo) {
        carried.set(address, logo);
      }
    }

    if (carried.size === 0) {
      return { html: html, logos: [] };
    }

    const carriedHtml: string = EmailInlineImages.replaceImageSources(
      html,
      (source: string): string | null => {
        const address: string | null = toWebAddress(source);

        return (address && carried.get(address)?.dataUri) || null;
      },
    );

    // Two addresses of one logo (two pages with the same file) carry it once.
    const logos: Array<CarriedLogo> = [];

    for (const logo of carried.values()) {
      if (
        !logos.some((kept: CarriedLogo): boolean => {
          return kept.dataUri === logo.dataUri;
        })
      ) {
        logos.push(logo);
      }
    }

    return { html: carriedHtml, logos: logos };
  }

  // What `read` answers for `address`, or null when it fails.
  private static async readLogo(
    read: CarriedLogoReader,
    address: string,
  ): Promise<CarriedLogo | null> {
    try {
      const logo: CarriedLogo | null = await read(address);

      if (!logo || typeof logo.dataUri !== "string") {
        return null;
      }

      /*
       * Only a logo as toCarriedLogo writes one: an image every mail client
       * draws, small enough, and a data: URL written out the way
       * InlineImageDataUri writes it - letters, digits and "+/=:;," only -
       * because it goes into the <img> as it is.
       */
      const image: InlineImageDataUri | null = parseInlineImageDataUri(
        logo.dataUri,
      );

      if (
        !image ||
        image.dataUri !== logo.dataUri ||
        !CARRIED_LOGO_TYPES.includes(image.mimeType) ||
        image.byteLength > MAX_CARRIED_LOGO_BYTES
      ) {
        return null;
      }

      return {
        dataUri: image.dataUri,
        fileName: ATTACHMENT_NAME.test(logo.fileName || "")
          ? logo.fileName
          : `${DEFAULT_ATTACHMENT_NAME}.${image.fileExtension}`,
      };
    } catch (err) {
      logger.error(
        "A logo an email shows could not be read to go inside the email, so it is shown from its address instead.",
      );
      logger.error(err);
      return null;
    }
  }
}
