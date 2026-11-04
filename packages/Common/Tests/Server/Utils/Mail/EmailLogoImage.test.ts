import EmailCarriedLogos, {
  CarriedLogo,
  CarriedLogoReader,
  EmailWithCarriedLogos,
  MAX_CARRIED_LOGO_BYTES,
  toCarriedLogo,
} from "../../../../Server/Utils/Mail/EmailCarriedLogos";
import { EMAIL_LOGO_PATH } from "../../../../Server/Utils/Mail/EmailLogo";
import EmailLogoImage, {
  EMAIL_LOGO_PIXEL_DENSITY,
  EMAIL_LOGO_TIME_LIMIT_IN_MS,
  EmailLogoBox,
  EmailLogoOutcome,
  EmailLogoRequest,
  EmailLogoResult,
  EmailLogoSourceType,
  MAX_EMAIL_LOGOS_MADE_AT_ONCE,
  MAX_LOGO_FILE_BYTES_MADE_FOR_EMAIL,
  MAX_LOGO_PIXELS_MADE_FOR_EMAIL,
  PRODUCT_EMAIL_LOGO_BOX,
  STATUS_PAGE_EMAIL_LOGO_BOX,
  readLogoSourceType,
  svgDensityFor,
  svgDrawsText,
  toPixelBox,
  withoutPhysicalSize,
} from "../../../../Server/Utils/Mail/EmailLogoImage";
import logger from "../../../../Server/Utils/Logger";
import { MAX_MULTIPART_FILE_BYTES } from "../../../../Server/Middleware/MultipartFormData";
import {
  INDIGO,
  ImageFacts,
  ORANGE,
  RED,
  Rgba,
  animatedLogo,
  cellsLogo,
  dataUriBytes,
  imageFacts,
  isAbout,
  noiseLogo,
  pixelAt,
  pngChunkTypes,
  solidLogo,
  svgLogo,
  twoColourLogo,
} from "../../../Helpers/EmailLogoFixtures";
import {
  FastestRun,
  fastestRun,
  fastestRunAsync,
} from "../../../Helpers/FastestRun";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import http from "http";
import { AddressInfo } from "net";
import os from "os";
import path from "path";
import sharp from "sharp";
import zlib from "zlib";

/*
 * A LOGO, MADE INTO AN IMAGE THE EMAIL THAT SHOWS IT CAN CARRY
 * (Server/Utils/Mail/EmailLogoImage).
 *
 * An email carries a logo inside itself only as an image every mail client
 * draws: a PNG, a JPEG or a GIF of at most 512 KB (EmailCarriedLogos). A
 * status page logo that was an SVG, a WebP or a larger file stayed its
 * address (#5459), and Gmail and Outlook - which draw no SVG, and Outlook
 * no WebP - or any mail client that could not reach the installation
 * showed a broken image. Such a logo is now made into an image sized for
 * the header that draws it (3x its box), with the real image library, and
 * these tests read back what a mail client would draw: each image's type,
 * size and pixels.
 */

const BOX: EmailLogoBox = STATUS_PAGE_EMAIL_LOGO_BOX;
const PIXEL_BOX: EmailLogoBox = toPixelBox(BOX);

const carry: (
  bytes: Buffer | null | undefined,
  more?: Partial<EmailLogoRequest>,
) => Promise<EmailLogoResult> = (
  bytes: Buffer | null | undefined,
  more: Partial<EmailLogoRequest> = {},
): Promise<EmailLogoResult> => {
  return EmailLogoImage.carriedLogoOf({
    bytes: bytes,
    name: "logo",
    box: BOX,
    label: "The logo of status page Acme",
    ...more,
  });
};

// The image a result carries, as the file the email attaches.
const carriedBytes: (result: EmailLogoResult) => Buffer = (
  result: EmailLogoResult,
): Buffer => {
  expect(result.logo).not.toBeNull();

  return dataUriBytes(result.logo!.dataUri);
};

// A colour at a fraction of an image's width and height.
const colourAt: (
  image: Buffer,
  facts: ImageFacts,
  fractionX: number,
  fractionY: number,
) => Promise<Rgba> = (
  image: Buffer,
  facts: ImageFacts,
  fractionX: number,
  fractionY: number,
): Promise<Rgba> => {
  return pixelAt(
    image,
    Math.floor(facts.width * fractionX),
    Math.floor(facts.height * fractionY),
  );
};

/*
 * EmailLogoImage's private make(), which tests replace to hold a logo in
 * the making for as long as they need.
 */
type MakeFunction = (input: unknown) => Promise<EmailLogoResult>;

const makeOf: () => { make: MakeFunction } = (): { make: MakeFunction } => {
  return EmailLogoImage as unknown as { make: MakeFunction };
};

interface HeldMaking {
  promise: Promise<EmailLogoResult>;
  finish: (result: EmailLogoResult) => void;
}

const heldMakings: Array<HeldMaking> = [];

// Every logo is held in the making until the test finishes it.
const holdEveryMaking: () => ReturnType<typeof jest.spyOn> =
  (): ReturnType<typeof jest.spyOn> => {
    return jest
      .spyOn(makeOf(), "make")
      .mockImplementation((): Promise<EmailLogoResult> => {
        let finish: (result: EmailLogoResult) => void = (): void => {
          return undefined;
        };
        const promise: Promise<EmailLogoResult> = new Promise<EmailLogoResult>(
          (resolve: (result: EmailLogoResult) => void) => {
            finish = resolve;
          },
        );

        heldMakings.push({ promise: promise, finish: finish });

        return promise;
      });
  };

// Lets every promise that can settle settle.
const settle: () => Promise<void> = async (): Promise<void> => {
  for (let round: number = 0; round < 5; round++) {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  }
};

const MADE_ELSEWHERE: EmailLogoResult = {
  logo: null,
  outcome: EmailLogoOutcome.DrawsNothing,
};

// The test logos: real files of every type, made once.
let PNG_THAT_FITS: Buffer;
let JPEG_THAT_FITS: Buffer;
let GIF_THAT_FITS: Buffer;
let WIDE_PNG: Buffer;
let WIDE_GIF: Buffer;
let PNG_OVER_LIMIT: Buffer;
let JPEG_OVER_LIMIT: Buffer;
let SMALL_WEBP: Buffer;
let WIDE_WEBP: Buffer;
let ANIMATED_GIF: Buffer;
let ANIMATED_WEBP: Buffer;
let CELLS_PNG: Buffer;
let TIFF: Buffer;
let AVIF: Buffer;

const TWO_COLOUR_SVG: Buffer = svgLogo(
  `<rect width="60" height="40" fill="rgb(${INDIGO.r},${INDIGO.g},${INDIGO.b})"/><rect x="60" width="60" height="40" fill="rgb(${ORANGE.r},${ORANGE.g},${ORANGE.b})"/>`,
);

beforeAll(async () => {
  PNG_THAT_FITS = fs.readFileSync(EMAIL_LOGO_PATH);
  JPEG_THAT_FITS = await solidLogo({
    width: 300,
    height: 80,
    format: "jpeg",
    color: INDIGO,
  });
  GIF_THAT_FITS = await solidLogo({
    width: 300,
    height: 80,
    format: "gif",
    color: INDIGO,
  });
  WIDE_PNG = await twoColourLogo({
    width: 1600,
    height: 400,
    format: "png",
    left: INDIGO,
    right: { ...ORANGE, alpha: 0 },
  });
  WIDE_GIF = await twoColourLogo({
    width: 1600,
    height: 400,
    format: "gif",
    left: INDIGO,
    right: ORANGE,
  });
  PNG_OVER_LIMIT = await noiseLogo({
    width: 1200,
    height: 300,
    format: "png",
    seed: 5459,
  });
  JPEG_OVER_LIMIT = await noiseLogo({
    width: 1600,
    height: 600,
    format: "jpeg",
    seed: 5460,
  });
  SMALL_WEBP = await twoColourLogo({
    width: 300,
    height: 80,
    format: "webp",
    left: INDIGO,
    right: { ...ORANGE, alpha: 0.5 },
  });
  WIDE_WEBP = await twoColourLogo({
    width: 3000,
    height: 1000,
    format: "webp",
    left: INDIGO,
    right: ORANGE,
  });
  ANIMATED_GIF = await animatedLogo({
    width: 900,
    height: 300,
    colors: [INDIGO, ORANGE, RED],
    format: "gif",
  });
  ANIMATED_WEBP = await animatedLogo({
    width: 900,
    height: 300,
    colors: [INDIGO, ORANGE, RED],
    format: "webp",
  });
  CELLS_PNG = await cellsLogo({
    width: 1000,
    height: 250,
    cell: 8,
    seed: 5459,
  });
  TIFF = await solidLogo({
    width: 64,
    height: 32,
    format: "tiff",
    color: INDIGO,
  });
  AVIF = await solidLogo({
    width: 64,
    height: 32,
    format: "avif",
    color: INDIGO,
  });

  // The library loads before the tests that time or hold a making.
  await carry(TWO_COLOUR_SVG);
});

afterEach(async () => {
  // Every making a test held, finished, so its turn is free again.
  for (const making of heldMakings.splice(0)) {
    making.finish(MADE_ELSEWHERE);
  }

  await settle();
  jest.restoreAllMocks();
  EmailLogoImage.resetLibrary();
});

describe("the box an email draws a logo in", () => {
  test("a status page's emails draw its logo in 200 x 48, the installation's header its own in 200 x 32", () => {
    expect(STATUS_PAGE_EMAIL_LOGO_BOX).toEqual({ width: 200, height: 48 });
    expect(PRODUCT_EMAIL_LOGO_BOX).toEqual({ width: 200, height: 32 });
  });

  test("made at three image pixels to each pixel of the box, as OneUptime's own logo is", async () => {
    expect(EMAIL_LOGO_PIXEL_DENSITY).toBe(3);
    expect(toPixelBox(STATUS_PAGE_EMAIL_LOGO_BOX)).toEqual({
      width: 600,
      height: 144,
    });
    expect(toPixelBox(PRODUCT_EMAIL_LOGO_BOX)).toEqual({
      width: 600,
      height: 96,
    });

    // OneUptime's logo: 96 x 96 pixels, drawn at 32 x 32.
    const ownLogo: ImageFacts = await imageFacts(PNG_THAT_FITS);

    expect([ownLogo.width, ownLogo.height]).toEqual([
      32 * EMAIL_LOGO_PIXEL_DENSITY,
      32 * EMAIL_LOGO_PIXEL_DENSITY,
    ]);
  });

  test("the largest file made into one is the largest upload the server takes", () => {
    expect(MAX_LOGO_FILE_BYTES_MADE_FOR_EMAIL).toBe(MAX_MULTIPART_FILE_BYTES);
  });

  test("an image made into one has at most 64 million pixels, and a logo is made within ten seconds", () => {
    expect(MAX_LOGO_PIXELS_MADE_FOR_EMAIL).toBe(8000 * 8000);
    expect(EMAIL_LOGO_TIME_LIMIT_IN_MS).toBe(10 * 1000);
    expect(MAX_EMAIL_LOGOS_MADE_AT_ONCE).toBe(2);
  });
});

describe("readLogoSourceType", () => {
  test("a PNG, a JPEG, a GIF and a WebP by their own first bytes", () => {
    expect(readLogoSourceType(PNG_THAT_FITS)).toBe(EmailLogoSourceType.Png);
    expect(readLogoSourceType(JPEG_THAT_FITS)).toBe(EmailLogoSourceType.Jpeg);
    expect(readLogoSourceType(GIF_THAT_FITS)).toBe(EmailLogoSourceType.Gif);
    expect(readLogoSourceType(SMALL_WEBP)).toBe(EmailLogoSourceType.Webp);
  });

  test("an SVG: text that starts with markup, after a byte order mark or white space", () => {
    for (const text of [
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      '<?xml version="1.0" encoding="UTF-8"?><svg></svg>',
      "<!-- Made in a design tool --><svg></svg>",
      '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg></svg>',
      "\u{FEFF}<svg></svg>",
      "\n\t  <svg></svg>",
    ]) {
      expect(readLogoSourceType(Buffer.from(text, "utf8"))).toBe(
        EmailLogoSourceType.Svg,
      );
    }
  });

  test("anything else is not made into an email's logo: a TIFF, an AVIF, an icon, a bitmap, a PDF, a gzipped SVG, UTF-16, plain text", () => {
    for (const bytes of [
      TIFF,
      AVIF,
      Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x10, 0x10]),
      Buffer.concat([Buffer.from("BM", "latin1"), Buffer.alloc(60, 1)]),
      Buffer.from("%PDF-1.7\n%âãÏÓ\n", "latin1"),
      zlib.gzipSync(TWO_COLOUR_SVG),
      Buffer.from(`\u{FEFF}${TWO_COLOUR_SVG.toString("utf8")}`, "utf16le"),
      Buffer.from("Acme Corporation", "utf8"),
      Buffer.from("   ", "utf8"),
    ]) {
      expect(readLogoSourceType(bytes)).toBeNull();
    }
  });
});

describe("svgDrawsText", () => {
  test("an SVG with words in it: text, tspan, textPath and foreignObject, with or without a namespace prefix", () => {
    for (const body of [
      '<text x="5" y="30">Acme</text>',
      '<text\nx="5">Acme</text>',
      "<text/>",
      '<g><text><tspan x="0">Ac</tspan></text></g>',
      '<tspan x="0">me</tspan>',
      '<textPath href="#curve">Acme</textPath>',
      '<foreignObject width="100" height="40"><div xmlns="http://www.w3.org/1999/xhtml">Acme</div></foreignObject>',
      '<svg:text x="5" y="30">Acme</svg:text>',
      "<!-- <text>an old draft</text> -->",
    ]) {
      expect(svgDrawsText(svgLogo(body))).toBe(true);
    }
  });

  test("an SVG of shapes alone, whatever its attributes, titles and styles say", () => {
    for (const body of [
      '<rect width="120" height="40" class="text"/>',
      "<title>Acme text logo</title><desc>The words, as shapes</desc>",
      "<style>.text { fill: red; } text { font-family: Inter; }</style>",
      '<path d="M0 0h10v10z" data-name="textPath"/>',
      '<textArea width="10" height="10"/>',
      '<texts width="10" height="10"/>',
      '<g id="text"><rect width="1" height="1"/></g>',
    ]) {
      expect(svgDrawsText(svgLogo(body))).toBe(false);
    }
  });

  test("takes time in line with the SVG: 400,000 characters of its worst cases", () => {
    for (const worstCase of [
      "<a".repeat(200000),
      `<${"a".repeat(400000)}`,
      "<a:".repeat(133334),
      `<${"a.b-c".repeat(80000)}:texts`,
      "<text".repeat(80000),
    ]) {
      const timed: FastestRun<boolean> = fastestRun({
        run: (): boolean => {
          return svgDrawsText(Buffer.from(worstCase, "utf8"));
        },
        limitInMs: 2000,
      });

      expect(timed.inMs).toBeLessThan(2000);
      expect(timed.result).toBe(false);
    }
  });
});

describe("svgDensityFor", () => {
  test("draws an SVG so it fills the box, as tall or as wide as the box lets it be", () => {
    // 120 x 40 into 600 x 144: as tall as the box, 3.6 times larger.
    expect(svgDensityFor({ width: 120, height: 40 }, PIXEL_BOX)).toBeCloseTo(
      72 * 3.6,
    );
    // 300 x 30 into 600 x 144: as wide as the box.
    expect(svgDensityFor({ width: 300, height: 30 }, PIXEL_BOX)).toBeCloseTo(
      72 * 2,
    );
    // A square is as tall as the box.
    expect(svgDensityFor({ width: 1, height: 1 }, PIXEL_BOX)).toBeCloseTo(
      72 * 144,
    );
  });

  test("an SVG that claims an enormous size is drawn at the least density the library takes", () => {
    expect(
      svgDensityFor({ width: 100000, height: 100000 }, PIXEL_BOX),
    ).toBe(1);
  });
});

describe("withoutPhysicalSize", () => {
  test("takes the pHYs chunk out of a PNG, and keeps every other chunk byte for byte", async () => {
    const withResolution: Buffer = await sharp({
      create: { width: 40, height: 20, channels: 4, background: INDIGO },
    })
      .withMetadata({ density: 300 })
      .png()
      .toBuffer();

    expect(pngChunkTypes(withResolution)).toContain("pHYs");

    const without: Buffer = withoutPhysicalSize(withResolution);

    expect(pngChunkTypes(without)).toEqual(
      pngChunkTypes(withResolution).filter((type: string): boolean => {
        return type !== "pHYs";
      }),
    );
    // The same picture: the pixels are untouched.
    expect(isAbout(await pixelAt(without, 10, 10), INDIGO)).toBe(true);
    expect(without.length).toBe(withResolution.length - (12 + 9));
  });

  test("a PNG without one, or whose chunks do not add up, comes back as it was", async () => {
    const plain: Buffer = withoutPhysicalSize(
      await sharp({
        create: { width: 4, height: 4, channels: 3, background: INDIGO },
      })
        .png()
        .toBuffer(),
    );

    expect(withoutPhysicalSize(plain)).toBe(plain);

    const truncated: Buffer = plain.subarray(0, plain.length - 5);

    expect(withoutPhysicalSize(truncated)).toBe(truncated);
  });

  test("takes time in line with the file: a PNG of 100,000 chunks", () => {
    const chunk: Buffer = Buffer.concat([
      Buffer.from([0, 0, 0, 4]),
      Buffer.from("tEXt", "latin1"),
      Buffer.from("a\0bc", "latin1"),
      Buffer.alloc(4),
    ]);
    const physical: Buffer = Buffer.concat([
      Buffer.from([0, 0, 0, 9]),
      Buffer.from("pHYs", "latin1"),
      Buffer.alloc(9),
      Buffer.alloc(4),
    ]);
    const png: Buffer = Buffer.concat([
      PNG_THAT_FITS.subarray(0, 8),
      ...Array.from({ length: 100000 }, (_: unknown, index: number): Buffer => {
        return index % 2 === 0 ? chunk : physical;
      }),
    ]);

    const timed: FastestRun<Buffer> = fastestRun({
      run: (): Buffer => {
        return withoutPhysicalSize(png);
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
    expect(timed.result.length).toBe(8 + 50000 * chunk.length);
  });
});

describe("a logo an email can carry as it is", () => {
  test("a PNG, a JPEG and a GIF that fit the header go as they were uploaded, byte for byte", async () => {
    for (const bytes of [PNG_THAT_FITS, JPEG_THAT_FITS, GIF_THAT_FITS]) {
      const result: EmailLogoResult = await carry(bytes);

      expect(result.outcome).toBe(EmailLogoOutcome.AsUploaded);
      expect(result.logo).toEqual(toCarriedLogo(bytes, "logo"));
    }
  });

  test("an animated GIF that can go as it is keeps its animation, even larger than the header", async () => {
    expect((await imageFacts(ANIMATED_GIF)).pages).toBe(3);
    expect(ANIMATED_GIF.length).toBeLessThanOrEqual(MAX_CARRIED_LOGO_BYTES);

    const result: EmailLogoResult = await carry(ANIMATED_GIF);

    expect(result.outcome).toBe(EmailLogoOutcome.AsUploaded);
    expect(carriedBytes(result).equals(ANIMATED_GIF)).toBe(true);
  });

  test("an image larger than the header needs goes as it was when it is the smaller file", async () => {
    // Cells of random colours: made smaller, every pixel blends and the file grows.
    expect(CELLS_PNG.length).toBeLessThanOrEqual(MAX_CARRIED_LOGO_BYTES);

    const result: EmailLogoResult = await carry(CELLS_PNG);

    expect(result.outcome).toBe(EmailLogoOutcome.AsUploaded);
    expect(carriedBytes(result).equals(CELLS_PNG)).toBe(true);
  });
});

describe("a logo made into an image an email can carry", () => {
  test("a PNG wider than the header needs: a PNG three times the box, the same picture, transparency kept", async () => {
    const result: EmailLogoResult = await carry(WIDE_PNG);
    const made: Buffer = carriedBytes(result);
    const facts: ImageFacts = await imageFacts(made);

    expect(result.outcome).toBe(EmailLogoOutcome.Made);
    expect(result.logo!.fileName).toBe("logo.png");
    expect(result.logo!.dataUri.startsWith("data:image/png;base64,")).toBe(
      true,
    );
    // 1,600 x 400 into 600 x 144: as tall as the box.
    expect([facts.format, facts.width, facts.height]).toEqual([
      "png",
      576,
      144,
    ]);
    expect(made.length).toBeLessThan(WIDE_PNG.length);
    expect(isAbout(await colourAt(made, facts, 0.25, 0.5), INDIGO)).toBe(true);
    expect((await colourAt(made, facts, 0.75, 0.5)).alpha).toBe(0);
  });

  test("a PNG over 512 KB is made smaller and carried, where it used to keep its address", async () => {
    expect(PNG_OVER_LIMIT.length).toBeGreaterThan(MAX_CARRIED_LOGO_BYTES);
    expect(toCarriedLogo(PNG_OVER_LIMIT, "logo")).toBeNull();

    const result: EmailLogoResult = await carry(PNG_OVER_LIMIT);
    const facts: ImageFacts = await imageFacts(carriedBytes(result));

    expect(result.outcome).toBe(EmailLogoOutcome.Made);
    expect([facts.format, facts.width, facts.height]).toEqual([
      "png",
      576,
      144,
    ]);
    expect(carriedBytes(result).length).toBeLessThanOrEqual(
      MAX_CARRIED_LOGO_BYTES,
    );
  });

  test("a JPEG over 512 KB stays a JPEG, as small as a photograph is in one", async () => {
    expect(JPEG_OVER_LIMIT.length).toBeGreaterThan(MAX_CARRIED_LOGO_BYTES);

    const result: EmailLogoResult = await carry(JPEG_OVER_LIMIT);
    const facts: ImageFacts = await imageFacts(carriedBytes(result));

    expect(result.outcome).toBe(EmailLogoOutcome.Made);
    expect(result.logo!.fileName).toBe("logo.jpg");
    expect([facts.format, facts.width, facts.height]).toEqual([
      "jpeg",
      384,
      144,
    ]);
    expect(carriedBytes(result).length).toBeLessThan(200 * 1024);
  });

  test("a WebP, which Outlook does not draw, becomes a PNG - never larger than it was - with its transparency", async () => {
    const small: EmailLogoResult = await carry(SMALL_WEBP);
    const smallMade: Buffer = carriedBytes(small);
    const smallFacts: ImageFacts = await imageFacts(smallMade);

    expect(small.outcome).toBe(EmailLogoOutcome.Made);
    expect([smallFacts.format, smallFacts.width, smallFacts.height]).toEqual([
      "png",
      300,
      80,
    ]);
    expect(isAbout(await colourAt(smallMade, smallFacts, 0.25, 0.5), INDIGO)).toBe(
      true,
    );
    expect((await colourAt(smallMade, smallFacts, 0.75, 0.5)).alpha).toBeCloseTo(
      0.5,
      1,
    );

    const wide: EmailLogoResult = await carry(WIDE_WEBP);
    const wideFacts: ImageFacts = await imageFacts(carriedBytes(wide));

    expect([wideFacts.format, wideFacts.width, wideFacts.height]).toEqual([
      "png",
      432,
      144,
    ]);
  });

  test("a GIF wider than the header becomes a PNG of it", async () => {
    const result: EmailLogoResult = await carry(WIDE_GIF);
    const made: Buffer = carriedBytes(result);
    const facts: ImageFacts = await imageFacts(made);

    expect(result.outcome).toBe(EmailLogoOutcome.Made);
    expect([facts.format, facts.width, facts.height]).toEqual([
      "png",
      576,
      144,
    ]);
    expect(isAbout(await colourAt(made, facts, 0.75, 0.5), ORANGE, 12)).toBe(
      true,
    );
  });

  test("an animation that cannot go as it is is made from its first frame", async () => {
    expect((await imageFacts(ANIMATED_WEBP)).pages).toBe(3);

    const result: EmailLogoResult = await carry(ANIMATED_WEBP);
    const made: Buffer = carriedBytes(result);
    const facts: ImageFacts = await imageFacts(made);

    expect(result.outcome).toBe(EmailLogoOutcome.Made);
    expect([facts.format, facts.pages, facts.width, facts.height]).toEqual([
      "png",
      1,
      432,
      144,
    ]);
    expect(isAbout(await colourAt(made, facts, 0.5, 0.5), INDIGO)).toBe(true);
  });

  test("an SVG, which Gmail and Outlook do not draw, is drawn to fill the header's box, crisp at 3x", async () => {
    const result: EmailLogoResult = await carry(TWO_COLOUR_SVG);
    const made: Buffer = carriedBytes(result);
    const facts: ImageFacts = await imageFacts(made);

    expect(result.outcome).toBe(EmailLogoOutcome.Made);
    expect(result.logo!.fileName).toBe("logo.png");
    // 120 x 40 drawn at 3.6 times: as tall as the box, not stretched.
    expect([facts.format, facts.width, facts.height]).toEqual([
      "png",
      432,
      144,
    ]);
    expect(isAbout(await colourAt(made, facts, 0.25, 0.5), INDIGO)).toBe(true);
    expect(isAbout(await colourAt(made, facts, 0.75, 0.5), ORANGE)).toBe(true);
    // A hard edge where the two halves meet: drawn at size, not stretched.
    expect(isAbout(await pixelAt(made, 214, 72), INDIGO)).toBe(true);
    expect(isAbout(await pixelAt(made, 218, 72), ORANGE)).toBe(true);
  });

  test("an SVG with only a viewBox, or a size in percent, is drawn to fill the box too", async () => {
    for (const attributes of [
      'viewBox="0 0 300 100"',
      'width="100%" height="100%" viewBox="0 0 30 10"',
      'width="3in" height="1in"',
    ]) {
      const result: EmailLogoResult = await carry(
        svgLogo(
          `<rect width="100%" height="100%" fill="rgb(${INDIGO.r},${INDIGO.g},${INDIGO.b})"/>`,
          attributes,
        ),
      );
      const facts: ImageFacts = await imageFacts(carriedBytes(result));

      expect([attributes, result.outcome, facts.width, facts.height]).toEqual([
        attributes,
        EmailLogoOutcome.Made,
        432,
        144,
      ]);
    }
  });

  test("an SVG that claims an enormous size is drawn small, never at that size", async () => {
    const timed: FastestRun<EmailLogoResult> = await fastestRunAsync({
      run: (): Promise<EmailLogoResult> => {
        return carry(
          svgLogo(
            '<rect width="100000" height="100000" fill="#4f46e5"/>',
            'width="100000" height="100000" viewBox="0 0 100000 100000"',
          ),
        );
      },
      limitInMs: 2000,
    });
    const facts: ImageFacts = await imageFacts(carriedBytes(timed.result));

    expect(timed.inMs).toBeLessThan(2000);
    expect([timed.result.outcome, facts.width, facts.height]).toEqual([
      EmailLogoOutcome.Made,
      144,
      144,
    ]);
  });

  test("the installation's header box: a logo as tall as its 32 pixels, at 3x", async () => {
    const result: EmailLogoResult = await carry(TWO_COLOUR_SVG, {
      box: PRODUCT_EMAIL_LOGO_BOX,
    });
    const facts: ImageFacts = await imageFacts(carriedBytes(result));

    expect([facts.width, facts.height]).toEqual([288, 96]);
  });

  test("turned the way its EXIF says, as a mail client shows it, and with no EXIF of its own", async () => {
    // Left half indigo, right half orange, to be turned a quarter clockwise.
    const turned: Buffer = await sharp(
      await twoColourLogo({
        width: 1200,
        height: 400,
        format: "png",
        left: INDIGO,
        right: ORANGE,
      }),
    )
      .jpeg({ quality: 95 })
      .withMetadata({ orientation: 6 })
      .withExif({ IFD0: { ImageDescription: "Taken at the office" } })
      .toBuffer();

    expect((await imageFacts(turned)).orientation).toBe(6);

    const result: EmailLogoResult = await carry(turned);
    const made: Buffer = carriedBytes(result);
    const facts: ImageFacts = await imageFacts(made);

    expect([facts.format, facts.width, facts.height]).toEqual([
      "jpeg",
      48,
      144,
    ]);
    // The left half is now on top.
    expect(isAbout(await colourAt(made, facts, 0.5, 0.25), INDIGO, 12)).toBe(
      true,
    );
    expect(isAbout(await colourAt(made, facts, 0.5, 0.75), ORANGE, 12)).toBe(
      true,
    );
    expect([facts.hasExif, facts.orientation]).toEqual([false, undefined]);
    expect(made.includes(Buffer.from("Taken at the office"))).toBe(false);
  });

  test("a CMYK JPEG, from a print designer, comes out in the screen's colours", async () => {
    const cmyk: Buffer = await sharp({
      create: { width: 1200, height: 400, channels: 3, background: ORANGE },
    })
      .toColourspace("cmyk")
      .jpeg({ quality: 95 })
      .toBuffer();

    expect((await imageFacts(cmyk)).space).toBe("cmyk");

    const result: EmailLogoResult = await carry(cmyk);
    const made: Buffer = carriedBytes(result);
    const facts: ImageFacts = await imageFacts(made);

    expect([facts.format, facts.space]).toEqual(["jpeg", "srgb"]);
    expect(isAbout(await colourAt(made, facts, 0.5, 0.5), ORANGE, 24)).toBe(
      true,
    );
  });

  test("a 16-bit PNG comes out as 8 bits a channel, which every mail client draws", async () => {
    const deep: Buffer = await sharp({
      create: { width: 1200, height: 400, channels: 3, background: INDIGO },
    })
      .toColourspace("rgb16")
      .png()
      .toBuffer();

    expect((await imageFacts(deep)).depth).toBe("ushort");

    const facts: ImageFacts = await imageFacts(carriedBytes(await carry(deep)));

    expect([facts.depth, facts.width, facts.height]).toEqual([
      "uchar",
      432,
      144,
    ]);
  });

  test("a made PNG claims no print resolution, and holds nothing but its picture", async () => {
    for (const bytes of [TWO_COLOUR_SVG, WIDE_PNG, PNG_OVER_LIMIT]) {
      const chunks: Array<string> = pngChunkTypes(
        carriedBytes(await carry(bytes)),
      );

      expect(chunks[0]).toBe("IHDR");
      expect(chunks[chunks.length - 1]).toBe("IEND");
      expect(
        chunks.filter((type: string): boolean => {
          return type !== "IDAT";
        }),
      ).toEqual(["IHDR", "IEND"]);
    }
  });

  test("every logo it hands over is one the email carries: a PNG or a JPEG of at most 512 KB, written as the HTML takes it", async () => {
    const address: string =
      "https://oneuptime.acme.test/status-page-api/logo/2b0f6f3f-6c11-4bd1-8bb0-0d3b1c0e58f1";
    const header: string = `<img src="${address}" height="40" alt="Acme Status">`;

    for (const bytes of [
      PNG_THAT_FITS,
      WIDE_PNG,
      PNG_OVER_LIMIT,
      JPEG_OVER_LIMIT,
      SMALL_WEBP,
      TWO_COLOUR_SVG,
    ]) {
      const logo: CarriedLogo | null = (await carry(bytes)).logo;
      const read: CarriedLogoReader = async (): Promise<CarriedLogo | null> => {
        return logo;
      };

      const carried: EmailWithCarriedLogos = await EmailCarriedLogos.carry(
        header,
        read,
      );

      expect(carried.logos).toEqual([logo]);
      expect(carried.html).toBe(
        `<img src="${logo!.dataUri}" height="40" alt="Acme Status">`,
      );
    }
  });
});

describe("a logo that keeps its address, as before", () => {
  test("an SVG that draws words, which the server has no font for: never drawn as empty boxes", async () => {
    const debug: ReturnType<typeof jest.spyOn> = jest
      .spyOn(logger, "debug")
      .mockImplementation((): void => {
        return undefined;
      });
    const making: ReturnType<typeof jest.spyOn> = jest.spyOn(makeOf(), "make");

    for (const body of [
      '<text x="5" y="30" font-family="Inter">Acme</text>',
      '<text><tspan x="5" y="30">Acme</tspan></text>',
      '<foreignObject width="120" height="40"><p xmlns="http://www.w3.org/1999/xhtml">Acme</p></foreignObject>',
    ]) {
      expect(await carry(svgLogo(body))).toEqual({
        logo: null,
        outcome: EmailLogoOutcome.SvgWithText,
      });
    }

    // Refused before anything is drawn.
    expect(making).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledWith(
      "The logo of status page Acme is an SVG that draws words, which the server has no font for, so the emails that show it show it from its address. Turning its words into outlines (paths) in a design tool lets emails carry it.",
    );
  });

  test("a file of another type: a TIFF, an AVIF, a gzipped SVG - no image decoder runs on it", async () => {
    const making: ReturnType<typeof jest.spyOn> = jest.spyOn(makeOf(), "make");

    for (const bytes of [TIFF, AVIF, zlib.gzipSync(TWO_COLOUR_SVG)]) {
      expect(await carry(bytes)).toEqual({
        logo: null,
        outcome: EmailLogoOutcome.UnsupportedType,
      });
    }

    expect(making).not.toHaveBeenCalled();
  });

  test("an SVG that draws nothing", async () => {
    expect(
      await carry(svgLogo("", 'width="120" height="40" viewBox="0 0 120 40"')),
    ).toEqual({ logo: null, outcome: EmailLogoOutcome.DrawsNothing });
  });

  test("markup that is no SVG, and an SVG of a billion laughs, are refused quickly", async () => {
    expect(
      await carry(Buffer.from("<html><body>Not an image</body></html>")),
    ).toEqual({ logo: null, outcome: EmailLogoOutcome.Unreadable });

    const laughs: Array<string> = ['<!ENTITY a0 "laugh">'];

    for (let level: number = 1; level <= 9; level++) {
      laughs.push(
        `<!ENTITY a${level} "${`&a${level - 1};`.repeat(10)}">`,
      );
    }

    const billionLaughs: Buffer = Buffer.from(
      `<?xml version="1.0"?><!DOCTYPE svg [${laughs.join("")}]><svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><desc>&a9;</desc><rect width="120" height="40" fill="#4f46e5"/></svg>`,
    );

    const timed: FastestRun<EmailLogoResult> = await fastestRunAsync({
      run: (): Promise<EmailLogoResult> => {
        return carry(billionLaughs);
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
    expect(timed.result).toEqual({
      logo: null,
      outcome: EmailLogoOutcome.Unreadable,
    });
  });

  test("bytes the library cannot read: as they were uploaded when they could go as they were, else the address", async () => {
    // A PNG's first bytes, then anything: #5459 carried these as they were.
    const notReally: Buffer = Buffer.concat([
      PNG_THAT_FITS.subarray(0, 8),
      Buffer.alloc(2000, 0x5a),
    ]);

    expect(await carry(notReally)).toEqual({
      logo: toCarriedLogo(notReally, "logo"),
      outcome: EmailLogoOutcome.Unreadable,
    });

    // Half of a PNG too large to go as it was.
    expect(
      await carry(
        PNG_OVER_LIMIT.subarray(0, Math.floor(PNG_OVER_LIMIT.length * 0.6)),
      ),
    ).toEqual({ logo: null, outcome: EmailLogoOutcome.Unreadable });
  });

  test("a few hundred bytes that claim 81 million pixels are never decoded, nor carried", async () => {
    const pngChunk: (type: string, data: Buffer) => Buffer = (
      type: string,
      data: Buffer,
    ): Buffer => {
      const length: Buffer = Buffer.alloc(4);
      length.writeUInt32BE(data.length);
      const typeAndData: Buffer = Buffer.concat([
        Buffer.from(type, "latin1"),
        data,
      ]);
      const checksum: Buffer = Buffer.alloc(4);
      checksum.writeUInt32BE(zlib.crc32(typeAndData));

      return Buffer.concat([length, typeAndData, checksum]);
    };

    const header: Buffer = Buffer.alloc(13);
    header.writeUInt32BE(9000, 0);
    header.writeUInt32BE(9000, 4);
    header[8] = 8; // bit depth
    header[9] = 2; // truecolour

    const claimed: Buffer = Buffer.concat([
      PNG_THAT_FITS.subarray(0, 8),
      pngChunk("IHDR", header),
      pngChunk("IDAT", zlib.deflateSync(Buffer.alloc(100))),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);

    expect(claimed.length).toBeLessThan(400);
    expect(9000 * 9000).toBeGreaterThan(MAX_LOGO_PIXELS_MADE_FOR_EMAIL);
    // A PNG this small could go as it is, and would make every mail client decode it.
    expect(toCarriedLogo(claimed, "logo")).not.toBeNull();

    expect(await carry(claimed)).toEqual({
      logo: null,
      outcome: EmailLogoOutcome.TooLarge,
    });
  });

  test("a file larger than any upload is not read at all", async () => {
    const making: ReturnType<typeof jest.spyOn> = jest.spyOn(makeOf(), "make");
    const huge: Buffer = Buffer.alloc(MAX_LOGO_FILE_BYTES_MADE_FOR_EMAIL + 1);
    PNG_THAT_FITS.copy(huge, 0, 0, 8);

    expect(await carry(huge)).toEqual({
      logo: null,
      outcome: EmailLogoOutcome.TooLarge,
    });
    expect(making).not.toHaveBeenCalled();
  });

  test("no logo: nothing to carry", async () => {
    for (const bytes of [
      null,
      undefined,
      Buffer.alloc(0),
      "iVBORw0KGgo=" as unknown as Buffer,
    ]) {
      expect(await carry(bytes)).toEqual({
        logo: null,
        outcome: EmailLogoOutcome.NoLogo,
      });
    }
  });
});

describe("an SVG names nothing outside itself that is ever read", () => {
  let server: http.Server;
  let requests: Array<string>;
  let base: string;
  let folder: string;

  beforeAll(async () => {
    requests = [];
    server = http.createServer(
      (request: http.IncomingMessage, response: http.ServerResponse) => {
        requests.push(request.url || "");
        response.writeHead(200, { "Content-Type": "image/png" });
        response.end(PNG_THAT_FITS);
      },
    );
    await new Promise<void>((resolve: () => void) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    folder = fs.mkdtempSync(path.join(os.tmpdir(), "email-logo-"));
    fs.writeFileSync(
      path.join(folder, "red.png"),
      await solidLogo({ width: 120, height: 40, format: "png", color: RED }),
    );
    fs.writeFileSync(path.join(folder, "red.txt"), "red");
  });

  afterAll(async () => {
    await new Promise<void>((resolve: () => void) => {
      server.close(() => {
        resolve();
      });
    });
    fs.rmSync(folder, { recursive: true, force: true });
  });

  test("no address it names is fetched, its scripts included", async () => {
    const result: EmailLogoResult = await carry(
      svgLogo(
        [
          `<style>@import url(${base}/style.css);</style>`,
          `<script>fetch("${base}/script")</script>`,
          '<rect x="0" y="0" width="10" height="40" fill="#4f46e5"/>',
          `<image href="${base}/image.png" x="10" width="50" height="40"/>`,
          `<image xlink:href="${base}/xlink.png" x="60" width="50" height="40"/>`,
          `<use href="${base}/sprite.svg#logo"/>`,
          `<rect x="110" width="10" height="40" fill="url(${base}/paint.svg#gradient)"/>`,
        ].join(""),
        'xmlns:xlink="http://www.w3.org/1999/xlink" width="120" height="40" viewBox="0 0 120 40" onload="fetch(\'' +
          base +
          "/onload')\"",
      ),
    );

    expect(result.outcome).toBe(EmailLogoOutcome.Made);
    await settle();
    expect(requests).toEqual([]);
  });

  test("no file on the server it names is read, by address or by entity", async () => {
    const redFile: string = `file://${path.join(folder, "red.png")}`;

    for (const svg of [
      svgLogo(
        `<rect width="10" height="40" fill="#4f46e5"/><image href="${redFile}" x="10" width="110" height="40"/>`,
      ),
      svgLogo(
        '<rect width="10" height="40" fill="#4f46e5"/><image href="red.png" x="10" width="110" height="40"/>',
      ),
      Buffer.from(
        `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY colour SYSTEM "file://${path.join(folder, "red.txt")}">]><svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="10" height="40" fill="#4f46e5"/><rect x="10" width="110" height="40" fill="&colour;"/></svg>`,
      ),
    ]) {
      const result: EmailLogoResult = await carry(svg);

      if (!result.logo) {
        // Refused outright is as good as drawn without it.
        expect(result.outcome).toBe(EmailLogoOutcome.Unreadable);
        continue;
      }

      const made: Buffer = carriedBytes(result);
      const facts: ImageFacts = await imageFacts(made);
      const where: Rgba = await colourAt(made, facts, 0.6, 0.5);

      expect(isAbout(where, RED, 40)).toBe(false);
    }
  });
});

describe("a logo is never held up for long", () => {
  test("not made within the time limit: as it was uploaded when it could go as it was, else the address", async () => {
    holdEveryMaking();
    const warn: ReturnType<typeof jest.spyOn> = jest
      .spyOn(logger, "warn")
      .mockImplementation((): void => {
        return undefined;
      });

    expect(await carry(WIDE_PNG, { timeLimitInMs: 50 })).toEqual({
      logo: toCarriedLogo(WIDE_PNG, "logo"),
      outcome: EmailLogoOutcome.TimedOut,
    });
    expect(await carry(TWO_COLOUR_SVG, { timeLimitInMs: 50 })).toEqual({
      logo: null,
      outcome: EmailLogoOutcome.TimedOut,
    });
    expect(warn).toHaveBeenCalledWith(
      "The logo of status page Acme took too long to make into an image for emails, so the emails that show it carry it as it was uploaded, or show it from its address.",
    );
  });

  test(`at most ${MAX_EMAIL_LOGOS_MADE_AT_ONCE} logos are made at once; the rest wait their turn`, async () => {
    const making: ReturnType<typeof jest.spyOn> = holdEveryMaking();
    const results: Array<Promise<EmailLogoResult>> = Array.from(
      { length: 5 },
      (): Promise<EmailLogoResult> => {
        return carry(TWO_COLOUR_SVG, { timeLimitInMs: 60000 });
      },
    );

    await settle();
    expect(making).toHaveBeenCalledTimes(MAX_EMAIL_LOGOS_MADE_AT_ONCE);

    const madeLogo: EmailLogoResult = {
      logo: toCarriedLogo(PNG_THAT_FITS, "logo"),
      outcome: EmailLogoOutcome.Made,
    };

    // Each one finished lets one more start.
    heldMakings[0]!.finish(madeLogo);
    await settle();
    expect(making).toHaveBeenCalledTimes(MAX_EMAIL_LOGOS_MADE_AT_ONCE + 1);

    for (let index: number = 1; index < 5; index++) {
      heldMakings[index]!.finish(madeLogo);
      await settle();
    }

    expect(making).toHaveBeenCalledTimes(5);
    expect(await Promise.all(results)).toEqual(
      Array.from({ length: 5 }, (): EmailLogoResult => {
        return madeLogo;
      }),
    );
  });

  test("a logo whose turn comes after its email stopped waiting is never made", async () => {
    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });
    const making: ReturnType<typeof jest.spyOn> = holdEveryMaking();

    // Every turn taken.
    const takingTurns: Array<Promise<EmailLogoResult>> = Array.from(
      { length: MAX_EMAIL_LOGOS_MADE_AT_ONCE },
      (): Promise<EmailLogoResult> => {
        return carry(TWO_COLOUR_SVG, { timeLimitInMs: 60000 });
      },
    );

    await settle();

    expect(await carry(TWO_COLOUR_SVG, { timeLimitInMs: 50 })).toEqual({
      logo: null,
      outcome: EmailLogoOutcome.TimedOut,
    });

    for (const held of heldMakings.splice(0)) {
      held.finish(MADE_ELSEWHERE);
    }

    await Promise.all(takingTurns);
    await settle();

    // Its turn came, and it made nothing.
    expect(making).toHaveBeenCalledTimes(MAX_EMAIL_LOGOS_MADE_AT_ONCE);
  });

  test("a library that cannot load: a logo that could go as it was still goes, the rest keep their addresses, said once", async () => {
    const error: ReturnType<typeof jest.spyOn> = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {
        return undefined;
      });
    jest
      .spyOn(
        EmailLogoImage as unknown as {
          importLibrary: () => Promise<unknown>;
        },
        "importLibrary",
      )
      .mockRejectedValue(
        new Error(
          "Could not load the sharp module using the linuxmusl-x64 runtime",
        ) as never,
      );
    EmailLogoImage.resetLibrary();

    expect(await carry(WIDE_PNG)).toEqual({
      logo: toCarriedLogo(WIDE_PNG, "logo"),
      outcome: EmailLogoOutcome.AsUploaded,
    });
    expect(await carry(TWO_COLOUR_SVG)).toEqual({
      logo: null,
      outcome: EmailLogoOutcome.Unreadable,
    });

    expect(
      error.mock.calls.filter((call: Array<unknown>): boolean => {
        return (
          call[0] ===
          "The image library that makes logos for emails could not be loaded, so emails show an SVG, a WebP or a large logo from its address."
        );
      }),
    ).toHaveLength(1);
  });

  test("a logo is made in well under its time limit: a 6,000 x 2,000 photograph", async () => {
    // The grain of a photograph, which JPEG keeps only at a cost.
    const photograph: Buffer = await sharp({
      create: {
        width: 6000,
        height: 2000,
        channels: 3,
        background: ORANGE,
        noise: { type: "gaussian", mean: 128, sigma: 40 },
      },
    })
      .jpeg({ quality: 95 })
      .toBuffer();

    expect(photograph.length).toBeGreaterThan(MAX_CARRIED_LOGO_BYTES);

    const timed: FastestRun<EmailLogoResult> = await fastestRunAsync({
      run: (): Promise<EmailLogoResult> => {
        return carry(photograph);
      },
      limitInMs: EMAIL_LOGO_TIME_LIMIT_IN_MS / 5,
    });

    expect(timed.inMs).toBeLessThan(EMAIL_LOGO_TIME_LIMIT_IN_MS / 5);
    expect(timed.result.outcome).toBe(EmailLogoOutcome.Made);
  });
});
