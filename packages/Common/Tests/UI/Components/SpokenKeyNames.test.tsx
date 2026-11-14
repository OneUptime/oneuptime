import "@testing-library/jest-dom";
import { cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import ts from "typescript";
import KeyboardShortcut from "../../../UI/Components/KeyboardShortcut/KeyboardShortcut";
import KeyboardKey, {
  ENGLISH_SPOKEN_KEY_NAMES,
  KeyboardKeyUtil,
  SpokenKeyNames,
} from "../../../UI/Components/KeyboardShortcut/KeyboardKey";
import useSpokenKeyNames from "../../../UI/Components/KeyboardShortcut/SpokenKeyNames";
import HeaderIconDropdownButton from "../../../UI/Components/Header/HeaderIconDropdownButton";
import IconProp from "../../../Types/Icon/IconProp";

/*
 * A SHORTCUT'S KEYS, SAID IN THE READER'S LANGUAGE (#7484).
 *
 * A shortcut is drawn as keycaps (Ctrl, ⌘, Esc, ↑), the same in every
 * language, and said in words: the screen-reader label beside the keycaps
 * and a header button's tooltip. The words were English in every language
 * ("Справка · Control + /"). They are the reader's own now, from the
 * keyboardKeys entries of the front end's locale (useSpokenKeyNames), and
 * English where a front end has none.
 *
 * This pins how each named key finds its word (a marked word per key, so a
 * key reading another key's word fails), that the keycaps are drawn as
 * before, and that a lookup with no wording of its own reads English.
 */

const KEY_PATHS: Record<keyof SpokenKeyNames, string> = {
  command: "command",
  control: "control",
  option: "option",
  altKey: "alt",
  shift: "shift",
  enter: "enter",
  escape: "escape",
  backspace: "backspace",
  delete: "delete",
  tab: "tab",
  space: "space",
  arrowUp: "arrowUp",
  arrowDown: "arrowDown",
  arrowLeft: "arrowLeft",
  arrowRight: "arrowRight",
  windows: "windows",
};

const FIELDS: Array<keyof SpokenKeyNames> = Object.keys(KEY_PATHS) as Array<
  keyof SpokenKeyNames
>;

// Every key's word marked with its own field: "<shift>".
const MARKED: SpokenKeyNames = FIELDS.reduce(
  (names: Partial<SpokenKeyNames>, field: keyof SpokenKeyNames) => {
    names[field] = `<${field}>`;
    return names;
  },
  {},
) as SpokenKeyNames;

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(language: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
}

async function instanceFor(
  language: string,
  locale: Record<string, unknown>,
): Promise<i18n> {
  const instance: i18n = createInstance();

  await instance.init({
    lng: language,
    fallbackLng: language === "en" ? false : "en",
    resources:
      language === "en"
        ? { en: { translation: locale } }
        : {
            en: { translation: readLocale("en") },
            [language]: { translation: locale },
          },
    interpolation: { escapeValue: false },
  });

  return instance;
}

function namesIn(instance: i18n): SpokenKeyNames {
  return renderHook(
    () => {
      return useSpokenKeyNames();
    },
    {
      wrapper: ({ children }: { children: React.ReactNode }): ReactElement => {
        return <I18nextProvider i18n={instance}>{children}</I18nextProvider>;
      },
    },
  ).result.current;
}

type SetPlatformFunction = (platform: string) => void;

const setPlatform: SetPlatformFunction = (platform: string): void => {
  Object.defineProperty(window.navigator, "platform", {
    value: platform,
    configurable: true,
  });
  Object.defineProperty(window.navigator, "userAgent", {
    value: "",
    configurable: true,
  });
  Object.defineProperty(window.navigator, "maxTouchPoints", {
    value: 0,
    configurable: true,
  });
  Object.defineProperty(window.navigator, "userAgentData", {
    value: undefined,
    configurable: true,
  });
};

afterEach(() => {
  cleanup();
  setPlatform("");
});

describe("each named key's word (KeyboardKeyUtil.getSpokenKey)", () => {
  const BOTH: Array<[KeyboardKey, keyof SpokenKeyNames]> = [
    [KeyboardKey.Control, "control"],
    [KeyboardKey.Shift, "shift"],
    [KeyboardKey.Enter, "enter"],
    [KeyboardKey.Escape, "escape"],
    [KeyboardKey.Backspace, "backspace"],
    [KeyboardKey.Delete, "delete"],
    [KeyboardKey.Tab, "tab"],
    [KeyboardKey.Space, "space"],
    [KeyboardKey.ArrowUp, "arrowUp"],
    [KeyboardKey.ArrowDown, "arrowDown"],
    [KeyboardKey.ArrowLeft, "arrowLeft"],
    [KeyboardKey.ArrowRight, "arrowRight"],
  ];

  test.each(BOTH)(
    "%s reads its own word on every platform",
    (key: KeyboardKey, field: keyof SpokenKeyNames) => {
      expect(KeyboardKeyUtil.getSpokenKey(key, true, MARKED)).toBe(
        `<${field}>`,
      );
      expect(KeyboardKeyUtil.getSpokenKey(key, false, MARKED)).toBe(
        `<${field}>`,
      );
    },
  );

  test("the platform's modifiers read the platform's word", () => {
    expect(KeyboardKeyUtil.getSpokenKey(KeyboardKey.Mod, true, MARKED)).toBe(
      "<command>",
    );
    expect(KeyboardKeyUtil.getSpokenKey(KeyboardKey.Mod, false, MARKED)).toBe(
      "<control>",
    );
    expect(KeyboardKeyUtil.getSpokenKey(KeyboardKey.Meta, true, MARKED)).toBe(
      "<command>",
    );
    expect(KeyboardKeyUtil.getSpokenKey(KeyboardKey.Meta, false, MARKED)).toBe(
      "<windows>",
    );
    expect(KeyboardKeyUtil.getSpokenKey(KeyboardKey.Alt, true, MARKED)).toBe(
      "<option>",
    );
    expect(KeyboardKeyUtil.getSpokenKey(KeyboardKey.Alt, false, MARKED)).toBe(
      "<altKey>",
    );
  });

  test("a letter, a digit or a sign is said as drawn, in any language", () => {
    expect(KeyboardKeyUtil.getSpokenKey("k", false, MARKED)).toBe("K");
    expect(KeyboardKeyUtil.getSpokenKey("7", true, MARKED)).toBe("7");
    expect(KeyboardKeyUtil.getSpokenKey("/", false, MARKED)).toBe("/");
    expect(KeyboardKeyUtil.getSpokenKey("F5", false, MARKED)).toBe("F5");
  });

  test("every word is used: each named key reads a word of its own", () => {
    const said: Set<string> = new Set<string>();

    for (const key of Object.values(KeyboardKey)) {
      said.add(KeyboardKeyUtil.getSpokenKey(key, true, MARKED));
      said.add(KeyboardKeyUtil.getSpokenKey(key, false, MARKED));
    }

    expect(Array.from(said).sort()).toEqual(
      FIELDS.map((field: keyof SpokenKeyNames): string => {
        return `<${field}>`;
      }).sort(),
    );
  });

  test("without words of its own, a shortcut is said in English, as before", () => {
    expect(
      KeyboardKeyUtil.getShortcutLabel(
        [KeyboardKey.Mod, KeyboardKey.Shift, "k"],
        true,
      ),
    ).toBe("Command + Shift + K");
    expect(
      KeyboardKeyUtil.getShortcutLabel(
        [KeyboardKey.Mod, KeyboardKey.Shift, "k"],
        false,
      ),
    ).toBe("Control + Shift + K");
    expect(
      KeyboardKeyUtil.getShortcutLabel(
        [KeyboardKey.Alt, KeyboardKey.ArrowUp],
        false,
      ),
    ).toBe("Alt + Up arrow");
  });

  test("with the reader's words, the whole shortcut is said in them", () => {
    const german: SpokenKeyNames = {
      ...ENGLISH_SPOKEN_KEY_NAMES,
      control: "Strg",
      shift: "Umschalt",
      arrowUp: "Pfeil nach oben",
    };

    expect(
      KeyboardKeyUtil.getShortcutLabel(
        [KeyboardKey.Mod, KeyboardKey.Shift, "k"],
        false,
        german,
      ),
    ).toBe("Strg + Umschalt + K");
    expect(
      KeyboardKeyUtil.getShortcutLabel(
        [KeyboardKey.Alt, KeyboardKey.ArrowUp],
        false,
        german,
      ),
    ).toBe("Alt + Pfeil nach oben");
  });
});

describe("the reader's words (useSpokenKeyNames)", () => {
  test("each word is read from its own keyboardKeys entry", async () => {
    const keyboardKeys: Record<string, string> = {};

    for (const field of FIELDS) {
      keyboardKeys[KEY_PATHS[field]] = `<${field}>`;
    }

    const names: SpokenKeyNames = namesIn(
      await instanceFor("xx", { keyboardKeys: keyboardKeys }),
    );

    expect(names).toEqual(MARKED);
  });

  test("the English locale's words are the English the helpers default to", async () => {
    expect(namesIn(await instanceFor("en", readLocale("en")))).toEqual(
      ENGLISH_SPOKEN_KEY_NAMES,
    );
  });

  test("German's words are German's", async () => {
    const names: SpokenKeyNames = namesIn(
      await instanceFor("de", readLocale("de")),
    );

    expect(names.control).toBe("Strg");
    expect(names.shift).toBe("Umschalt");
    expect(names.escape).toBe("Esc");
    expect(names.arrowUp).toBe("Pfeil nach oben");
    expect(names.command).toBe("Befehlstaste");
  });

  test("a front end with no keyboardKeys reads English", async () => {
    const instance: i18n = createInstance();
    await instance.init({
      lng: "fr",
      resources: { fr: { translation: { Search: "Rechercher" } } },
    });

    expect(namesIn(instance)).toEqual(ENGLISH_SPOKEN_KEY_NAMES);
  });

  test("a word left empty, or answered with its own key, reads English", async () => {
    const names: SpokenKeyNames = namesIn(
      await instanceFor("xx", {
        keyboardKeys: {
          shift: "",
          tab: "   ",
          enter: "keyboardKeys.enter",
          space: "Mellanslag",
        },
      }),
    );

    expect(names.shift).toBe("Shift");
    expect(names.tab).toBe("Tab");
    expect(names.enter).toBe("Enter");
    expect(names.space).toBe("Mellanslag");
  });

  test("with no i18next at all (a page with no locale), English", () => {
    expect(
      renderHook(() => {
        return useSpokenKeyNames();
      }).result.current,
    ).toEqual(ENGLISH_SPOKEN_KEY_NAMES);
  });
});

describe("a shortcut drawn in German", () => {
  async function inGerman(children: ReactElement): Promise<void> {
    const instance: i18n = await instanceFor("de", readLocale("de"));
    render(<I18nextProvider i18n={instance}>{children}</I18nextProvider>);
  }

  test("on a PC: keycaps as before, said in German", async () => {
    setPlatform("Win32");

    await inGerman(
      <KeyboardShortcut
        keys={[KeyboardKey.Mod, KeyboardKey.Shift, KeyboardKey.ArrowUp]}
      />,
    );

    expect(
      Array.from(document.querySelectorAll("kbd")).map(
        (keycap: Element): string => {
          return keycap.textContent || "";
        },
      ),
    ).toEqual(["Ctrl", "Shift", "↑"]);
    expect(screen.getByText("Strg + Umschalt + Pfeil nach oben")).toHaveClass(
      "sr-only",
    );
    expect(screen.queryByText(/Control/)).toBeNull();
  });

  test("on a Mac: keycaps as before, said in German", async () => {
    setPlatform("MacIntel");

    await inGerman(
      <KeyboardShortcut keys={[KeyboardKey.Mod, KeyboardKey.Alt, "k"]} />,
    );

    expect(
      Array.from(document.querySelectorAll("kbd")).map(
        (keycap: Element): string => {
          return keycap.textContent || "";
        },
      ),
    ).toEqual(["⌘", "⌥", "K"]);
    expect(screen.getByText("Befehlstaste + Wahltaste + K")).toHaveClass(
      "sr-only",
    );
  });

  test("a header button's tooltip spells its shortcut in German", async () => {
    setPlatform("Win32");

    await inGerman(
      <HeaderIconDropdownButton
        icon={IconProp.Search}
        name="Suchen"
        title="Suchen"
        shortcut={[KeyboardKey.Mod, "K"]}
        showDropdown={false}
        onClick={() => {}}
      />,
    );

    expect(screen.getByTitle("Suchen · Strg + K")).toBeInTheDocument();
    expect(screen.queryByTitle("Suchen · Control + K")).toBeNull();
  });

  test("the same button with no locale behind it says English, as before", () => {
    setPlatform("Win32");

    render(
      <HeaderIconDropdownButton
        icon={IconProp.Search}
        name="Search"
        title="Search"
        shortcut={[KeyboardKey.Mod, "K"]}
        showDropdown={false}
        onClick={() => {}}
      />,
    );

    expect(screen.getByTitle("Search · Control + K")).toBeInTheDocument();
  });
});

/*
 * Every place that says a shortcut in words hands the helpers the reader's
 * names: a call that leaves them out says the keys in English on every
 * page, as both callers did before #7484.
 */
const SAYING_METHODS: ReadonlyArray<string> = [
  "getShortcutLabel",
  "getSpokenKey",
];

// Where the helpers say a key on their own behalf, with names handed in.
const HELPERS_FILE: string = path.join(
  "Common",
  "UI",
  "Components",
  "KeyboardShortcut",
  "KeyboardKey.ts",
);

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");

const SCANNED_FOLDERS: ReadonlyArray<string> = [
  path.join(PACKAGES_DIR, "Common", "UI"),
  path.join(PACKAGES_DIR, "App", "FeatureSet"),
];

const SOURCE_FILE_NAME: RegExp = /\.tsx?$/u;

// Each call of a saying method that hands no names, as "file:line".
function callsWithoutNames(fileName: string, text: string): Array<string> {
  const source: ts.SourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: Array<string> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      SAYING_METHODS.includes(node.expression.name.text) &&
      node.arguments.length < 3
    ) {
      const line: number =
        source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      found.push(`${fileName}:${line}`);
    }
    ts.forEachChild(node, visit);
  };

  visit(source);

  return found;
}

function sourceFiles(folder: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const full: string = path.join(folder, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "build") {
        files.push(...sourceFiles(full));
      }
    } else if (
      SOURCE_FILE_NAME.test(entry.name) &&
      !entry.name.endsWith(".d.ts")
    ) {
      files.push(full);
    }
  }

  return files;
}

describe("every place a shortcut is said in words", () => {
  test("hands the reader's names (useSpokenKeyNames)", () => {
    const callers: Array<string> = [];
    const unnamed: Array<string> = [];

    for (const folder of SCANNED_FOLDERS) {
      for (const file of sourceFiles(folder)) {
        const relative: string = path.relative(PACKAGES_DIR, file);
        const text: string = fs.readFileSync(file, "utf8");

        if (
          relative === HELPERS_FILE ||
          !SAYING_METHODS.some((method: string): boolean => {
            return text.includes(method);
          })
        ) {
          continue;
        }

        callers.push(relative);
        unnamed.push(...callsWithoutNames(relative, text));
      }
    }

    // The keycaps' screen-reader label and a header button's tooltip.
    expect(callers.sort()).toEqual([
      path.join(
        "Common",
        "UI",
        "Components",
        "Header",
        "HeaderIconDropdownButton.tsx",
      ),
      path.join(
        "Common",
        "UI",
        "Components",
        "KeyboardShortcut",
        "KeyboardShortcut.tsx",
      ),
    ]);
    expect(unnamed).toEqual([]);
  });

  test("negative control: a call that hands no names is found", () => {
    expect(
      callsWithoutNames(
        "Example.tsx",
        [
          "const a = KeyboardKeyUtil.getShortcutLabel(keys, isApple);",
          "const b = KeyboardKeyUtil.getShortcutLabel(keys, isApple, names);",
          "const c = KeyboardKeyUtil.getSpokenKey(key);",
        ].join("\n"),
      ),
    ).toEqual(["Example.tsx:1", "Example.tsx:3"]);
  });
});
