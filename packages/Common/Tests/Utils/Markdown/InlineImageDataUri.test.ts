import {
  InlineImageDataUri,
  parseInlineImageDataUri,
} from "../../../Utils/Markdown/InlineImageDataUri";
import { describe, expect, test } from "@jest/globals";

/*
 * Which data: URLs are inline raster images - the only data: URLs the email
 * renderer and the dashboard's Markdown viewer show. A synthetic monitor's
 * screenshot reaches a description as one, so every check here is also
 * about what the probe reports: base64 from Buffer.toString("base64") of a
 * PNG, or of a JPEG when the script asked page.screenshot() for one.
 */

// Real 1x1 images, as Buffer.toString("base64") writes them.
const PNG: string =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const JPEG: string =
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
const GIF89A: string =
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const WEBP: string =
  "UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=";

function base64Of(bytes: Array<number> | string): string {
  return Buffer.from(
    typeof bytes === "string" ? Buffer.from(bytes, "latin1") : bytes,
  ).toString("base64");
}

// "GIF87a" and a few bytes of a logical screen descriptor.
const GIF87A: string = base64Of("GIF87a\x01\x00\x01\x00\x00\x00\x00;");

describe("parseInlineImageDataUri - images it accepts", () => {
  test.each([
    ["a PNG", "image/png", PNG, "image/png", "png"],
    ["a JPEG", "image/jpeg", JPEG, "image/jpeg", "jpg"],
    ["a JPEG labelled image/jpg", "image/jpg", JPEG, "image/jpeg", "jpg"],
    ["a GIF89a", "image/gif", GIF89A, "image/gif", "gif"],
    ["a GIF87a", "image/gif", GIF87A, "image/gif", "gif"],
    ["a WebP", "image/webp", WEBP, "image/webp", "webp"],
  ])(
    "%s",
    (
      _label: string,
      declaredType: string,
      base64: string,
      mimeType: string,
      fileExtension: string,
    ) => {
      const image: InlineImageDataUri | null = parseInlineImageDataUri(
        `data:${declaredType};base64,${base64}`,
      );

      expect(image).toEqual({
        mimeType: mimeType,
        fileExtension: fileExtension,
        base64: base64,
        byteLength: Buffer.from(base64, "base64").length,
        dataUri: `data:${mimeType};base64,${base64}`,
      });
    },
  );

  /*
   * The pattern a template uses writes "image/png" for every screenshot, as
   * the dashboard's own screenshot view does; a script that took a JPEG
   * still has its screenshot shown, as the JPEG it is.
   */
  test("a JPEG screenshot placed into the usual image/png template is a JPEG", () => {
    const image: InlineImageDataUri | null = parseInlineImageDataUri(
      `data:image/png;base64,${JPEG}`,
    );

    expect(image?.mimeType).toBe("image/jpeg");
    expect(image?.fileExtension).toBe("jpg");
    expect(image?.dataUri).toBe(`data:image/jpeg;base64,${JPEG}`);
  });

  test.each([
    ["a PNG labelled image/gif", "image/gif", PNG, "image/png"],
    ["a GIF labelled image/webp", "image/webp", GIF89A, "image/gif"],
    ["a WebP labelled image/jpeg", "image/jpeg", WEBP, "image/webp"],
  ])(
    "the bytes decide the type: %s",
    (
      _label: string,
      declaredType: string,
      base64: string,
      mimeType: string,
    ) => {
      expect(
        parseInlineImageDataUri(`data:${declaredType};base64,${base64}`)
          ?.mimeType,
      ).toBe(mimeType);
    },
  );

  test("the scheme, the media type and base64 are read in any case", () => {
    expect(
      parseInlineImageDataUri(`DATA:IMAGE/PNG;BASE64,${PNG}`)?.dataUri,
    ).toBe(`data:image/png;base64,${PNG}`);
    expect(
      parseInlineImageDataUri(`Data:Image/Jpeg;Base64,${JPEG}`)?.mimeType,
    ).toBe("image/jpeg");
  });

  test.each([
    ["no padding", 1],
    ["two padding characters", 2],
    ["one padding character", 3],
  ])(
    "counts the decoded bytes with %s",
    (_label: string, extraBytes: number) => {
      const bytes: Array<number> = [
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a,
        ...new Array<number>(extraBytes).fill(0x41),
      ];
      const base64: string = base64Of(bytes);

      expect(
        parseInlineImageDataUri(`data:image/png;base64,${base64}`)?.byteLength,
      ).toBe(bytes.length);
    },
  );

  test("the URL it writes out holds nothing an HTML attribute would need escaped", () => {
    for (const base64 of [PNG, JPEG, GIF89A, GIF87A, WEBP]) {
      const image: InlineImageDataUri | null = parseInlineImageDataUri(
        `data:image/png;base64,${base64}`,
      );

      expect(image?.dataUri).toMatch(/^[A-Za-z0-9+/=:;,]+$/);
    }
  });
});

describe("parseInlineImageDataUri - everything else", () => {
  test.each([
    ["undefined", undefined],
    ["null", null],
    ["an empty string", ""],
    ["an https URL", "https://example.com/screenshot.png"],
    ["a relative URL", "/screenshots/login.png"],
    ["data: with no media type", `data:;base64,${PNG}`],
    ["data: that is not base64", "data:image/png,%89PNG%0D%0A%1A%0A"],
    ["data: with no data", "data:image/png;base64,"],
    [
      "an SVG",
      "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=",
    ],
    ["an SVG that is not base64", "data:image/svg+xml,<svg onload=alert(1)>"],
    ["HTML", "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="],
    ["HTML with PNG bytes", `data:text/html;base64,${PNG}`],
    ["text", "data:text/plain;base64,aGVsbG8="],
    ["an icon", `data:image/x-icon;base64,${PNG}`],
    ["a TIFF", `data:image/tiff;base64,${PNG}`],
    ["a BMP", `data:image/bmp;base64,${PNG}`],
    ["an AVIF", `data:image/avif;base64,${PNG}`],
    ["a media type parameter", `data:image/png;charset=utf-8;base64,${PNG}`],
    ["a name parameter", `data:image/png;name=shot.png;base64,${PNG}`],
    ["a space before the data", `data:image/png;base64, ${PNG}`],
    ["a space before the scheme", ` data:image/png;base64,${PNG}`],
    [
      "a line break in the data",
      `data:image/png;base64,${PNG.slice(0, 40)}\n${PNG.slice(40)}`,
    ],
    [
      "a percent-escape in the data",
      `data:image/png;base64,${PNG.slice(0, 40)}%2B${PNG.slice(43)}`,
    ],
    [
      "a character reference in the data",
      `data:image/png;base64,iVBOR&#x77;0KGgo=`,
    ],
    [
      "base64url characters",
      `data:image/jpeg;base64,${JPEG.replace(/\//g, "_").replace(/\+/g, "-")}`,
    ],
    ["missing padding", `data:image/png;base64,${PNG.replace(/[=]+$/, "")}`],
    ["too much padding", `data:image/png;base64,${PNG}==`],
    ["padding alone", "data:image/png;base64,===="],
    ["three padding characters", "data:image/png;base64,i==="],
    [
      "a letter outside base64's alphabet",
      `data:image/png;base64,${PNG.slice(0, 40)}é${PNG.slice(41)}`,
    ],
    [
      "padding in the middle",
      `data:image/png;base64,iVBO=w0KGgoAAAANSUhEUgAAAAEAAAAB`,
    ],
    [
      "a quote that would end an attribute",
      `data:image/png;base64,${PNG.slice(0, 40)}"${PNG.slice(41)}`,
    ],
    ["a trailing query", `data:image/png;base64,${PNG}?x=1`],
  ])("rejects %s", (_label: string, url: string | null | undefined) => {
    expect(parseInlineImageDataUri(url)).toBeNull();
  });

  test.each([
    ["three zero bytes", "AAAA"],
    ["text", base64Of("Hello, world!")],
    ["an SVG", base64Of('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ["HTML", base64Of("<html><script>alert(1)</script></html>")],
    ["a PDF", base64Of("%PDF-1.7\n%\xe2\xe3\xcf\xd3")],
    ["a ZIP", base64Of("PK\x03\x04\x14\x00\x00\x00")],
    ["half a PNG signature", base64Of([0x89, 0x50, 0x4e, 0x47])],
    [
      "a PNG signature with one byte wrong",
      base64Of([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0b, 0x00]),
    ],
    ["two of JPEG's three bytes", base64Of([0xff, 0xd8])],
    ["GIF88a", base64Of("GIF88a\x01\x00\x01\x00")],
    ["a RIFF that is not WebP", base64Of("RIFF\x24\x00\x00\x00WAVEfmt ")],
    ["WEBP without RIFF", base64Of("XXXX\x24\x00\x00\x00WEBPVP8 ")],
  ])(
    "rejects data that only claims to be an image: %s",
    (_label: string, base64: string) => {
      for (const declaredType of [
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp",
      ]) {
        expect(
          parseInlineImageDataUri(`data:${declaredType};base64,${base64}`),
        ).toBeNull();
      }
    },
  );

  test("takes exactly base64's alphabet in the data, ASCII character by character", () => {
    const base64Alphabet: string =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    for (let code: number = 0; code < 128; code++) {
      const character: string = String.fromCharCode(code);
      const url: string = `data:image/png;base64,${PNG.slice(0, 40)}${character}${PNG.slice(41)}`;

      expect([code, parseInlineImageDataUri(url) !== null]).toEqual([
        code,
        base64Alphabet.includes(character),
      ]);
    }
  });

  test("is not fooled by a value that is not a string at run time", () => {
    expect(parseInlineImageDataUri(42 as unknown as string)).toBeNull();
    expect(
      parseInlineImageDataUri({
        toString: (): string => {
          return `data:image/png;base64,${PNG}`;
        },
      } as unknown as string),
    ).toBeNull();
  });
});

describe("parseInlineImageDataUri - size", () => {
  /*
   * A full-page desktop screenshot runs to megabytes. Every check is linear,
   * and the signature is read from the first few characters only.
   */
  test("reads a screenshot of several megabytes, and its size, quickly", () => {
    const pngSignature: Array<number> = [
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ];
    const bytes: Buffer = Buffer.concat([
      Buffer.from(pngSignature),
      Buffer.alloc(6 * 1024 * 1024, 0x5a),
    ]);
    const base64: string = bytes.toString("base64");

    const startedAt: number = Date.now();
    const image: InlineImageDataUri | null = parseInlineImageDataUri(
      `data:image/png;base64,${base64}`,
    );

    expect(Date.now() - startedAt).toBeLessThan(5000);
    expect(image?.byteLength).toBe(bytes.length);
    expect(image?.base64).toBe(base64);
  });

  test("rejects a megabytes-long value with one bad character at the end, quickly", () => {
    const base64: string = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(3 * 1024 * 1024, 0x5a),
    ]).toString("base64");

    const startedAt: number = Date.now();

    expect(
      parseInlineImageDataUri(
        `data:image/png;base64,${base64.slice(0, -4)}AAA!`,
      ),
    ).toBeNull();
    expect(Date.now() - startedAt).toBeLessThan(5000);
  });
});
