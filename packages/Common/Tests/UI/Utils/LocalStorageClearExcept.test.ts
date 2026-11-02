import LocalStorage from "../../../UI/Utils/LocalStorage";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import {
  SeededRandom,
  seededRandom,
  shuffled,
} from "../../Helpers/SeededRandom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * LocalStorage.clearExcept: everything the browser keeps for this address
 * goes but the keys named, on the browser's own storage. What is kept is
 * never read, written or parsed; a clear and a write back would tell every
 * other open tab that everything was gone (the second tab itself is in
 * E2E/AccountsTheme, as only a real browser has one).
 */

const fill: (entries: Record<string, string>) => void = (
  entries: Record<string, string>,
): void => {
  for (const key of Object.keys(entries)) {
    window.localStorage.setItem(key, entries[key]!);
  }
};

// Read as entries: an assignment to "__proto__" would hold nothing.
const everything: () => Record<string, string> = (): Record<string, string> => {
  const found: Array<[string, string]> = [];

  for (let index: number = 0; index < window.localStorage.length; index++) {
    const key: string = window.localStorage.key(index)!;
    found.push([key, window.localStorage.getItem(key)!]);
  }

  return Object.fromEntries(found);
};

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what goes", () => {
  test("everything but the keys named", () => {
    fill({ theme: "dark", language: "de", token: "secret", user: "ada" });

    LocalStorage.clearExcept(["theme", "language"]);

    expect(everything()).toEqual({ theme: "dark", language: "de" });
  });

  test("with nothing named, everything", () => {
    fill({ theme: "dark", token: "secret" });

    LocalStorage.clearExcept([]);

    expect(window.localStorage.length).toBe(0);
  });

  test("an empty browser stays empty", () => {
    LocalStorage.clearExcept(["theme"]);

    expect(window.localStorage.length).toBe(0);
  });

  test("a thousand keys all go: none is skipped as the others are removed", () => {
    const keys: Array<string> = Array.from(
      { length: 1000 },
      (_value: unknown, index: number): string => {
        return `key-${index}`;
      },
    );

    for (const key of keys) {
      window.localStorage.setItem(key, "1");
    }

    window.localStorage.setItem("theme", "dark");

    LocalStorage.clearExcept(["theme"]);

    expect(everything()).toEqual({ theme: "dark" });
  });

  test.each([
    ["longer than the name", "theme-of-someone-else"],
    ["shorter than the name", "them"],
    ["in other capitals", "THEME"],
    ["with a space after it", "theme "],
    ["with an id after it", "theme:44444444-4444-4444-8444-444444444444"],
  ])("a key %s is not the key named", (_shape: string, key: string) => {
    fill({ [key]: "dark" });

    LocalStorage.clearExcept(["theme"]);

    expect(everything()).toEqual({});
  });

  test.each([
    "length",
    "key",
    "getItem",
    "setItem",
    "removeItem",
    "clear",
    "__proto__",
    "constructor",
    "toString",
    "",
  ])("a key named %j goes, whatever else that name means", (key: string) => {
    fill({ [key]: "private", theme: "dark" });

    LocalStorage.clearExcept(["theme"]);

    expect(everything()).toEqual({ theme: "dark" });
  });
});

describe("what stays", () => {
  test.each([
    ["a word", "dark"],
    ["nothing at all", ""],
    ["text that reads as JSON", '{"_type":"Email","value":"ada@example.com"}'],
    ["a number", "007"],
    ["null, as text", "null"],
    ["undefined, as text", "undefined"],
    ["space around it", "  dark\n"],
    ["words of any language", "فارسی 🌙"],
  ])("%s stays exactly as it was written", (_shape: string, value: string) => {
    window.localStorage.setItem("kept", value);

    LocalStorage.clearExcept(["kept"]);

    expect(window.localStorage.getItem("kept")).toBe(value);
  });

  test("a key named but not kept is not made up", () => {
    fill({ token: "secret" });

    LocalStorage.clearExcept(["theme", "language"]);

    expect(window.localStorage.getItem("theme")).toBeNull();
    expect(window.localStorage.length).toBe(0);
  });

  test.each(["length", "key", "clear", "__proto__", ""])(
    "a key named %j stays when it is named",
    (key: string) => {
      fill({ [key]: "kept", token: "secret" });

      LocalStorage.clearExcept([key]);

      expect(everything()).toEqual({ [key]: "kept" });
    },
  );
});

describe("how", () => {
  test("nothing is cleared and written back: a key that stays is not touched", () => {
    fill({ theme: "dark", language: "de", token: "secret", user: "ada" });

    const clear: jest.SpiedFunction<Storage["clear"]> = jest.spyOn(
      Storage.prototype,
      "clear",
    );
    const setItem: jest.SpiedFunction<Storage["setItem"]> = jest.spyOn(
      Storage.prototype,
      "setItem",
    );
    const getItem: jest.SpiedFunction<Storage["getItem"]> = jest.spyOn(
      Storage.prototype,
      "getItem",
    );
    const removeItem: jest.SpiedFunction<Storage["removeItem"]> = jest.spyOn(
      Storage.prototype,
      "removeItem",
    );

    LocalStorage.clearExcept(["theme", "language"]);

    expect(clear).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
    expect(
      removeItem.mock.calls
        .map((call: [key: string]): string => {
          return call[0];
        })
        .sort(),
    ).toEqual(["token", "user"]);
  });

  test("the list it is handed is left as it was", () => {
    const keysToKeep: ReadonlyArray<string> = Object.freeze(["theme"]);

    fill({ theme: "dark", token: "secret" });

    expect(() => {
      LocalStorage.clearExcept(keysToKeep);
    }).not.toThrow();
    expect(keysToKeep).toEqual(["theme"]);
  });
});

describe("whatever the browser holds", () => {
  /*
   * Names of every shape a browser can hold, kept in a generated part of them.
   * What is left is exactly what was named, whatever the order they went in.
   */
  const NAME_PIECES: ReadonlyArray<string> = [
    "a",
    "theme",
    "-",
    ":",
    ".",
    " ",
    "é",
    "ف",
    "🌙",
    "%",
    "\\",
    '"',
    "__",
    "0",
    "11111111-1111-4111-8111-111111111111",
  ];

  test("exactly what was named is left", () => {
    const random: SeededRandom = seededRandom(5404);
    const names: Array<string> = generatedTexts(2000, 5404, NAME_PIECES, 6);

    for (let run: number = 0; run < 300; run++) {
      window.localStorage.clear();

      const inBrowser: Array<string> = [];

      for (let index: number = 0; index < 1 + random(24); index++) {
        inBrowser.push(names[random(names.length)]!);
      }

      const named: Array<string> = shuffled(inBrowser, random).slice(
        0,
        random(inBrowser.length + 1),
      );

      // Named but not there: nothing to keep, and nothing to invent.
      const namedAndAbsent: string = `absent-${run}`;

      for (const name of inBrowser) {
        window.localStorage.setItem(name, `value of ${name}`);
      }

      LocalStorage.clearExcept([...named, namedAndAbsent]);

      expect(everything()).toEqual(
        Object.fromEntries(
          named.map((name: string): [string, string] => {
            return [name, `value of ${name}`];
          }),
        ),
      );
    }
  });
});
