import {
  readRecentCommandIds,
  RECENT_COMMANDS_LIMIT,
  writeRecentCommandId,
} from "../../../../UI/Components/CommandPalette/RecentCommands";
import { afterEach, describe, expect, test } from "@jest/globals";

const STORAGE_KEY: string = "test-command-palette-recents";

describe("RecentCommands storage", () => {
  afterEach(() => {
    window.localStorage.clear();
    jest.restoreAllMocks();
  });

  test("reads back what was written, most recent first", () => {
    writeRecentCommandId(STORAGE_KEY, "first");
    writeRecentCommandId(STORAGE_KEY, "second");

    expect(readRecentCommandIds(STORAGE_KEY)).toEqual(["second", "first"]);
  });

  test("re-selecting a command moves it to the front instead of duplicating", () => {
    writeRecentCommandId(STORAGE_KEY, "a");
    writeRecentCommandId(STORAGE_KEY, "b");
    writeRecentCommandId(STORAGE_KEY, "a");

    expect(readRecentCommandIds(STORAGE_KEY)).toEqual(["a", "b"]);
  });

  test(`keeps at most ${RECENT_COMMANDS_LIMIT} ids`, () => {
    for (let index: number = 0; index < RECENT_COMMANDS_LIMIT + 3; index++) {
      writeRecentCommandId(STORAGE_KEY, `command-${index}`);
    }

    const stored: Array<string> = readRecentCommandIds(STORAGE_KEY);

    expect(stored).toHaveLength(RECENT_COMMANDS_LIMIT);
    // Newest first; the earliest writes fell off the end.
    expect(stored[0]).toBe(`command-${RECENT_COMMANDS_LIMIT + 2}`);
  });

  test("caps reads even when storage holds more ids than the limit", () => {
    const oversized: Array<string> = [];
    for (let index: number = 0; index < 20; index++) {
      oversized.push(`command-${index}`);
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(oversized));

    expect(readRecentCommandIds(STORAGE_KEY)).toHaveLength(
      RECENT_COMMANDS_LIMIT,
    );
  });

  test("tolerates corrupt JSON", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not json[");

    expect(readRecentCommandIds(STORAGE_KEY)).toEqual([]);
  });

  test("tolerates JSON that is not an array", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ nope: true }));

    expect(readRecentCommandIds(STORAGE_KEY)).toEqual([]);
  });

  test("filters non-string entries out of a stored array", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(["ok", 42, null, { id: "x" }, "also-ok"]),
    );

    expect(readRecentCommandIds(STORAGE_KEY)).toEqual(["ok", "also-ok"]);
  });

  test("an empty key reads as no recents", () => {
    expect(readRecentCommandIds(STORAGE_KEY)).toEqual([]);
  });

  test("a throwing setItem (quota / private mode) is swallowed", () => {
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    expect(() => {
      writeRecentCommandId(STORAGE_KEY, "anything");
    }).not.toThrow();
  });

  test("a throwing getItem is swallowed and reads as no recents", () => {
    jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    expect(readRecentCommandIds(STORAGE_KEY)).toEqual([]);
  });
});
