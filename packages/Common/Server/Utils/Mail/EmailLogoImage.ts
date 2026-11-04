import logger from "../Logger";
import {
  CarriedLogo,
  MAX_CARRIED_LOGO_BYTES,
  toCarriedLogo,
} from "./EmailCarriedLogos";
import {
  InlineImageType,
  getInlineImageTypeOfBase64,
} from "../../../Utils/Markdown/InlineImageDataUri";
import type {
  ChannelStats,
  Metadata,
  Sharp,
  SharpConstructor,
  SharpOptions,
  Stats,
} from "sharp";

/*
 * A LOGO, MADE INTO AN IMAGE THE EMAIL THAT SHOWS IT CAN CARRY.
 *
 * Just before an email goes out, a logo it shows by its address goes
 * inside it instead (EmailCarriedLogos, issue #5124 and #5459): an image
 * the reader's mail client draws without fetching anything, on any
 * network. An email can carry an image every mail client draws - a PNG, a
 * JPEG or a GIF - of at most MAX_CARRIED_LOGO_BYTES. A logo uploaded as
 * one went as it was; every other logo stayed its address. An SVG (which
 * Gmail and Outlook do not draw), a WebP (which Outlook does not draw) and
 * a file over the limit then showed a broken image, or nothing, wherever a
 * mail client could not or would not fetch it - which is most of them.
 *
 * So such a logo is made into an image an email can carry, the size the
 * header draws it at: at most EMAIL_LOGO_PIXEL_DENSITY times the box the
 * header draws it in (EmailLogoBox), crisp on a 3x screen, as OneUptime's
 * own email logo is (EmailLogo). A PNG, a WebP, a GIF and an SVG become a
 * PNG, which keeps their transparency; a JPEG stays a JPEG, as small as a
 * photograph is in one. An image larger than the header needs is made
 * smaller the same way, even one that could go as it was, since every
 * email to every subscriber carries it - unless the image as it was is the
 * smaller file. A logo that already fits the header goes as it was, byte
 * for byte, and so does an animated GIF, which keeps its animation.
 *
 * What is never made, and so keeps its address, as before:
 *   - a file that is not a PNG, JPEG, GIF, WebP or SVG, by its own first
 *     bytes (a TIFF, an AVIF, an icon file, a gzipped SVG): the five a
 *     logo is uploaded as, and no more image decoders run on what an
 *     uploader wrote than those;
 *   - an SVG that draws words (<text>, <tspan>, <textPath>, or HTML in a
 *     <foreignObject>): the server has no font for them, so they would be
 *     drawn as empty boxes, or in a font the logo was never designed in.
 *     Words turned into outlines in a design tool are shapes, and are
 *     made like any other;
 *   - an image that draws nothing at all, bytes the image library cannot
 *     read, a file over MAX_LOGO_FILE_BYTES_MADE_FOR_EMAIL or an image
 *     over MAX_LOGO_PIXELS_MADE_FOR_EMAIL, and a logo not made within
 *     EMAIL_LOGO_TIME_LIMIT_IN_MS.
 * Where making one fails, a logo that could go as it was still goes as it
 * was: nothing is ever shown worse than before.
 *
 * The image library is sharp (libvips), loaded the first time a logo is
 * made, with its cache off and one thread an image, and at most
 * MAX_EMAIL_LOGOS_MADE_AT_ONCE logos made at a time. An SVG is drawn
 * without anything it names outside itself (no file, no address is read)
 * and without its scripts. A made image carries no metadata of the file
 * it came from (EXIF, where a photograph was taken), and claims no print
 * resolution: a mail client that sizes an image by its resolution
 * (Outlook on Windows) draws it as it draws every other.
 *
 * Callers keep what they read: StatusPageCarriedLogo for a minute a page,
 * App's EmailBranding for as long as the installation's logo is the same.
 */

// The widest and tallest a header draws a logo, in CSS pixels.
export interface EmailLogoBox {
  width: number;
  height: number;
}

/*
 * Where a status page's emails draw its logo (Templates/Partials/
 * CustomLogo.hbs: max-width 200px, max-height 48px).
 */
export const STATUS_PAGE_EMAIL_LOGO_BOX: EmailLogoBox = {
  width: 200,
  height: 48,
};

/*
 * Where the header of every other email draws the installation's own logo
 * (Templates/Partials/Logo.hbs: 32px tall, at most 200px wide).
 */
export const PRODUCT_EMAIL_LOGO_BOX: EmailLogoBox = {
  width: 200,
  height: 32,
};

/*
 * Image pixels to each CSS pixel of the box: crisp on a 3x screen, as
 * OneUptime's own email logo (96 x 96 pixels, drawn at 32 x 32).
 */
export const EMAIL_LOGO_PIXEL_DENSITY: number = 3;

/*
 * The largest file made into an email's logo: the largest upload the
 * server takes (MAX_MULTIPART_FILE_BYTES).
 */
export const MAX_LOGO_FILE_BYTES_MADE_FOR_EMAIL: number = 50 * 1024 * 1024;

/*
 * The most pixels an image made into an email's logo may have: 8,000 x
 * 8,000, more than any camera a logo was ever photographed with. A file a
 * few kilobytes long can claim billions, and decoding them is the cost.
 */
export const MAX_LOGO_PIXELS_MADE_FOR_EMAIL: number = 64 * 1000 * 1000;

// How long making one logo may take, waiting for its turn included.
export const EMAIL_LOGO_TIME_LIMIT_IN_MS: number = 10 * 1000;

// How many logos are made at once: the rest wait their turn.
export const MAX_EMAIL_LOGOS_MADE_AT_ONCE: number = 2;

// The types a logo is made from, by its own first bytes.
export enum EmailLogoSourceType {
  Png = "png",
  Jpeg = "jpeg",
  Gif = "gif",
  Webp = "webp",
  Svg = "svg",
}

// What an email carries for a logo, and why.
export enum EmailLogoOutcome {
  // The logo as it was uploaded: it fits the header, or is an animation.
  AsUploaded = "AsUploaded",
  // An image made from the logo, sized for the header.
  Made = "Made",
  // No logo: no bytes.
  NoLogo = "NoLogo",
  // Not a PNG, JPEG, GIF, WebP or SVG file.
  UnsupportedType = "UnsupportedType",
  // An SVG that draws words the server has no font for.
  SvgWithText = "SvgWithText",
  // A file over MAX_LOGO_FILE_BYTES_MADE_FOR_EMAIL, or an image over MAX_LOGO_PIXELS_MADE_FOR_EMAIL.
  TooLarge = "TooLarge",
  // Bytes the image library could not read or draw.
  Unreadable = "Unreadable",
  // An image that draws nothing at all.
  DrawsNothing = "DrawsNothing",
  // Not made within EMAIL_LOGO_TIME_LIMIT_IN_MS.
  TimedOut = "TimedOut",
}

export interface EmailLogoResult {
  /*
   * What the email carries, or null when it keeps the logo's address. On
   * a failure (Unreadable, DrawsNothing, TimedOut), the logo as it was
   * uploaded when it could go as it was.
   */
  logo: CarriedLogo | null;
  outcome: EmailLogoOutcome;
}

export interface EmailLogoRequest {
  // The logo file, as it was uploaded.
  bytes: Buffer | null | undefined;
  // The attachment's name, without its extension.
  name: string;
  // Where the header draws it.
  box: EmailLogoBox;
  // Which logo, for the server's log ("The logo of status page ...").
  label?: string | undefined;
  // Tests shorten it.
  timeLimitInMs?: number | undefined;
}

type SharpLibrary = SharpConstructor;

// The density librsvg draws an SVG at, and gives its size at: 72 DPI.
const SVG_BASE_DENSITY: number = 72;

// sharp draws an SVG at 1 to 100,000 DPI.
const MIN_SVG_DENSITY: number = 1;
const MAX_SVG_DENSITY: number = 100000;

// The first bytes read to tell an SVG, which is text, from other files.
const SVG_HEAD_BYTES: number = 1024;

const BYTE_ORDER_MARK: string = "\u{FEFF}";
const NUL: string = "\u{0}";

/*
 * An element that draws words: <text>, <tspan>, <textPath>, or a
 * <foreignObject> (HTML, which is mostly words), with or without a
 * namespace prefix (<svg:text>). XML names are case-sensitive. Linear: the
 * prefix's characters cannot hold a "<", so no match attempt reads past
 * the next one.
 */
const TEXT_ELEMENT: RegExp =
  /<(?:[A-Za-z_][\w.-]*:)?(?:text|tspan|textPath|foreignObject)(?=[\s/>])/;

// How a JPEG logo is written again: as crisp on screen as a logo needs.
const JPEG_QUALITY: number = 90;

// A PNG chunk: its length, type and checksum around its data.
const PNG_SIGNATURE_BYTES: number = 8;
const PNG_CHUNK_OVERHEAD_BYTES: number = 12;
const PNG_PHYSICAL_SIZE_CHUNK: string = "pHYs";

/*
 * The type `bytes` are by their first bytes - one of the four raster
 * types, or text that starts with markup, which only the image library
 * can tell is an SVG - or null for anything else: a TIFF, an AVIF, an
 * icon, a gzipped SVG, text that is not markup, or UTF-16 text (with NUL
 * bytes in it), which the search for words below could not read.
 */
export const readLogoSourceType: (
  bytes: Buffer,
) => EmailLogoSourceType | null = (
  bytes: Buffer,
): EmailLogoSourceType | null => {
  const raster: InlineImageType | null = getInlineImageTypeOfBase64(
    bytes.subarray(0, 12).toString("base64"),
  );

  if (raster) {
    switch (raster.mimeType) {
      case "image/png":
        return EmailLogoSourceType.Png;
      case "image/jpeg":
        return EmailLogoSourceType.Jpeg;
      case "image/gif":
        return EmailLogoSourceType.Gif;
      case "image/webp":
        return EmailLogoSourceType.Webp;
    }
  }

  const head: string = bytes.subarray(0, SVG_HEAD_BYTES).toString("utf8");

  if (head.includes(NUL)) {
    return null;
  }

  const text: string = (
    head.startsWith(BYTE_ORDER_MARK) ? head.slice(BYTE_ORDER_MARK.length) : head
  ).trimStart();

  return text.startsWith("<") ? EmailLogoSourceType.Svg : null;
};

/*
 * Whether an SVG draws words (TEXT_ELEMENT) anywhere in it, its comments
 * and declarations included: a logo with such an element in a comment
 * keeps its address too, which is never worse than before.
 */
export const svgDrawsText: (bytes: Buffer) => boolean = (
  bytes: Buffer,
): boolean => {
  return TEXT_ELEMENT.test(bytes.toString("utf8"));
};

/*
 * The density to draw an SVG of `size` (as librsvg gives it, at 72 DPI)
 * at, so that it fills `pixelBox` at most.
 */
export const svgDensityFor: (
  size: EmailLogoBox,
  pixelBox: EmailLogoBox,
) => number = (size: EmailLogoBox, pixelBox: EmailLogoBox): number => {
  const scale: number = Math.min(
    pixelBox.width / size.width,
    pixelBox.height / size.height,
  );

  return Math.min(
    MAX_SVG_DENSITY,
    Math.max(MIN_SVG_DENSITY, SVG_BASE_DENSITY * scale),
  );
};

// The box in image pixels: the header's box at EMAIL_LOGO_PIXEL_DENSITY.
export const toPixelBox: (box: EmailLogoBox) => EmailLogoBox = (
  box: EmailLogoBox,
): EmailLogoBox => {
  return {
    width: Math.round(box.width * EMAIL_LOGO_PIXEL_DENSITY),
    height: Math.round(box.height * EMAIL_LOGO_PIXEL_DENSITY),
  };
};

/*
 * A PNG without its pHYs chunk - the print resolution an image library
 * wrote, the density an SVG was drawn at, or 25.4 DPI for an image that had
 * none - so a mail client that sizes an image by its resolution does not
 * draw it larger or smaller than its pixels. Every other chunk is kept as
 * it was, and a PNG whose chunks do not add up comes back as it was.
 */
export const withoutPhysicalSize: (png: Buffer) => Buffer = (
  png: Buffer,
): Buffer => {
  const kept: Array<Buffer> = [png.subarray(0, PNG_SIGNATURE_BYTES)];
  let offset: number = PNG_SIGNATURE_BYTES;
  let isRemoved: boolean = false;

  while (offset < png.length) {
    if (offset + PNG_CHUNK_OVERHEAD_BYTES > png.length) {
      return png;
    }

    const end: number =
      offset + PNG_CHUNK_OVERHEAD_BYTES + png.readUInt32BE(offset);

    if (end > png.length) {
      return png;
    }

    if (
      png.toString("latin1", offset + 4, offset + 8) === PNG_PHYSICAL_SIZE_CHUNK
    ) {
      isRemoved = true;
    } else {
      kept.push(png.subarray(offset, end));
    }

    offset = end;
  }

  return isRemoved ? Buffer.concat(kept) : png;
};

// The format the image library reads each source type as.
const LIBRARY_FORMAT: Record<EmailLogoSourceType, string> = {
  [EmailLogoSourceType.Png]: "png",
  [EmailLogoSourceType.Jpeg]: "jpeg",
  [EmailLogoSourceType.Gif]: "gif",
  [EmailLogoSourceType.Webp]: "webp",
  [EmailLogoSourceType.Svg]: "svg",
};

interface MakeInput {
  library: SharpLibrary;
  bytes: Buffer;
  sourceType: EmailLogoSourceType;
  name: string;
  pixelBox: EmailLogoBox;
  asUploaded: CarriedLogo | null;
  timeLimitInMs: number;
}

export default class EmailLogoImage {
  private static loading: Promise<SharpLibrary | null> | null = null;
  private static running: number = 0;
  private static waiting: Array<() => void> = [];

  // How the image library is loaded: tests stand in a library that fails.
  private static importLibrary: () => Promise<{ default: SharpLibrary }> =
    (): Promise<{ default: SharpLibrary }> => {
      return import("sharp");
    };

  /**
   * What an email whose header draws a logo in `box` carries for the logo
   * file `bytes`, and why (see the top of this file). Never throws: a logo
   * that cannot be made comes back as it was uploaded, when it could go as
   * it was, or as null, and the email keeps the logo's address.
   */
  public static async carriedLogoOf(
    request: EmailLogoRequest,
  ): Promise<EmailLogoResult> {
    const bytes: Buffer | null | undefined = request.bytes;

    if (!bytes || !Buffer.isBuffer(bytes) || bytes.length === 0) {
      return { logo: null, outcome: EmailLogoOutcome.NoLogo };
    }

    const label: string = request.label || "A logo";

    if (bytes.length > MAX_LOGO_FILE_BYTES_MADE_FOR_EMAIL) {
      return EmailLogoImage.refused(label, EmailLogoOutcome.TooLarge);
    }

    const sourceType: EmailLogoSourceType | null = readLogoSourceType(bytes);

    if (!sourceType) {
      return EmailLogoImage.refused(label, EmailLogoOutcome.UnsupportedType);
    }

    if (sourceType === EmailLogoSourceType.Svg && svgDrawsText(bytes)) {
      return EmailLogoImage.refused(label, EmailLogoOutcome.SvgWithText);
    }

    const asUploaded: CarriedLogo | null = toCarriedLogo(bytes, request.name);
    const timeLimitInMs: number =
      request.timeLimitInMs ?? EMAIL_LOGO_TIME_LIMIT_IN_MS;

    const library: SharpLibrary | null = await EmailLogoImage.loadLibrary();

    if (!library) {
      // Logged once, as it failed to load.
      return {
        logo: asUploaded,
        outcome: asUploaded
          ? EmailLogoOutcome.AsUploaded
          : EmailLogoOutcome.Unreadable,
      };
    }

    let timer: NodeJS.Timeout | undefined = undefined;
    let isTimedOut: boolean = false;

    const deadline: Promise<EmailLogoResult> = new Promise<EmailLogoResult>(
      (resolve: (result: EmailLogoResult) => void) => {
        timer = setTimeout(() => {
          isTimedOut = true;
          resolve({ logo: asUploaded, outcome: EmailLogoOutcome.TimedOut });
        }, timeLimitInMs);
      },
    );

    const made: Promise<EmailLogoResult> = EmailLogoImage.inTurn(
      async (): Promise<EmailLogoResult> => {
        // Its turn came after the email stopped waiting: nothing to make.
        if (isTimedOut) {
          return { logo: asUploaded, outcome: EmailLogoOutcome.TimedOut };
        }

        return await EmailLogoImage.make({
          library: library,
          bytes: bytes,
          sourceType: sourceType,
          name: request.name,
          pixelBox: toPixelBox(request.box),
          asUploaded: asUploaded,
          timeLimitInMs: timeLimitInMs,
        });
      },
    );

    let result: EmailLogoResult;

    try {
      result = await Promise.race([made, deadline]);
    } catch {
      // make() catches what the library throws; anything else is the same.
      result = {
        logo: asUploaded,
        outcome: EmailLogoOutcome.Unreadable,
      };
    } finally {
      clearTimeout(timer);
    }

    EmailLogoImage.log(label, result.outcome);

    return result;
  }

  // Forgets the image library, so the next logo loads it again (for tests).
  public static resetLibrary(): void {
    EmailLogoImage.loading = null;
  }

  // The image library, loaded once; null when it cannot be (logged once).
  private static loadLibrary(): Promise<SharpLibrary | null> {
    if (!EmailLogoImage.loading) {
      EmailLogoImage.loading = EmailLogoImage.importLibrary().then(
        (loaded: { default: SharpLibrary }): SharpLibrary => {
          const library: SharpLibrary = loaded.default;

          /*
           * No cache of decoded images: each logo is made once a minute
           * at most, and its pixels are let go of at once. One thread an
           * image: a logo is small, and the server has other work.
           */
          library.cache(false);
          library.concurrency(1);

          return library;
        },
        (err: unknown): null => {
          logger.error(
            "The image library that makes logos for emails could not be loaded, so emails show an SVG, a WebP or a large logo from its address.",
          );
          logger.error(err);

          return null;
        },
      );
    }

    return EmailLogoImage.loading;
  }

  // Runs `work` when one of MAX_EMAIL_LOGOS_MADE_AT_ONCE turns is free.
  private static async inTurn<T>(work: () => Promise<T>): Promise<T> {
    if (EmailLogoImage.running < MAX_EMAIL_LOGOS_MADE_AT_ONCE) {
      EmailLogoImage.running++;
    } else {
      // The turn is handed over by the work that ends (below).
      await new Promise<void>((resolve: () => void) => {
        EmailLogoImage.waiting.push(resolve);
      });
    }

    try {
      return await work();
    } finally {
      const next: (() => void) | undefined = EmailLogoImage.waiting.shift();

      if (next) {
        next();
      } else {
        EmailLogoImage.running--;
      }
    }
  }

  private static refused(
    label: string,
    outcome: EmailLogoOutcome,
  ): EmailLogoResult {
    EmailLogoImage.log(label, outcome);

    return { logo: null, outcome: outcome };
  }

  private static log(label: string, outcome: EmailLogoOutcome): void {
    const shownFromAddress: string =
      "so the emails that show it show it from its address";

    switch (outcome) {
      case EmailLogoOutcome.UnsupportedType:
        logger.debug(
          `${label} is not a PNG, JPEG, GIF, WebP or SVG file, ${shownFromAddress}.`,
        );
        return;
      case EmailLogoOutcome.SvgWithText:
        logger.debug(
          `${label} is an SVG that draws words, which the server has no font for, ${shownFromAddress}. Turning its words into outlines (paths) in a design tool lets emails carry it.`,
        );
        return;
      case EmailLogoOutcome.TooLarge:
        logger.debug(
          `${label} is larger than an email's logo is made from, ${shownFromAddress}.`,
        );
        return;
      case EmailLogoOutcome.DrawsNothing:
        logger.debug(
          `${label} draws nothing when it is made into an image for emails, ${shownFromAddress}.`,
        );
        return;
      case EmailLogoOutcome.Unreadable:
        logger.warn(
          `${label} could not be read to make an image for emails, so the emails that show it carry it as it was uploaded, or show it from its address.`,
        );
        return;
      case EmailLogoOutcome.TimedOut:
        logger.warn(
          `${label} took too long to make into an image for emails, so the emails that show it carry it as it was uploaded, or show it from its address.`,
        );
        return;
      default:
        return;
    }
  }

  /*
   * The logo made for the header (see the top of this file). Anything the
   * image library throws - bytes it cannot read, a drawing it gives up on -
   * is a logo that could not be made.
   */
  private static async make(input: MakeInput): Promise<EmailLogoResult> {
    try {
      return await EmailLogoImage.makeWithLibrary(input);
    } catch {
      return { logo: input.asUploaded, outcome: EmailLogoOutcome.Unreadable };
    }
  }

  private static async makeWithLibrary(
    input: MakeInput,
  ): Promise<EmailLogoResult> {
    const library: SharpLibrary = input.library;
    const fallBack: (outcome: EmailLogoOutcome) => EmailLogoResult = (
      outcome: EmailLogoOutcome,
    ): EmailLogoResult => {
      return { logo: input.asUploaded, outcome: outcome };
    };

    // The header only: a size claimed is read, never decoded here.
    const metadata: Metadata = await library(input.bytes, {
      limitInputPixels: false,
    }).metadata();

    if (metadata.format !== LIBRARY_FORMAT[input.sourceType]) {
      return fallBack(EmailLogoOutcome.Unreadable);
    }

    const isVector: boolean = input.sourceType === EmailLogoSourceType.Svg;

    // As a mail client draws it: turned the way its EXIF says.
    const size: EmailLogoBox = {
      width: metadata.autoOrient?.width || metadata.width,
      height: metadata.autoOrient?.height || metadata.height,
    };

    if (!(size.width >= 1) || !(size.height >= 1)) {
      return fallBack(EmailLogoOutcome.Unreadable);
    }

    if (
      !isVector &&
      size.width * size.height > MAX_LOGO_PIXELS_MADE_FOR_EMAIL
    ) {
      return { logo: null, outcome: EmailLogoOutcome.TooLarge };
    }

    if (
      input.asUploaded &&
      ((metadata.pages || 1) > 1 ||
        (size.width <= input.pixelBox.width &&
          size.height <= input.pixelBox.height))
    ) {
      // It fits the header as it is, or is an animation: as it was.
      return { logo: input.asUploaded, outcome: EmailLogoOutcome.AsUploaded };
    }

    const options: SharpOptions = {
      limitInputPixels: MAX_LOGO_PIXELS_MADE_FOR_EMAIL,
      autoOrient: true,
    };

    if (isVector) {
      options.density = svgDensityFor(size, input.pixelBox);
    }

    const isJpeg: boolean = input.sourceType === EmailLogoSourceType.Jpeg;

    const pipeline: Sharp = library(input.bytes, options)
      .resize({
        width: input.pixelBox.width,
        height: input.pixelBox.height,
        fit: "inside",
        // A raster image is never made larger than it is; an SVG is drawn to fit.
        withoutEnlargement: !isVector,
      })
      .toColourspace("srgb")
      // Past the email's own limit, so the library stops soon after it.
      .timeout({ seconds: Math.ceil(input.timeLimitInMs / 1000) + 1 });

    let image: Buffer = await (
      isJpeg
        ? pipeline.jpeg({ quality: JPEG_QUALITY, chromaSubsampling: "4:4:4" })
        : pipeline.png({ compressionLevel: 9, adaptiveFiltering: true })
    ).toBuffer();

    if (!isJpeg) {
      const stats: Stats = await library(image).stats();
      const alpha: ChannelStats | undefined = stats.channels[3];

      if (alpha && alpha.max === 0) {
        return fallBack(EmailLogoOutcome.DrawsNothing);
      }

      image = withoutPhysicalSize(image);
    }

    const made: CarriedLogo | null =
      image.length <= MAX_CARRIED_LOGO_BYTES
        ? toCarriedLogo(image, input.name)
        : null;

    if (!made) {
      return fallBack(EmailLogoOutcome.Unreadable);
    }

    // Never more bytes in every email than the logo as it was.
    if (input.asUploaded && input.bytes.length <= image.length) {
      return { logo: input.asUploaded, outcome: EmailLogoOutcome.AsUploaded };
    }

    return { logo: made, outcome: EmailLogoOutcome.Made };
  }
}
