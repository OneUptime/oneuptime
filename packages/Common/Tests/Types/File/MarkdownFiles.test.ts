import {
  collectMarkdownFileReferences,
  getMarkdownFileLeftOutReason,
  getMarkdownFileType,
  MARKDOWN_FILE_HEAD_LENGTH,
  MARKDOWN_FILE_LEFT_OUT_MESSAGES,
  MARKDOWN_FILE_MAX_SIZE_IN_BYTES,
  MARKDOWN_FILE_TYPES,
  MARKDOWN_FILES_MAX_COUNT,
  MARKDOWN_FILES_MAX_REFERENCES,
  MARKDOWN_FILES_MAX_TOTAL_SIZE_IN_BYTES,
  MARKDOWN_FILES_ROUTE,
  MarkdownFileFacts,
  MarkdownFileLeftOutReason,
  MarkdownFileReference,
  MarkdownImageReference,
  readMarkdownImageReferences,
} from "../../../Types/File/MarkdownFiles";
import { FILE_CONTENT_HEAD_LENGTH } from "../../../Types/File/FileContentCheck";
import MimeType from "../../../Types/File/MimeType";
import { describe, expect, test } from "@jest/globals";

/*
 * The pure half of handing out the images a record's Markdown shows
 * (#11256): which addresses a piece of Markdown holds, which files a
 * record's fields show, and which of those are handed out - pictures only,
 * of the types handed out, holding what their type says, within the limits
 * on one file, on how many and on their total.
 */

const TOKEN_A: string = "a".repeat(64);
const TOKEN_B: string = "0123456789abcdef".repeat(4);
const TOKEN_C: string = "c0ffee".repeat(10);

const HOST: string = "https://oneuptime.example.com";

const address: (token: string, host?: string) => string = (
  token: string,
  host: string = HOST,
): string => {
  return `${host}/file/image/access-token/${token}`;
};

type BytesFunction = (...parts: Array<Array<number> | string>) => Uint8Array;

const bytes: BytesFunction = (
  ...parts: Array<Array<number> | string>
): Uint8Array => {
  const out: Array<number> = [];

  for (const part of parts) {
    if (typeof part === "string") {
      for (let index: number = 0; index < part.length; index++) {
        out.push(part.charCodeAt(index));
      }
    } else {
      out.push(...part);
    }
  }

  return new Uint8Array(out);
};

const PNG_HEAD: Uint8Array = bytes(
  [0x89],
  "PNG",
  [0x0d, 0x0a, 0x1a, 0x0a],
  "....IHDR",
);
const JPEG_HEAD: Uint8Array = bytes([0xff, 0xd8, 0xff, 0xe0], "..JFIF");
const GIF_HEAD: Uint8Array = bytes("GIF89a", [0x01, 0x00, 0x01, 0x00]);
const WEBP_HEAD: Uint8Array = bytes(
  "RIFF",
  [0x24, 0x00, 0x00, 0x00],
  "WEBPVP8 ",
);
const SVG_HEAD: Uint8Array = bytes(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
);
const HTML_HEAD: Uint8Array = bytes("<!doctype html><script>alert(1)</script>");

const picture: (
  fileType: string,
  head: Uint8Array,
  sizeInBytes?: number,
) => MarkdownFileFacts = (
  fileType: string,
  head: Uint8Array,
  sizeInBytes?: number,
): MarkdownFileFacts => {
  return {
    name: "picture",
    fileType: fileType,
    head: head,
    sizeInBytes: sizeInBytes === undefined ? head.length : sizeInBytes,
  };
};

const NO_FILES_YET: { count: number; totalSizeInBytes: number } = {
  count: 0,
  totalSizeInBytes: 0,
};

describe("the limits", () => {
  test("one file may be as large as an upload, and a read hands out at most 20 files and 10 MB", () => {
    expect(MARKDOWN_FILE_MAX_SIZE_IN_BYTES).toBe(10 * 1024 * 1024);
    expect(MARKDOWN_FILES_MAX_TOTAL_SIZE_IN_BYTES).toBe(10 * 1024 * 1024);
    expect(MARKDOWN_FILES_MAX_COUNT).toBe(20);
    expect(MARKDOWN_FILES_MAX_REFERENCES).toBeGreaterThan(
      MARKDOWN_FILES_MAX_COUNT,
    );
  });

  test("the route sits under the record's own path", () => {
    expect(MARKDOWN_FILES_ROUTE).toBe("/markdown-files");
  });

  test("what is read of a file to check it is what the content check reads", () => {
    expect(MARKDOWN_FILE_HEAD_LENGTH).toBe(FILE_CONTENT_HEAD_LENGTH);
  });

  test("only raster pictures are handed out: never SVG, never a document", () => {
    expect(MARKDOWN_FILE_TYPES).toEqual(
      expect.arrayContaining([
        MimeType.png,
        MimeType.jpeg,
        MimeType.gif,
        MimeType.webp,
      ]),
    );

    for (const type of MARKDOWN_FILE_TYPES) {
      expect(type.startsWith("image/")).toBe(true);
    }

    expect(MARKDOWN_FILE_TYPES).not.toContain(MimeType.svg);
    expect(MARKDOWN_FILE_TYPES).not.toContain(MimeType.pdf);
    expect(MARKDOWN_FILE_TYPES).not.toContain(MimeType.txt);
    expect(MARKDOWN_FILE_TYPES).not.toContain(MimeType.zip);
  });

  test("every reason a file is left out says why in words, with the limit it is over", () => {
    for (const reason of Object.values(MarkdownFileLeftOutReason)) {
      expect(MARKDOWN_FILE_LEFT_OUT_MESSAGES[reason].length).toBeGreaterThan(
        20,
      );
    }

    // The figure keeps its unit on its line (NumbersKeepTheirUnitsInCodeGuard).
    expect(
      MARKDOWN_FILE_LEFT_OUT_MESSAGES[MarkdownFileLeftOutReason.TooLarge],
    ).toContain("10\u00A0MB");
    expect(
      MARKDOWN_FILE_LEFT_OUT_MESSAGES[MarkdownFileLeftOutReason.OverTotalSize],
    ).toContain("10\u00A0MB");
    expect(
      MARKDOWN_FILE_LEFT_OUT_MESSAGES[MarkdownFileLeftOutReason.TooMany],
    ).toContain("20");
    expect(
      MARKDOWN_FILE_LEFT_OUT_MESSAGES[MarkdownFileLeftOutReason.NotAPicture],
    ).toContain("SVG");
  });
});

describe("readMarkdownImageReferences", () => {
  test("an image as the editor writes it: the whole address, and its token", () => {
    expect(
      readMarkdownImageReferences(
        `Before ![screenshot.png](${address(TOKEN_A)}) after`,
      ),
    ).toEqual([{ token: TOKEN_A, url: address(TOKEN_A) }]);
  });

  test("an installation served under a path of its own keeps the path", () => {
    const url: string = address(TOKEN_A, "https://tools.example.com/oneuptime");

    expect(readMarkdownImageReferences(`![a](${url})`)).toEqual([
      { token: TOKEN_A, url: url },
    ]);
  });

  test("an address written as a path alone is read as one", () => {
    expect(
      readMarkdownImageReferences(
        `![a](/file/image/access-token/${TOKEN_B} "title")`,
      ),
    ).toEqual([{ token: TOKEN_B, url: `/file/image/access-token/${TOKEN_B}` }]);
  });

  test("an <img> tag, a link and a bare address are all read", () => {
    const markdown: string = [
      `<img src="${address(TOKEN_A)}" width="300">`,
      `[the image](${address(TOKEN_B)})`,
      `See ${address(TOKEN_C, "http://localhost:3002")} too.`,
    ].join("\n");

    expect(readMarkdownImageReferences(markdown)).toEqual([
      { token: TOKEN_A, url: address(TOKEN_A) },
      { token: TOKEN_B, url: address(TOKEN_B) },
      { token: TOKEN_C, url: address(TOKEN_C, "http://localhost:3002") },
    ]);
  });

  test("in the order written, the same address once, the same file by two addresses twice", () => {
    const markdown: string = `![1](${address(TOKEN_B)}) ![2](${address(TOKEN_A)}) ![3](${address(TOKEN_B)}) ![4](${address(TOKEN_A, "https://old.example.com")})`;

    expect(
      readMarkdownImageReferences(markdown).map(
        (reference: MarkdownImageReference): string => {
          return reference.url;
        },
      ),
    ).toEqual([
      address(TOKEN_B),
      address(TOKEN_A),
      address(TOKEN_A, "https://old.example.com"),
    ]);
  });

  test("two images on one line, with nothing between them, are two", () => {
    expect(
      readMarkdownImageReferences(
        `![a](${address(TOKEN_A)})![b](${address(TOKEN_B)})`,
      ),
    ).toHaveLength(2);
  });

  test("the token ends where the hex does", () => {
    expect(
      readMarkdownImageReferences(`![a](${address(TOKEN_A)}?width=300)`),
    ).toEqual([{ token: TOKEN_A, url: address(TOKEN_A) }]);
  });

  test("an image by its file's id, any other link and an address with no token are not images by token", () => {
    expect(
      readMarkdownImageReferences(
        [
          `![a](${HOST}/file/image/5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e)`,
          `![b](https://example.com/picture.png)`,
          `![c](${HOST}/file/image/access-token/)`,
          `![d](${HOST}/file/image/access-token/not-hex)`,
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("anything that is not text holds no image", () => {
    for (const value of [
      undefined,
      null,
      "",
      42,
      true,
      {},
      [address(TOKEN_A)],
    ]) {
      expect(readMarkdownImageReferences(value)).toEqual([]);
    }
  });

  test("a long piece of Markdown is read in one pass", () => {
    const markdown: string = Array.from(
      { length: 500 },
      (_value: unknown, index: number): string => {
        return `![${index}](${address(index.toString(16).padStart(64, "0"))})`;
      },
    ).join(" lorem ipsum ");

    expect(readMarkdownImageReferences(markdown)).toHaveLength(500);
  });
});

describe("collectMarkdownFileReferences", () => {
  test("each file once, in the order the fields show them, naming every field and address", () => {
    const references: Array<MarkdownFileReference> =
      collectMarkdownFileReferences([
        {
          field: "description",
          markdown: `![a](${address(TOKEN_A)}) ![b](${address(TOKEN_B)})`,
        },
        { field: "rootCause", markdown: null },
        {
          field: "Customer impact",
          markdown: `![b again](${address(TOKEN_B, "https://old.example.com")}) ![c](${address(TOKEN_C)})`,
        },
        { field: "postmortemNote", markdown: `![a](${address(TOKEN_A)})` },
      ]);

    expect(references).toEqual([
      {
        token: TOKEN_A,
        urls: [address(TOKEN_A)],
        fields: ["description", "postmortemNote"],
      },
      {
        token: TOKEN_B,
        urls: [address(TOKEN_B), address(TOKEN_B, "https://old.example.com")],
        fields: ["description", "Customer impact"],
      },
      { token: TOKEN_C, urls: [address(TOKEN_C)], fields: ["Customer impact"] },
    ]);
  });

  test("fields that show no image make no references", () => {
    expect(
      collectMarkdownFileReferences([
        { field: "description", markdown: "No images here." },
        { field: "Count", markdown: 3 },
      ]),
    ).toEqual([]);
  });

  test("a token is matched exactly, as the image route matches it", () => {
    expect(
      collectMarkdownFileReferences([
        {
          field: "description",
          markdown: `![a](${address(TOKEN_B)}) ![b](${address(TOKEN_B.toUpperCase())})`,
        },
      ]),
    ).toHaveLength(2);
  });
});

describe("getMarkdownFileType", () => {
  test("each type handed out is itself, in any case and with space around it", () => {
    for (const type of MARKDOWN_FILE_TYPES) {
      expect(getMarkdownFileType(type)).toBe(type);
      expect(getMarkdownFileType(` ${type.toUpperCase()} `)).toBe(type);
    }
  });

  test("an older name of a picture's type is read as the type it is", () => {
    expect(getMarkdownFileType("image/jpg")).toBe(MimeType.jpeg);
    expect(getMarkdownFileType("image/pjpeg")).toBe(MimeType.jpeg);
    expect(getMarkdownFileType("image/vnd.microsoft.icon")).toBe(MimeType.ico);
    expect(getMarkdownFileType("image/x-ms-bmp")).toBe(MimeType.bmp);
  });

  test("SVG, documents, text, a made-up type and a name every object has are never handed out", () => {
    for (const type of [
      MimeType.svg,
      MimeType.pdf,
      MimeType.txt,
      MimeType.json,
      MimeType.zip,
      "text/html",
      "application/octet-stream",
      "image/svg+xml; charset=utf-8",
      "constructor",
      "__proto__",
      "toString",
      "",
      null,
      undefined,
    ]) {
      expect(getMarkdownFileType(type)).toBeNull();
    }
  });
});

describe("getMarkdownFileLeftOutReason", () => {
  test("a picture that holds what its type says is handed out", () => {
    expect(
      getMarkdownFileLeftOutReason({
        file: picture(MimeType.png, PNG_HEAD),
        tally: NO_FILES_YET,
      }),
    ).toBeNull();
    expect(
      getMarkdownFileLeftOutReason({
        file: picture(MimeType.jpeg, JPEG_HEAD),
        tally: NO_FILES_YET,
      }),
    ).toBeNull();
    expect(
      getMarkdownFileLeftOutReason({
        file: picture(MimeType.gif, GIF_HEAD),
        tally: NO_FILES_YET,
      }),
    ).toBeNull();
    expect(
      getMarkdownFileLeftOutReason({
        file: picture(MimeType.webp, WEBP_HEAD),
        tally: NO_FILES_YET,
      }),
    ).toBeNull();
    expect(
      getMarkdownFileLeftOutReason({
        file: picture("image/jpg", JPEG_HEAD),
        tally: NO_FILES_YET,
      }),
    ).toBeNull();
  });

  test("an SVG is left out, script or not", () => {
    expect(
      getMarkdownFileLeftOutReason({
        file: picture(MimeType.svg, SVG_HEAD),
        tally: NO_FILES_YET,
      }),
    ).toBe(MarkdownFileLeftOutReason.NotAPicture);
  });

  test("a page stored as a picture is left out", () => {
    expect(
      getMarkdownFileLeftOutReason({
        file: picture(MimeType.png, HTML_HEAD),
        tally: NO_FILES_YET,
      }),
    ).toBe(MarkdownFileLeftOutReason.NotAPicture);
  });

  test("a picture stored as another kind of picture is left out", () => {
    expect(
      getMarkdownFileLeftOutReason({
        file: picture(MimeType.jpeg, PNG_HEAD),
        tally: NO_FILES_YET,
      }),
    ).toBe(MarkdownFileLeftOutReason.NotAPicture);
  });

  test("an empty file holds no picture", () => {
    expect(
      getMarkdownFileLeftOutReason({
        file: picture(MimeType.png, new Uint8Array(0), 0),
        tally: NO_FILES_YET,
      }),
    ).toBe(MarkdownFileLeftOutReason.NotAPicture);
  });

  test("a document is left out even when it holds what its type says", () => {
    expect(
      getMarkdownFileLeftOutReason({
        file: picture(MimeType.pdf, bytes("%PDF-1.7 a report")),
        tally: NO_FILES_YET,
      }),
    ).toBe(MarkdownFileLeftOutReason.NotAPicture);
  });

  test("a picture as large as one file may be is handed out, one byte more is too large", () => {
    expect(
      getMarkdownFileLeftOutReason({
        file: picture(MimeType.png, PNG_HEAD, MARKDOWN_FILE_MAX_SIZE_IN_BYTES),
        tally: NO_FILES_YET,
      }),
    ).toBeNull();
    expect(
      getMarkdownFileLeftOutReason({
        file: picture(
          MimeType.png,
          PNG_HEAD,
          MARKDOWN_FILE_MAX_SIZE_IN_BYTES + 1,
        ),
        tally: NO_FILES_YET,
      }),
    ).toBe(MarkdownFileLeftOutReason.TooLarge);
  });

  test("once the read holds as many files as it may, the next is one too many", () => {
    expect(
      getMarkdownFileLeftOutReason({
        file: picture(MimeType.png, PNG_HEAD),
        tally: { count: MARKDOWN_FILES_MAX_COUNT - 1, totalSizeInBytes: 0 },
      }),
    ).toBeNull();
    expect(
      getMarkdownFileLeftOutReason({
        file: picture(MimeType.png, PNG_HEAD),
        tally: { count: MARKDOWN_FILES_MAX_COUNT, totalSizeInBytes: 0 },
      }),
    ).toBe(MarkdownFileLeftOutReason.TooMany);
  });

  test("a file that takes the read to its total exactly is handed out, past it is not", () => {
    const size: number = 1024;

    expect(
      getMarkdownFileLeftOutReason({
        file: picture(MimeType.png, PNG_HEAD, size),
        tally: {
          count: 3,
          totalSizeInBytes: MARKDOWN_FILES_MAX_TOTAL_SIZE_IN_BYTES - size,
        },
      }),
    ).toBeNull();
    expect(
      getMarkdownFileLeftOutReason({
        file: picture(MimeType.png, PNG_HEAD, size + 1),
        tally: {
          count: 3,
          totalSizeInBytes: MARKDOWN_FILES_MAX_TOTAL_SIZE_IN_BYTES - size,
        },
      }),
    ).toBe(MarkdownFileLeftOutReason.OverTotalSize);
  });

  test("what is not a picture says so, however full the read is", () => {
    expect(
      getMarkdownFileLeftOutReason({
        file: picture(MimeType.svg, SVG_HEAD),
        tally: {
          count: MARKDOWN_FILES_MAX_COUNT,
          totalSizeInBytes: MARKDOWN_FILES_MAX_TOTAL_SIZE_IN_BYTES,
        },
      }),
    ).toBe(MarkdownFileLeftOutReason.NotAPicture);
  });
});
