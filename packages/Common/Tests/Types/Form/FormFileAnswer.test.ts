import {
  cleanFormFileName,
  decodeBase64,
  encodeBase64,
  FORM_FILE_MAX_SIZE_IN_BYTES,
  FORM_FILE_NAME_MAX_LENGTH,
  FORM_FILE_QUESTION_MAX_FILES,
  FORM_SUBMISSION_FILES_MAX_TOTAL_SIZE_IN_BYTES,
  FORM_SUBMISSION_MAX_FILES,
  getBase64DecodedLength,
} from "../../../Types/Form/FormFileAnswer";
import {
  CUSTOM_FIELD_FILE_MAX_SIZE_IN_BYTES,
  CUSTOM_FIELD_MAX_FILES,
} from "../../../Types/CustomField/CustomFieldFile";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * A form's file question sends each file as { name, fileType, data } with
 * the bytes in base64: there may be nobody signed in to upload them as. The
 * codec here is the page's and the server's, read strictly and in one pass
 * - a file's text is megabytes on one line - and the limits are the ones a
 * file custom field keeps, plus a whole submission's.
 */

describe("the limits", () => {
  test("a file is what a file custom field takes: at most 10 MB", () => {
    expect(FORM_FILE_MAX_SIZE_IN_BYTES).toBe(
      CUSTOM_FIELD_FILE_MAX_SIZE_IN_BYTES,
    );
    expect(FORM_FILE_MAX_SIZE_IN_BYTES).toBe(10 * 1024 * 1024);
  });

  test("a question takes as many files as a Multiple files field holds", () => {
    expect(FORM_FILE_QUESTION_MAX_FILES).toBe(CUSTOM_FIELD_MAX_FILES);
  });

  test("a submission carries at most 10 files and 20 MB, well inside the 50 MB the server reads as base64", () => {
    expect(FORM_SUBMISSION_MAX_FILES).toBe(10);
    expect(FORM_SUBMISSION_FILES_MAX_TOTAL_SIZE_IN_BYTES).toBe(
      20 * 1024 * 1024,
    );
    // Base64 is four characters for every three bytes.
    expect(
      (FORM_SUBMISSION_FILES_MAX_TOTAL_SIZE_IN_BYTES * 4) / 3,
    ).toBeLessThan(50 * 1024 * 1024 * 0.6);
  });

  test("a name fits a File's name", () => {
    expect(FORM_FILE_NAME_MAX_LENGTH).toBe(100);
  });
});

describe("encodeBase64 and decodeBase64", () => {
  test("agree with the standard encoding, padding and all", () => {
    for (const text of ["", "f", "fo", "foo", "foob", "fooba", "foobar"]) {
      const bytes: Uint8Array = new TextEncoder().encode(text);
      const encoded: string = encodeBase64(bytes);

      expect(encoded).toBe(Buffer.from(text, "utf8").toString("base64"));
      expect(Array.from(decodeBase64(encoded, 100)!)).toEqual(
        Array.from(bytes),
      );
    }
  });

  test("round-trip any bytes", () => {
    const random: SeededRandom = seededRandom(36);

    for (let round: number = 0; round < 50; round++) {
      const bytes: Uint8Array = new Uint8Array(random(3000));

      for (let index: number = 0; index < bytes.length; index++) {
        bytes[index] = random(256);
      }

      const encoded: string = encodeBase64(bytes);

      expect(encoded).toBe(Buffer.from(bytes).toString("base64"));
      expect(
        Buffer.from(decodeBase64(encoded, 3000)!).equals(Buffer.from(bytes)),
      ).toBe(true);
    }
  });

  test("a text with a character outside the alphabet is no base64", () => {
    for (const text of ["ab-d", "ab_d", "ab d", "ab\nd", "abé=", "ab\u0000d"]) {
      expect(decodeBase64(text, 100)).toBeNull();
    }
  });

  test("a text whose length is not a whole number of four is no base64", () => {
    for (const text of ["a", "ab", "abc", "abcde"]) {
      expect(decodeBase64(text, 100)).toBeNull();
      expect(getBase64DecodedLength(text)).toBeNull();
    }
  });

  test("padding only at the end, and only in its last two places", () => {
    expect(decodeBase64("ab=d", 100)).toBeNull();
    expect(decodeBase64("a===", 100)).toBeNull();
    expect(decodeBase64("ab==abcd", 100)).toBeNull();
    expect(decodeBase64("abc=", 100)).not.toBeNull();
    expect(decodeBase64("ab==", 100)).not.toBeNull();
    // A character after a padding character.
    expect(decodeBase64("ab=c", 100)).toBeNull();
  });

  test("a text holding more than the limit is refused before it is read", () => {
    const text: string = encodeBase64(new Uint8Array(1001));

    expect(getBase64DecodedLength(text)).toBe(1001);
    expect(decodeBase64(text, 1000)).toBeNull();
    expect(decodeBase64(text, 1001)!.length).toBe(1001);
  });

  test("anything but text is no base64", () => {
    expect(decodeBase64(42 as unknown as string, 100)).toBeNull();
    expect(decodeBase64(null as unknown as string, 100)).toBeNull();
  });

  test("getBase64DecodedLength counts the bytes from the length and the padding", () => {
    expect(getBase64DecodedLength("")).toBe(0);
    expect(getBase64DecodedLength("Zg==")).toBe(1);
    expect(getBase64DecodedLength("Zm8=")).toBe(2);
    expect(getBase64DecodedLength("Zm9v")).toBe(3);
  });

  test("a 10 MB file is read in time that grows with it, never with its square", () => {
    const bytes: Uint8Array = new Uint8Array(10 * 1024 * 1024).fill(0x5a);
    const encoded: string = encodeBase64(bytes);

    const decoded: FastestRun<Uint8Array | null> = fastestRun({
      run: (): Uint8Array | null => {
        return decodeBase64(encoded, FORM_FILE_MAX_SIZE_IN_BYTES);
      },
      limitInMs: 2000,
    });

    expect(decoded.result!.length).toBe(bytes.length);
    expect(decoded.inMs).toBeLessThan(2000);
  });
});

describe("cleanFormFileName", () => {
  test("keeps an ordinary name as it is", () => {
    expect(cleanFormFileName("outage screenshot.png")).toBe(
      "outage screenshot.png",
    );
    expect(cleanFormFileName("Störung — 磁盘.pdf")).toBe("Störung — 磁盘.pdf");
  });

  test("keeps only the last part of a path a browser sends", () => {
    expect(cleanFormFileName("C:\\fakepath\\report.pdf")).toBe("report.pdf");
    expect(cleanFormFileName("../../etc/passwd.txt")).toBe("passwd.txt");
    expect(cleanFormFileName("/home/ada/logs.zip")).toBe("logs.zip");
  });

  test("drops control characters and line breaks, and runs of spaces", () => {
    expect(cleanFormFileName("re\u0000port\r\n.pdf")).toBe("report.pdf");
    expect(cleanFormFileName("  a    b  .txt  ")).toBe("a b .txt");
    expect(cleanFormFileName("x\u0085y.txt")).toBe("xy.txt");
  });

  test("cuts a long name to fit, keeping its extension", () => {
    const name: string = cleanFormFileName(`${"a".repeat(300)}.pdf`);

    expect(Array.from(name).length).toBe(FORM_FILE_NAME_MAX_LENGTH);
    expect(name.endsWith(".pdf")).toBe(true);
  });

  test("cuts a long name by characters, never inside one", () => {
    const name: string = cleanFormFileName(`${"磁".repeat(150)}.png`);

    expect(Array.from(name).length).toBe(FORM_FILE_NAME_MAX_LENGTH);
    expect(name.endsWith("磁.png")).toBe(true);
  });

  test("a name of nothing, or no name, is empty", () => {
    for (const name of ["", "   ", "\u0000\u0001", "C:\\folder\\", 7, null]) {
      expect(cleanFormFileName(name)).toBe("");
    }
  });
});
