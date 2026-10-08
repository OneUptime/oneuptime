import { describe, expect, test } from "@jest/globals";
import BadDataException from "Common/Types/Exception/BadDataException";
import MimeType from "Common/Types/File/MimeType";
import {
  EMAIL_SAFE_IMAGE_TYPES,
  isUnsafeSvg,
  parseStoredImage,
  parseUploadedImage,
  sniffImageType,
  toDataUrl,
  WHITE_LABEL_DARK_LOGO,
  WHITE_LABEL_FAVICON,
  WHITE_LABEL_FAVICON_MAX_BYTES,
  WHITE_LABEL_IMAGES,
  WHITE_LABEL_LOGO,
  WHITE_LABEL_LOGO_MAX_BYTES,
  WhiteLabelImage,
  WhiteLabelImageDefinition,
} from "../../../Server/WhiteLabel/WhiteLabelImages";
import {
  GIF_BYTES,
  ICO_BYTES,
  JPEG_BYTES,
  PNG_BYTES,
  SVG_TEXT,
  SVG_WITH_XML_DECLARATION,
  toDataUrlOf,
  UNSAFE_SVGS,
  WEBP_BYTES,
} from "./WhiteLabelFixtures";

/*
 * What a white-label image may be. The type is read from the image's own
 * first bytes, never from what the browser claimed; each image is held to
 * its types and size; an SVG that could do anything but draw is refused; and
 * a stored value is read back under the same rules.
 */

const parse: (
  value: unknown,
  image: WhiteLabelImageDefinition,
) => WhiteLabelImage = (
  value: unknown,
  image: WhiteLabelImageDefinition,
): WhiteLabelImage => {
  return parseUploadedImage(value, image);
};

const refusal: (value: unknown, image: WhiteLabelImageDefinition) => string = (
  value: unknown,
  image: WhiteLabelImageDefinition,
): string => {
  try {
    parseUploadedImage(value, image);
  } catch (err) {
    expect(err).toBeInstanceOf(BadDataException);
    return (err as Error).message;
  }

  throw new Error("The image was accepted.");
};

describe("sniffImageType", () => {
  test.each([
    ["PNG", PNG_BYTES, MimeType.png],
    ["JPEG", JPEG_BYTES, MimeType.jpeg],
    ["GIF", GIF_BYTES, MimeType.gif],
    ["WebP", WEBP_BYTES, MimeType.webp],
    ["ICO", ICO_BYTES, MimeType.ico],
    ["SVG", Buffer.from(SVG_TEXT), MimeType.svg],
    [
      "SVG after an XML declaration and a comment",
      Buffer.from(SVG_WITH_XML_DECLARATION),
      MimeType.svg,
    ],
    [
      "SVG after a byte order mark",
      Buffer.from(`\uFEFF${SVG_TEXT}`),
      MimeType.svg,
    ],
  ])(
    "reads %s from its bytes",
    (_label: string, bytes: Buffer, type: string) => {
      expect(sniffImageType(bytes)).toBe(type);
    },
  );

  test.each([
    ["plain text", Buffer.from("hello, world")],
    ["a PDF", Buffer.from("%PDF-1.4\n%...")],
    ["HTML", Buffer.from("<html><body>hi</body></html>")],
    ["an empty file", Buffer.alloc(0)],
    [
      "a RIFF that is not WebP",
      Buffer.from("RIFF\u0000\u0000\u0000\u0000WAVEfmt "),
    ],
    ["an ICO header with no images", Buffer.from([0, 0, 1, 0, 0, 0])],
    ["a cursor file", Buffer.from([0, 0, 2, 0, 1, 0, 0, 0])],
  ])("reads nothing from %s", (_label: string, bytes: Buffer) => {
    expect(sniffImageType(bytes)).toBeNull();
  });
});

describe("parseUploadedImage: what each image may be", () => {
  test.each([
    ["PNG", MimeType.png, PNG_BYTES],
    ["JPEG", MimeType.jpeg, JPEG_BYTES],
    ["GIF", MimeType.gif, GIF_BYTES],
    ["WebP", MimeType.webp, WEBP_BYTES],
    ["SVG", MimeType.svg, Buffer.from(SVG_TEXT)],
  ])(
    "takes a %s logo, for light and for dark backgrounds",
    (_label: string, type: string, bytes: Buffer) => {
      for (const image of [WHITE_LABEL_LOGO, WHITE_LABEL_DARK_LOGO]) {
        const parsed: WhiteLabelImage = parse(toDataUrlOf(type, bytes), image);

        expect(parsed.type).toBe(type);
        expect(parsed.bytes.equals(bytes)).toBe(true);
      }
    },
  );

  test("takes an ICO browser tab icon, and refuses an ICO logo", () => {
    expect(
      parse(toDataUrlOf(MimeType.ico, ICO_BYTES), WHITE_LABEL_FAVICON).type,
    ).toBe(MimeType.ico);

    expect(
      refusal(toDataUrlOf(MimeType.ico, ICO_BYTES), WHITE_LABEL_LOGO),
    ).toBe("The logo must be a PNG, JPEG, GIF, WebP or SVG image.");
  });

  test("the type is read from the bytes: a JPEG sent as a PNG is stored as a JPEG", () => {
    expect(
      parse(toDataUrlOf(MimeType.png, JPEG_BYTES), WHITE_LABEL_LOGO).type,
    ).toBe(MimeType.jpeg);
  });

  test("a file that is no image is refused, whatever it claims to be", () => {
    expect(
      refusal(
        toDataUrlOf(MimeType.png, "<html>not an image</html>"),
        WHITE_LABEL_LOGO,
      ),
    ).toBe("The logo must be a PNG, JPEG, GIF, WebP or SVG image.");
    expect(
      refusal(toDataUrlOf(MimeType.png, "%PDF-1.4"), WHITE_LABEL_FAVICON),
    ).toBe(
      "The browser tab icon must be a PNG, JPEG, GIF, WebP, SVG or ICO image.",
    );
  });

  test("names each image in its own words", () => {
    expect(
      refusal(toDataUrlOf(MimeType.png, "nope"), WHITE_LABEL_DARK_LOGO),
    ).toBe(
      "The logo for dark backgrounds must be a PNG, JPEG, GIF, WebP or SVG image.",
    );
  });

  test.each([
    ["not a string", 42],
    ["an object", { data: "x" }],
    ["not a data: URL", "https://example.com/logo.png"],
    ["a data: URL that is not base64", "data:image/png,rawtext"],
    ["base64 with characters base64 has not", "data:image/png;base64,***"],
    ["base64 of the wrong length", "data:image/png;base64,abc"],
    ["an empty data: URL", "data:image/png;base64,"],
  ])("refuses %s as unreadable", (_label: string, value: unknown) => {
    expect(refusal(value, WHITE_LABEL_LOGO)).toBe(
      "The logo could not be read. Upload the image again.",
    );
  });

  test("tolerates line breaks inside the base64", () => {
    const base64: string = PNG_BYTES.toString("base64");
    const wrapped: string = `data:image/png;base64,${base64.substring(0, 20)}\n${base64.substring(20)}`;

    expect(parse(wrapped, WHITE_LABEL_LOGO).bytes.equals(PNG_BYTES)).toBe(true);
  });
});

describe("parseUploadedImage: sizes", () => {
  const pngOfSize: (size: number) => Buffer = (size: number): Buffer => {
    return Buffer.concat([PNG_BYTES, Buffer.alloc(size - PNG_BYTES.length, 0)]);
  };

  test("takes a logo of exactly 512 KB and refuses one byte more", () => {
    expect(
      parse(
        toDataUrlOf(MimeType.png, pngOfSize(WHITE_LABEL_LOGO_MAX_BYTES)),
        WHITE_LABEL_LOGO,
      ).bytes.length,
    ).toBe(WHITE_LABEL_LOGO_MAX_BYTES);

    expect(
      refusal(
        toDataUrlOf(MimeType.png, pngOfSize(WHITE_LABEL_LOGO_MAX_BYTES + 1)),
        WHITE_LABEL_LOGO,
      ),
    ).toBe("The logo must be 512 KB or smaller.");
  });

  test("takes a tab icon of exactly 128 KB and refuses one byte more", () => {
    expect(
      parse(
        toDataUrlOf(MimeType.png, pngOfSize(WHITE_LABEL_FAVICON_MAX_BYTES)),
        WHITE_LABEL_FAVICON,
      ).bytes.length,
    ).toBe(WHITE_LABEL_FAVICON_MAX_BYTES);

    expect(
      refusal(
        toDataUrlOf(MimeType.png, pngOfSize(WHITE_LABEL_FAVICON_MAX_BYTES + 1)),
        WHITE_LABEL_FAVICON,
      ),
    ).toBe("The browser tab icon must be 128 KB or smaller.");
  });

  test("refuses a huge upload by its length, before decoding it", () => {
    const huge: string = `data:image/png;base64,${"A".repeat(20 * 1024 * 1024)}`;
    const bufferFrom: typeof Buffer.from = Buffer.from;
    let decodedLength: number = 0;

    const spy: jest.SpyInstance = jest
      .spyOn(Buffer, "from")
      .mockImplementation(((value: unknown, encoding?: unknown): Buffer => {
        if (typeof value === "string" && encoding === "base64") {
          decodedLength = Math.max(decodedLength, value.length);
        }

        return (bufferFrom as unknown as (v: unknown, e?: unknown) => Buffer)(
          value,
          encoding,
        );
      }) as never);

    try {
      expect(refusal(huge, WHITE_LABEL_LOGO)).toBe(
        "The logo must be 512 KB or smaller.",
      );
      expect(decodedLength).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("SVG", () => {
  test("takes an SVG that only draws, with or without an XML declaration", () => {
    expect(
      parse(toDataUrlOf(MimeType.svg, SVG_TEXT), WHITE_LABEL_LOGO).type,
    ).toBe(MimeType.svg);
    expect(
      parse(
        toDataUrlOf(MimeType.svg, SVG_WITH_XML_DECLARATION),
        WHITE_LABEL_FAVICON,
      ).type,
    ).toBe(MimeType.svg);
  });

  test.each(UNSAFE_SVGS)(
    "refuses an SVG with %s",
    (_label: string, svg: string) => {
      expect(isUnsafeSvg(svg)).toBe(true);
      expect(refusal(toDataUrlOf(MimeType.svg, svg), WHITE_LABEL_LOGO)).toBe(
        "The logo is an SVG with scripts, event handlers or embedded HTML in it. Remove them, or upload a PNG instead.",
      );
    },
  );

  test.each([
    [
      "font attributes",
      '<svg><text font-family="Inter" font-size="12">Acme</text></svg>',
    ],
    [
      "an id that starts with on",
      '<svg><g id="onboarding"><polygon points="0,0 1,1"/></g></svg>',
    ],
    ["the word 'on' in text", "<svg><text>Turn it on now</text></svg>"],
    ["stroke-linejoin", '<svg><path stroke-linejoin="round" d="M0 0"/></svg>'],
  ])(
    "does not mistake %s for an event handler",
    (_label: string, svg: string) => {
      expect(isUnsafeSvg(svg)).toBe(false);
    },
  );
});

describe("parseStoredImage", () => {
  test("reads back what parseUploadedImage stored", () => {
    for (const image of WHITE_LABEL_IMAGES) {
      const stored: string = toDataUrl(
        parse(toDataUrlOf(MimeType.png, PNG_BYTES), image),
      );

      expect(parseStoredImage(stored, image)?.bytes.equals(PNG_BYTES)).toBe(
        true,
      );
    }
  });

  test("drops a stored value that would not pass today, rather than serving it", () => {
    expect(
      parseStoredImage(
        toDataUrlOf(MimeType.svg, UNSAFE_SVGS[0]![1]),
        WHITE_LABEL_LOGO,
      ),
    ).toBeNull();
    expect(
      parseStoredImage(toDataUrlOf(MimeType.ico, ICO_BYTES), WHITE_LABEL_LOGO),
    ).toBeNull();
    expect(parseStoredImage("garbage", WHITE_LABEL_LOGO)).toBeNull();
    expect(parseStoredImage(null, WHITE_LABEL_LOGO)).toBeNull();
    expect(parseStoredImage("", WHITE_LABEL_LOGO)).toBeNull();
  });
});

describe("EMAIL_SAFE_IMAGE_TYPES", () => {
  test("are the types every mail client draws: PNG, JPEG and GIF", () => {
    expect([...EMAIL_SAFE_IMAGE_TYPES].sort()).toEqual(
      [MimeType.png, MimeType.jpeg, MimeType.gif].sort(),
    );
  });
});
