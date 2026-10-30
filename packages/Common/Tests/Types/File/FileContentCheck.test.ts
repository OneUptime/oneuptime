import {
  FILE_CONTENT_HEAD_LENGTH,
  hasFileContentRule,
  isFileContentOfType,
} from "../../../Types/File/FileContentCheck";
import MimeType from "../../../Types/File/MimeType";
import { describe, expect, test } from "@jest/globals";

/*
 * A file is checked by what it holds, not only by the type it was uploaded
 * as: every kind a file custom field or a form's file question takes begins
 * with a signature of its own, and a text file is text. What must hold: a
 * real file of each kind passes, the same bytes under another kind's type
 * fail, and a page or a program renamed to a document never passes.
 */

type BytesFunction = (...parts: Array<Array<number> | string>) => Uint8Array;

// Bytes from numbers and ASCII text, in order.
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

type CheckFunction = (fileType: string, head: Uint8Array) => boolean;

// A file that is exactly these bytes.
const check: CheckFunction = (fileType: string, head: Uint8Array): boolean => {
  return isFileContentOfType({ fileType, head, size: head.length });
};

const SAMPLES: Record<string, Uint8Array> = {
  [MimeType.png]: bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a], "....IHDR"),
  [MimeType.jpeg]: bytes([0xff, 0xd8, 0xff, 0xe0], "..JFIF"),
  [MimeType.gif]: bytes("GIF89a", [0x01, 0x00, 0x01, 0x00]),
  [MimeType.webp]: bytes("RIFF", [0x24, 0x00, 0x00, 0x00], "WEBPVP8 "),
  [MimeType.bmp]: bytes("BM", [0x3a, 0x00, 0x00, 0x00]),
  [MimeType.tiff]: bytes([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00]),
  [MimeType.avif]: bytes([0x00, 0x00, 0x00, 0x1c], "ftypavif", [0, 0, 0, 0]),
  [MimeType.heic]: bytes([0x00, 0x00, 0x00, 0x18], "ftypheic", [0, 0, 0, 0]),
  [MimeType.pdf]: bytes("%PDF-1.7\n%", [0xe2, 0xe3, 0xcf, 0xd3], "\n1 0 obj"),
  [MimeType.rtf]: bytes("{\\rtf1\\ansi Hello}"),
  [MimeType.doc]: bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]),
  [MimeType.docx]: bytes([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00], "word/"),
  [MimeType.zip]: bytes([0x50, 0x4b, 0x03, 0x04, 0x0a, 0x00]),
  [MimeType.pcap]: bytes([0xd4, 0xc3, 0xb2, 0xa1, 0x02, 0x00, 0x04, 0x00]),
  [MimeType.txt]: bytes("Disk full on db-2 at 03:12\n"),
  [MimeType.md]: bytes("# Postmortem\n\n- impact: *all* users\n"),
  [MimeType.csv]: bytes("host,cpu\ndb-1,93\n"),
  [MimeType.json]: bytes('  {"host": "db-1", "cpu": 93}'),
};

describe("a file of each kind passes as its own kind", () => {
  test.each(Object.keys(SAMPLES))("%s", (fileType: string) => {
    expect(check(fileType, SAMPLES[fileType]!)).toBe(true);
  });

  test("every Office and OpenDocument file is a ZIP archive", () => {
    const zip: Uint8Array = SAMPLES[MimeType.docx]!;

    for (const type of [
      MimeType.xlsx,
      MimeType.pptx,
      MimeType.odt,
      MimeType.ods,
      MimeType.odp,
    ]) {
      expect(check(type, zip)).toBe(true);
    }
  });

  test("Word, Excel and PowerPoint before 2007 are compound files", () => {
    const ole: Uint8Array = SAMPLES[MimeType.doc]!;

    expect(check(MimeType.xls, ole)).toBe(true);
    expect(check(MimeType.ppt, ole)).toBe(true);
  });

  test("an empty ZIP archive, a big-endian TIFF, a GIF87a and pcapng pass", () => {
    expect(check(MimeType.zip, bytes([0x50, 0x4b, 0x05, 0x06, 0, 0]))).toBe(
      true,
    );
    expect(
      check(MimeType.tiff, bytes([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x08])),
    ).toBe(true);
    expect(check(MimeType.gif, bytes("GIF87a", [0x01]))).toBe(true);
    expect(
      check(MimeType.pcap, bytes([0x0a, 0x0d, 0x0d, 0x0a, 0x1c, 0, 0, 0])),
    ).toBe(true);
  });

  test("a PDF whose header comes after a little junk, as readers allow", () => {
    expect(check(MimeType.pdf, bytes("\n\n  %PDF-1.4\n"))).toBe(true);
  });

  test("a PDF whose header is past its first kilobyte does not pass", () => {
    const junk: string = "x".repeat(1100);

    expect(check(MimeType.pdf, bytes(junk, "%PDF-1.4"))).toBe(false);
  });
});

describe("the same bytes under another kind's type fail", () => {
  const binaryTypes: Array<string> = [
    MimeType.png,
    MimeType.jpeg,
    MimeType.gif,
    MimeType.webp,
    MimeType.bmp,
    MimeType.tiff,
    MimeType.pdf,
    MimeType.rtf,
    MimeType.doc,
    MimeType.zip,
    MimeType.pcap,
  ];

  test.each(binaryTypes)("a %s is no other binary kind", (fileType: string) => {
    for (const other of binaryTypes) {
      if (other === fileType) {
        continue;
      }

      expect(check(other, SAMPLES[fileType]!)).toBe(false);
    }
  });

  test("a picture is not text", () => {
    expect(check(MimeType.txt, SAMPLES[MimeType.png]!)).toBe(false);
    expect(check(MimeType.csv, SAMPLES[MimeType.jpeg]!)).toBe(false);
  });

  test("an AVIF is not a HEIC, and a HEIC is not an AVIF", () => {
    expect(check(MimeType.heic, SAMPLES[MimeType.avif]!)).toBe(false);
    expect(check(MimeType.avif, SAMPLES[MimeType.heic]!)).toBe(false);
  });
});

describe("a page or a program renamed to a document never passes", () => {
  const page: Uint8Array = bytes(
    "<!doctype html><html><script>alert(1)</script></html>",
  );
  const program: Uint8Array = bytes("MZ", [0x90, 0x00, 0x03, 0x00, 0x00]);
  const elf: Uint8Array = bytes([0x7f], "ELF", [0x02, 0x01, 0x01]);

  test.each([
    MimeType.pdf,
    MimeType.png,
    MimeType.jpeg,
    MimeType.docx,
    MimeType.xlsx,
    MimeType.doc,
    MimeType.zip,
  ])("an HTML page as %s", (fileType: string) => {
    expect(check(fileType, page)).toBe(false);
  });

  test.each([MimeType.pdf, MimeType.png, MimeType.txt, MimeType.json])(
    "a Windows program as %s",
    (fileType: string) => {
      expect(check(fileType, program)).toBe(false);
    },
  );

  test("a Linux program is not text: it holds control characters", () => {
    expect(check(MimeType.txt, elf)).toBe(false);
  });

  test("an HTML page is text, so it passes as plain text only, where it is shown as text", () => {
    /*
     * Served as text/plain, as an attachment, with nosniff
     * (Response.sendFileResponse), it is never run as a page.
     */
    expect(check(MimeType.txt, page)).toBe(true);
    expect(check(MimeType.json, page)).toBe(false);
  });
});

describe("text", () => {
  test("UTF-8 with any language passes", () => {
    const text: Uint8Array = new TextEncoder().encode(
      "Störung im Rechenzentrum — 磁盘已满 — قطعی سرور\n",
    );

    expect(check(MimeType.txt, text)).toBe(true);
    expect(check(MimeType.md, text)).toBe(true);
  });

  test("a byte order mark is allowed", () => {
    expect(check(MimeType.csv, bytes([0xef, 0xbb, 0xbf], "a,b\n1,2\n"))).toBe(
      true,
    );
    expect(check(MimeType.json, bytes([0xef, 0xbb, 0xbf], '["x"]'))).toBe(true);
  });

  test("tabs, line breaks, form feeds and escapes are text", () => {
    expect(
      check(MimeType.txt, bytes("a\tb\r\nc\x0cd \x1b[31mred\x1b[0m\n")),
    ).toBe(true);
  });

  test("a NUL, another control character or DEL is not text", () => {
    expect(check(MimeType.txt, bytes("abc", [0x00], "def"))).toBe(false);
    expect(check(MimeType.txt, bytes("abc", [0x01]))).toBe(false);
    expect(check(MimeType.txt, bytes("abc", [0x7f]))).toBe(false);
  });

  test("bytes that are not UTF-8 are not text", () => {
    // A lone continuation byte, an overlong lead, and a lead past U+10FFFF.
    expect(check(MimeType.txt, bytes("ab", [0x80], "cd"))).toBe(false);
    expect(check(MimeType.txt, bytes("ab", [0xc0, 0x80]))).toBe(false);
    expect(check(MimeType.txt, bytes("ab", [0xf5, 0x80, 0x80, 0x80]))).toBe(
      false,
    );
    // A lead byte followed by a byte that is not a continuation.
    expect(check(MimeType.txt, bytes("ab", [0xe2, 0x41, 0x41]))).toBe(false);
  });

  test("a character cut off by the end of what was read counts, but not at the end of the file", () => {
    const head: Uint8Array = bytes("ab", [0xe2, 0x82]);

    expect(
      isFileContentOfType({ fileType: MimeType.txt, head, size: 10_000 }),
    ).toBe(true);
    expect(
      isFileContentOfType({ fileType: MimeType.txt, head, size: head.length }),
    ).toBe(false);
  });

  test("UTF-16 with its byte order mark passes, as spreadsheet programs save a CSV", () => {
    const little: Uint8Array = bytes([0xff, 0xfe], [0x61, 0x00, 0x2c, 0x00]);
    const big: Uint8Array = bytes([0xfe, 0xff], [0x00, 0x61, 0x00, 0x2c]);

    expect(check(MimeType.csv, little)).toBe(true);
    expect(check(MimeType.txt, big)).toBe(true);
  });

  test("UTF-16 holding a NUL character is not text", () => {
    expect(check(MimeType.txt, bytes([0xff, 0xfe], [0x00, 0x00]))).toBe(false);
  });

  test("JSON must open an object or a list", () => {
    expect(check(MimeType.json, bytes("[1, 2]"))).toBe(true);
    expect(check(MimeType.json, bytes("\n\t {}"))).toBe(true);
    expect(check(MimeType.json, bytes('"just a string"'))).toBe(false);
    expect(check(MimeType.json, bytes("hello"))).toBe(false);
  });
});

describe("what is never taken", () => {
  test("an empty file holds nothing of any kind", () => {
    expect(
      isFileContentOfType({
        fileType: MimeType.txt,
        head: new Uint8Array(0),
        size: 0,
      }),
    ).toBe(false);
  });

  test("a type with no rule is refused, whatever the bytes", () => {
    expect(check(MimeType.svg, bytes("<svg xmlns='x'></svg>"))).toBe(false);
    expect(check(MimeType.aac, bytes([0xff, 0xf1, 0x50]))).toBe(false);
    expect(check("text/html", bytes("<html></html>"))).toBe(false);
    expect(check("", SAMPLES[MimeType.png]!)).toBe(false);
    expect(
      isFileContentOfType({
        fileType: null,
        head: SAMPLES[MimeType.png]!,
        size: 10,
      }),
    ).toBe(false);
    expect(hasFileContentRule(MimeType.svg)).toBe(false);
    expect(hasFileContentRule("text/html")).toBe(false);
    expect(hasFileContentRule(undefined)).toBe(false);
  });

  test("the type is read however it is cased or padded", () => {
    expect(check(" IMAGE/PNG ", SAMPLES[MimeType.png]!)).toBe(true);
    expect(hasFileContentRule(" Application/PDF")).toBe(true);
  });

  test("a signature shorter than its rule's is no file of it", () => {
    expect(check(MimeType.png, bytes([0x89, 0x50]))).toBe(false);
    expect(check(MimeType.webp, bytes("RIFF"))).toBe(false);
  });
});

describe("only the start of a file is read", () => {
  test("the head read is 8 KB", () => {
    expect(FILE_CONTENT_HEAD_LENGTH).toBe(8192);
  });

  test("text past the first 8 KB is not read", () => {
    const head: Uint8Array = bytes("a".repeat(FILE_CONTENT_HEAD_LENGTH), [0]);

    expect(
      isFileContentOfType({
        fileType: MimeType.txt,
        head: head,
        size: head.length,
      }),
    ).toBe(true);
  });
});
