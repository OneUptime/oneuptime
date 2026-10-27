import EmailLogo, {
  EMAIL_LOGO_FILE_NAME,
  EMAIL_LOGO_PATH,
  readEmailLogoDataUrl,
} from "../../../../Server/Utils/Mail/EmailLogo";
import EmailInlineImages, {
  EmailHtmlWithInlineImages,
} from "../../../../Server/Utils/Mail/EmailInlineImages";
import {
  BrandAssetsPath,
  BrandAssetsRouteSegment,
  VendorAssetsRoute,
} from "../../../../Server/Utils/VendorAssets";
import logger from "../../../../Server/Utils/Logger";
import {
  InlineImageDataUri,
  parseInlineImageDataUri,
} from "../../../../Utils/Markdown/InlineImageDataUri";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";

/*
 * ONEUPTIME'S LOGO TRAVELS INSIDE EVERY EMAIL IT HEADS (Server/Utils/Mail/
 * EmailLogo, issue #5124).
 *
 * The header of every email that shows OneUptime's branding drew its logo
 * from res.cloudinary.com: a broken image on a network without the
 * internet, and a request to a third party - who opened which email, and
 * when - everywhere else. The logo now ships with OneUptime and goes out
 * inside the email, as an inline image the HTML points at by Content-ID.
 *
 * These tests hold the file to what an email needs (a PNG every mail client
 * draws, sharp at 32 x 32, small enough for every email to carry) and the
 * way an email carries it.
 */

const CONTENT_ID_PATTERN: RegExp = /^[0-9a-f-]{36}@oneuptime$/;

const DATA_URL_CHARACTERS: RegExp = /^[A-Za-z0-9+/=:;,]+$/;

const PNG_SIGNATURE: Buffer = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

// A real 1x1 PNG: a screenshot, as the probe reports one.
const SCREENSHOT_PNG: string =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const logoFile: Buffer = fs.readFileSync(EMAIL_LOGO_PATH);

function logoDataUrl(): string {
  const dataUrl: string | null = EmailLogo.getDataUrl();

  expect(dataUrl).not.toBeNull();

  return dataUrl as string;
}

// The header of an email that shows OneUptime's branding, as Logo.hbs writes it.
function header(src: string = logoDataUrl()): string {
  return `<table><tr><td width="32"><a href="https://oneuptime.example.test"><img src="${src}" width="32" height="32" alt="OneUptime" style="display: block; width: 32px; height: 32px; border-radius: 6px;"></a></td><td>OneUptime</td></tr></table>`;
}

interface DecodedPng {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlace: number;
  // RGBA, a row at a time.
  pixels: Buffer;
}

// A non-interlaced 8-bit RGBA PNG, decoded: enough to look at the logo.
function decodePng(file: Buffer): DecodedPng {
  let offset: number = PNG_SIGNATURE.length;
  let width: number = 0;
  let height: number = 0;
  let bitDepth: number = 0;
  let colorType: number = 0;
  let interlace: number = 0;
  const data: Array<Buffer> = [];

  while (offset < file.length) {
    const length: number = file.readUInt32BE(offset);
    const type: string = file.toString("latin1", offset + 4, offset + 8);
    const chunk: Buffer = file.subarray(offset + 8, offset + 8 + length);

    if (type === "IHDR") {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      bitDepth = chunk[8]!;
      colorType = chunk[9]!;
      interlace = chunk[12]!;
    } else if (type === "IDAT") {
      data.push(chunk);
    }

    offset += 12 + length;
  }

  const raw: Buffer = zlib.inflateSync(Buffer.concat(data));
  const stride: number = width * 4;
  const pixels: Buffer = Buffer.alloc(stride * height);

  for (let row: number = 0; row < height; row++) {
    const filter: number = raw[row * (stride + 1)]!;

    for (let column: number = 0; column < stride; column++) {
      const value: number = raw[row * (stride + 1) + 1 + column]!;
      const left: number = column >= 4 ? pixels[row * stride + column - 4]! : 0;
      const up: number = row > 0 ? pixels[(row - 1) * stride + column]! : 0;
      const upLeft: number =
        row > 0 && column >= 4 ? pixels[(row - 1) * stride + column - 4]! : 0;
      let predictor: number = 0;

      if (filter === 1) {
        predictor = left;
      } else if (filter === 2) {
        predictor = up;
      } else if (filter === 3) {
        predictor = Math.floor((left + up) / 2);
      } else if (filter === 4) {
        const estimate: number = left + up - upLeft;
        const toLeft: number = Math.abs(estimate - left);
        const toUp: number = Math.abs(estimate - up);
        const toUpLeft: number = Math.abs(estimate - upLeft);

        predictor =
          toLeft <= toUp && toLeft <= toUpLeft
            ? left
            : toUp <= toUpLeft
              ? up
              : upLeft;
      }

      pixels[row * stride + column] = (value + predictor) & 0xff;
    }
  }

  return { width, height, bitDepth, colorType, interlace, pixels };
}

interface Pixel {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

function pixelAt(png: DecodedPng, x: number, y: number): Pixel {
  const at: number = (y * png.width + x) * 4;

  return {
    red: png.pixels[at]!,
    green: png.pixels[at + 1]!,
    blue: png.pixels[at + 2]!,
    alpha: png.pixels[at + 3]!,
  };
}

function everyPixel(png: DecodedPng): Array<Pixel> {
  const pixels: Array<Pixel> = [];

  for (let y: number = 0; y < png.height; y++) {
    for (let x: number = 0; x < png.width; x++) {
      pixels.push(pixelAt(png, x, y));
    }
  }

  return pixels;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the logo file", () => {
  test("ships with Common, among OneUptime's own images, and is served there too", () => {
    expect(path.dirname(EMAIL_LOGO_PATH)).toBe(BrandAssetsPath);
    expect(fs.existsSync(EMAIL_LOGO_PATH)).toBe(true);
    // Every service mounts the folder: /oneuptime-assets/brand/<file>.
    expect(`${VendorAssetsRoute}/${BrandAssetsRouteSegment}`).toBe(
      "/oneuptime-assets/brand",
    );
  });

  test("is a PNG: every mail client draws one, and many draw no SVG", () => {
    expect(logoFile.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    expect(
      parseInlineImageDataUri(
        `data:image/png;base64,${logoFile.toString("base64")}`,
      )?.mimeType,
    ).toBe("image/png");
  });

  test("is 96 x 96: drawn at 32 x 32, it is sharp on a 3x screen", () => {
    const png: DecodedPng = decodePng(logoFile);

    expect([png.width, png.height]).toEqual([96, 96]);
    // 8-bit RGBA, not interlaced: the most widely drawn kind of PNG.
    expect([png.bitDepth, png.colorType, png.interlace]).toEqual([8, 6, 0]);
  });

  test("is a few kilobytes: every email that shows OneUptime's branding carries it", () => {
    expect(logoFile.length).toBeGreaterThan(1024);
    expect(logoFile.length).toBeLessThan(8 * 1024);
    // As it goes out, base64: still far below what anything else weighs.
    expect(logoFile.toString("base64").length).toBeLessThan(11 * 1024);
  });

  test("is OneUptime's tile: black, with the white wordmark and the green square", () => {
    const pixels: Array<Pixel> = everyPixel(decodePng(logoFile));
    const opaque: Array<Pixel> = pixels.filter((pixel: Pixel): boolean => {
      return pixel.alpha === 255;
    });

    const black: number = opaque.filter((pixel: Pixel): boolean => {
      return pixel.red < 24 && pixel.green < 24 && pixel.blue < 24;
    }).length;
    const white: number = opaque.filter((pixel: Pixel): boolean => {
      return pixel.red > 220 && pixel.green > 220 && pixel.blue > 220;
    }).length;
    const green: number = opaque.filter((pixel: Pixel): boolean => {
      return pixel.green > pixel.red + 60 && pixel.green > pixel.blue + 60;
    }).length;

    expect(black / opaque.length).toBeGreaterThan(0.6);
    expect(white).toBeGreaterThan(200);
    expect(green).toBeGreaterThan(10);
  });

  test("has its corners rounded in the image itself, so Outlook - which ignores border-radius - rounds them too", () => {
    const png: DecodedPng = decodePng(logoFile);

    for (const [x, y] of [
      [0, 0],
      [95, 0],
      [0, 95],
      [95, 95],
    ] as Array<[number, number]>) {
      expect([x, y, pixelAt(png, x, y).alpha]).toEqual([x, y, 0]);
    }

    // The middle of each edge, and the middle of the tile, are the tile.
    for (const [x, y] of [
      [48, 0],
      [0, 48],
      [95, 48],
      [48, 95],
      [48, 48],
    ] as Array<[number, number]>) {
      expect([x, y, pixelAt(png, x, y).alpha]).toEqual([x, y, 255]);
    }
  });
});

describe("readEmailLogoDataUrl", () => {
  test("is the file as an inline image's data: URL", () => {
    const dataUrl: string | null = readEmailLogoDataUrl(EMAIL_LOGO_PATH);

    expect(dataUrl).toBe(
      `data:image/png;base64,${logoFile.toString("base64")}`,
    );
  });

  test("holds only characters an HTML attribute takes as they are", () => {
    const dataUrl: string = readEmailLogoDataUrl(EMAIL_LOGO_PATH) as string;

    expect(DATA_URL_CHARACTERS.test(dataUrl)).toBe(true);
  });

  test("is an image the email renderer and the attachments read as one", () => {
    const image: InlineImageDataUri | null = parseInlineImageDataUri(
      readEmailLogoDataUrl(EMAIL_LOGO_PATH),
    );

    expect(image).not.toBeNull();
    expect(image!.mimeType).toBe("image/png");
    expect(image!.byteLength).toBe(logoFile.length);
  });

  test("a file that is not there: null, and the reason in the log", () => {
    const error: ReturnType<typeof jest.spyOn> = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {});
    const missing: string = path.join(
      os.tmpdir(),
      `email-logo-missing-${process.pid}.png`,
    );

    expect(readEmailLogoDataUrl(missing)).toBeNull();
    expect(String(error.mock.calls[0]![0])).toBe(
      `OneUptime's email logo could not be read from ${missing}. Emails show OneUptime's name in its place.`,
    );
  });

  test("a file that is not an image an email shows: null, and the reason in the log", () => {
    const error: ReturnType<typeof jest.spyOn> = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {});
    const directory: string = fs.mkdtempSync(
      path.join(os.tmpdir(), "email-logo-"),
    );
    const svg: string = path.join(directory, "logo.svg");

    try {
      fs.writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg"/>');

      expect(readEmailLogoDataUrl(svg)).toBeNull();
      expect(String(error.mock.calls[0]![0])).toBe(
        `OneUptime's email logo at ${svg} is not a PNG, JPEG, GIF or WebP image. Emails show OneUptime's name in its place.`,
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("EmailLogo.getDataUrl", () => {
  test("is the shipped logo", () => {
    expect(EmailLogo.getDataUrl()).toBe(readEmailLogoDataUrl(EMAIL_LOGO_PATH));
  });

  test("reads the file once, however many emails ask", () => {
    const readFileSync: ReturnType<typeof jest.spyOn> = jest.spyOn(
      fs,
      "readFileSync",
    );

    jest.isolateModules(() => {
      const fresh: { default: typeof EmailLogo } = jest.requireActual(
        "../../../../Server/Utils/Mail/EmailLogo",
      ) as { default: typeof EmailLogo };

      const first: string | null = fresh.default.getDataUrl();

      expect(fresh.default.getDataUrl()).toBe(first);
      expect(fresh.default.getDataUrl()).toBe(first);
    });

    const logoReads: number = readFileSync.mock.calls.filter(
      (call: Array<unknown>): boolean => {
        return call[0] === EMAIL_LOGO_PATH;
      },
    ).length;

    expect(logoReads).toBe(1);
  });

  test("a logo that cannot be read: no logo, said once, and every email still goes", () => {
    const errors: Array<unknown> = [];

    jest.isolateModules(() => {
      jest.doMock("../../../../Server/Utils/Logger", () => {
        return {
          __esModule: true,
          default: {
            error: (message: unknown): void => {
              errors.push(message);
            },
          },
        };
      });

      const realReadFileSync: typeof fs.readFileSync = fs.readFileSync;

      jest.spyOn(fs, "readFileSync").mockImplementation(((
        file: fs.PathOrFileDescriptor,
        options?: unknown,
      ): unknown => {
        if (file === EMAIL_LOGO_PATH) {
          throw new Error("ENOENT: no such file or directory");
        }

        return realReadFileSync(file, options as undefined);
      }) as typeof fs.readFileSync);

      const fresh: { default: typeof EmailLogo } = jest.requireActual(
        "../../../../Server/Utils/Mail/EmailLogo",
      ) as { default: typeof EmailLogo };

      expect(fresh.default.getDataUrl()).toBeNull();
      expect(fresh.default.getDataUrl()).toBeNull();

      const html: string = header(`data:image/png;base64,${SCREENSHOT_PNG}`);

      expect(fresh.default.attach(html)).toEqual({
        html: html,
        inlineImages: [],
      });
    });

    // The reason, naming the file, and the error: once, not once an email.
    expect(errors).toHaveLength(2);
    expect(String(errors[0])).toContain(EMAIL_LOGO_PATH);
    expect(String(errors[0])).toContain("OneUptime's name in its place");
  });
});

describe("EmailLogo.attach", () => {
  test("HTML without the logo comes back as it was, with no attachment", () => {
    for (const html of [
      "",
      "<p>Hello</p>",
      '<img src="https://oneuptime.example.test/logo.png" alt="Logo">',
      `<img src="data:image/png;base64,${SCREENSHOT_PNG}" alt="Shot">`,
    ]) {
      const attached: EmailHtmlWithInlineImages = EmailLogo.attach(html);

      expect(attached.html).toBe(html);
      expect(attached.inlineImages).toEqual([]);
    }
  });

  test("the header's logo goes out as an attachment the HTML points at by Content-ID", () => {
    const attached: EmailHtmlWithInlineImages = EmailLogo.attach(header());

    expect(attached.inlineImages).toHaveLength(1);

    const logo: EmailHtmlWithInlineImages["inlineImages"][number] =
      attached.inlineImages[0]!;

    expect(logo.contentId).toMatch(CONTENT_ID_PATTERN);
    expect(logo).toEqual({
      contentId: logo.contentId,
      fileName: EMAIL_LOGO_FILE_NAME,
      mimeType: "image/png",
      base64: logoFile.toString("base64"),
      byteLength: logoFile.length,
    });
    expect(attached.html).toBe(header(`cid:${logo.contentId}`));
    expect(attached.html).not.toContain("data:");
  });

  test("is named for what it is, where a mail client shows a name", () => {
    expect(EMAIL_LOGO_FILE_NAME).toBe("oneuptime-logo.png");
  });

  test("the logo twice is attached once, and both point at it", () => {
    const attached: EmailHtmlWithInlineImages = EmailLogo.attach(
      `${header()}<p>Hi</p>${header()}`,
    );

    expect(attached.inlineImages).toHaveLength(1);

    const contentId: string = attached.inlineImages[0]!.contentId;

    expect(attached.html).toBe(
      `${header(`cid:${contentId}`)}<p>Hi</p>${header(`cid:${contentId}`)}`,
    );
  });

  test.each([
    [
      "single quotes",
      (url: string): string => {
        return `<img src='${url}' alt="x">`;
      },
    ],
    [
      "no quotes",
      (url: string): string => {
        return `<img src=${url} alt="x">`;
      },
    ],
    [
      "upper case",
      (url: string): string => {
        return `<IMG SRC="${url}" ALT="x">`;
      },
    ],
    [
      "a line break before it",
      (url: string): string => {
        return `<img\nalt="x"\nsrc="${url}">`;
      },
    ],
  ])(
    "an <img> written with %s is attached",
    (_label: string, tag: (url: string) => string) => {
      const attached: EmailHtmlWithInlineImages = EmailLogo.attach(
        tag(logoDataUrl()),
      );

      expect(attached.inlineImages).toHaveLength(1);
      expect(attached.html).toBe(
        tag(`cid:${attached.inlineImages[0]!.contentId}`),
      );
    },
  );

  test.each([
    [
      "as text",
      (url: string): string => {
        return `<p>${url}</p>`;
      },
    ],
    [
      "in another attribute",
      (url: string): string => {
        return `<img data-src="${url}" src="https://oneuptime.example.test/a.png">`;
      },
    ],
    [
      "inside another attribute's value",
      (url: string): string => {
        return `<img alt='src="${url}"' src="https://oneuptime.example.test/a.png">`;
      },
    ],
    [
      "as a link",
      (url: string): string => {
        return `<a href="${url}">Logo</a>`;
      },
    ],
  ])(
    "the logo's data: URL %s is left alone",
    (_label: string, markup: (url: string) => string) => {
      const html: string = markup(logoDataUrl());

      expect(EmailLogo.attach(html)).toEqual({ html: html, inlineImages: [] });
    },
  );

  test("leaves a screenshot beside it to the screenshot's own rules", () => {
    const screenshot: string = `<img src="data:image/png;base64,${SCREENSHOT_PNG}" alt="Shot">`;
    const attached: EmailHtmlWithInlineImages = EmailLogo.attach(
      `${header()}${screenshot}`,
    );

    expect(attached.inlineImages).toHaveLength(1);
    expect(attached.inlineImages[0]!.fileName).toBe(EMAIL_LOGO_FILE_NAME);
    expect(attached.html.endsWith(screenshot)).toBe(true);

    // And the screenshot's attach leaves the logo, now an attachment, alone.
    const both: EmailHtmlWithInlineImages = EmailInlineImages.attach(
      attached.html,
    );

    expect(both.inlineImages).toHaveLength(1);
    expect(both.inlineImages[0]!.fileName).toBe("image-1.png");
    expect(both.html).toContain(
      `src="cid:${attached.inlineImages[0]!.contentId}"`,
    );
  });

  test("every email gets a Content-ID of its own", () => {
    const first: string = EmailLogo.attach(header()).inlineImages[0]!.contentId;
    const second: string =
      EmailLogo.attach(header()).inlineImages[0]!.contentId;

    expect(first).not.toBe(second);
  });

  test("reads megabytes of HTML, and endless image tags, in time that grows with their length", () => {
    const tags: string = "<img src=".repeat(400000 / 9);
    const megabytes: string = `${header()}<p>${"x".repeat(3 * 1024 * 1024)}</p>`;

    for (const html of [tags, `${tags}${header()}`, megabytes]) {
      const timed: FastestRun<void> = fastestRun({
        run: (): void => {
          EmailLogo.attach(html);
        },
        limitInMs: 2000,
      });

      expect(timed.inMs).toBeLessThan(2000);
    }
  });
});
