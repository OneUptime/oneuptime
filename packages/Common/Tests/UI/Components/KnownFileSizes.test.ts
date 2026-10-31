import {
  forgetKnownFileSizes,
  getKnownFileSize,
  KNOWN_FILE_SIZES_MAX_ENTRIES,
  rememberFileSize,
} from "../../../UI/Components/FilePicker/KnownFileSizes";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * The sizes of stored files a page has been told, by id: what lets the file
 * picker - and a form's review step - say a stored file's size, though the
 * File it is handed holds no bytes.
 */

const ID: string = "aaaaaaaa-0000-4000-8000-000000000001";

afterEach(() => {
  forgetKnownFileSizes();
});

describe("the sizes of stored files", () => {
  test("a size told for a file is the size read back for it", () => {
    rememberFileSize(ID, 48213);

    expect(getKnownFileSize(ID)).toBe(48213);
  });

  test("a file it was not told about has no size", () => {
    expect(getKnownFileSize(ID)).toBeNull();
    expect(getKnownFileSize(undefined)).toBeNull();
    expect(getKnownFileSize("")).toBeNull();
  });

  test("an id is the same id in any case, as text or as an ObjectID", () => {
    rememberFileSize(ID.toUpperCase(), 2048);

    expect(getKnownFileSize(ID)).toBe(2048);
    expect(getKnownFileSize(new ObjectID(ID))).toBe(2048);

    rememberFileSize(new ObjectID(ID), 4096);

    expect(getKnownFileSize(` ${ID} `)).toBe(4096);
  });

  test("nothing is kept for no id, or for a size that is none", () => {
    for (const bytes of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "12"]) {
      rememberFileSize(ID, bytes);
    }
    rememberFileSize(undefined, 12);
    rememberFileSize("  ", 12);

    expect(getKnownFileSize(ID)).toBeNull();
    expect(getKnownFileSize("  ")).toBeNull();
  });

  test("a size is whole bytes", () => {
    rememberFileSize(ID, 640.7);

    expect(getKnownFileSize(ID)).toBe(640);
  });

  test("it keeps the most recent sizes only, the oldest let go first", () => {
    const idOf: (n: number) => string = (n: number): string => {
      return `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, "0")}`;
    };

    for (let n: number = 1; n <= KNOWN_FILE_SIZES_MAX_ENTRIES + 5; n++) {
      rememberFileSize(idOf(n), n);
    }

    expect(getKnownFileSize(idOf(1))).toBeNull();
    expect(getKnownFileSize(idOf(5))).toBeNull();
    expect(getKnownFileSize(idOf(6))).toBe(6);
    expect(getKnownFileSize(idOf(KNOWN_FILE_SIZES_MAX_ENTRIES + 5))).toBe(
      KNOWN_FILE_SIZES_MAX_ENTRIES + 5,
    );
  });

  test("a file told again is kept as one of the most recent", () => {
    const idOf: (n: number) => string = (n: number): string => {
      return `cccccccc-0000-4000-8000-${String(n).padStart(12, "0")}`;
    };

    rememberFileSize(idOf(0), 100);

    for (let n: number = 1; n < KNOWN_FILE_SIZES_MAX_ENTRIES; n++) {
      rememberFileSize(idOf(n), n);
    }

    // Told again before the page is full: it moves to the end.
    rememberFileSize(idOf(0), 100);
    rememberFileSize(idOf(KNOWN_FILE_SIZES_MAX_ENTRIES), 1);

    expect(getKnownFileSize(idOf(0))).toBe(100);
    expect(getKnownFileSize(idOf(1))).toBeNull();
  });
});
