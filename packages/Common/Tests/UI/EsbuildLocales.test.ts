import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import childProcess from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import {
  createRuntimeLocalesPlugin,
  getMarkedLocale,
  getPluralOneFormKeys,
  getRuntimeLocale,
  getSameAsEnglishMarks,
  isLocaleTree,
  RUNTIME_LOCALES_PLUGIN_NAME,
  RuntimeLocalesPluginOptions,
  RuntimeLocaleTree,
  SAME_AS_ENGLISH_MARK,
  usesPluralOneForm,
  withoutFallbackEntries,
  withoutIdentityEntries,
} from "../../UI/esbuild-locales";
import {
  DEFAULT_DASHBOARD_LANGUAGE,
  SUPPORTED_DASHBOARD_LANGUAGE_CODES,
} from "../../Types/Dashboard/DashboardLanguage";
import { SAME_AS_ENGLISH_MARK as LOOKUP_SAME_AS_ENGLISH_MARK } from "../../Types/Translator";
import { readDashboardSameAsEnglish } from "../Helpers/DashboardLocales";
import {
  ADMIN_DASHBOARD_CODES,
  ADMIN_DASHBOARD_DIRECTORY,
  ADMIN_DASHBOARD_ENGLISH,
  ADMIN_DASHBOARD_LOCALES_DIRECTORY,
  readAdminDashboardSameAsEnglish,
} from "../Helpers/AdminDashboardLocales";

/*
 * What the Dashboard bundles of its locale files (UI/esbuild-locales.js).
 *
 * src/Locales/en.json holds every Dashboard string, nearly all of them
 * "text": "text", and is in the entry chunk; every other locale is a lazy
 * chunk with an English placeholder for each string it has not translated.
 * The plugin ships en.json without the entries that map to themselves and
 * every other locale without the strings equal to the English, since the
 * lookup renders the same English without them (Tests/App/Dashboard/
 * DashboardRuntimeLocales proves that against i18next). A plural's English
 * "_one" form ships with the languages that read one form, not with en.json:
 * the code hands English readers that sentence itself. One a language words
 * as English does on purpose, by its same-as-English lists, ships with a
 * mark the lookup reads as the language's own wording.
 *
 * The transforms run here in-process. The plugin runs in a node SUBPROCESS,
 * the way the build loads it: esbuild refuses to load under Common's jsdom
 * test environment (see EsbuildConfig.test.ts). The builds use the real
 * createConfig and load the output as ES modules, the way a browser does,
 * and the last block builds the real locale files with the Dashboard's own
 * esbuild.config.js.
 */

const UI_DIR: string = path.resolve(__dirname, "..", "..", "UI");
const ESBUILD_CONFIG: string = path.join(UI_DIR, "esbuild-config.js");
const ESBUILD_LOCALES: string = path.join(UI_DIR, "esbuild-locales.js");
const PACKAGES_DIR: string = path.resolve(__dirname, "..", "..", "..");
const DASHBOARD_DIR: string = path.join(
  PACKAGES_DIR,
  "App",
  "FeatureSet",
  "Dashboard",
);
const DASHBOARD_LOCALES: string = path.join(DASHBOARD_DIR, "src", "Locales");

// A build in a child process, and loading what it wrote, takes a while.
const BUILD_TIMEOUT_MS: number = 5 * 60 * 1000;

const LAZY_CODES: Array<string> = SUPPORTED_DASHBOARD_LANGUAGE_CODES.filter(
  (code: string): boolean => {
    return code !== DEFAULT_DASHBOARD_LANGUAGE;
  },
);

const temporaryRoots: Array<string> = [];

afterAll(() => {
  while (temporaryRoots.length > 0) {
    fs.rmSync(temporaryRoots.pop() as string, {
      recursive: true,
      force: true,
    });
  }
});

function makeTempDir(prefix: string): string {
  // realpath: macOS-style /tmp symlinks must not make paths compare unequal.
  const root: string = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), prefix)),
  );
  temporaryRoots.push(root);
  return root;
}

function writeFile(filePath: string, contents: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function writeJson(filePath: string, value: unknown): void {
  writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

type ChildEnvironment = Record<string, string>;

function childEnvironment(
  overrides: Record<string, string | null>,
): ChildEnvironment {
  const environment: ChildEnvironment = {};

  for (const key of Object.keys(process.env)) {
    const value: string | undefined = process.env[key];

    if (typeof value === "string") {
      environment[key] = value;
    }
  }

  for (const key of [
    "ONEUPTIME_EDITION",
    "ONEUPTIME_EE_DIR",
    "NODE_ENV",
    "analyze",
  ]) {
    delete environment[key];
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) {
      delete environment[key];
    } else {
      environment[key] = value;
    }
  }

  return environment;
}

// The child prints one JSON line last; anything a config logs comes before.
function runNode(data: {
  script: string;
  cwd: string;
  env?: Record<string, string | null>;
  preload?: string;
}): unknown {
  const output: string = childProcess
    .execFileSync(
      process.execPath,
      [...(data.preload ? ["-r", data.preload] : []), "-e", data.script],
      {
        cwd: data.cwd,
        encoding: "utf8",
        env: childEnvironment(data.env || {}),
        maxBuffer: 256 * 1024 * 1024,
      },
    )
    .trim();
  const lines: Array<string> = output.split("\n");

  return JSON.parse(lines[lines.length - 1] as string);
}

// Deep-frozen, so a transform that writes to its input throws.
function frozen<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      frozen(child);
    }

    Object.freeze(value);
  }

  return value;
}

// The paths at which two trees differ, for a readable failure.
function treeDifferences(
  actual: unknown,
  expected: unknown,
  prefix: string = "",
): Array<string> {
  if (!isLocaleTree(actual) || !isLocaleTree(expected)) {
    return actual === expected
      ? []
      : [`${prefix || "(root)"}: ${JSON.stringify(actual)}`];
  }

  const differences: Array<string> = [];
  const actualKeys: Array<string> = Object.keys(actual);
  const expectedKeys: Array<string> = Object.keys(expected);

  for (const key of expectedKeys) {
    const childPath: string = prefix ? `${prefix} › ${key}` : key;

    if (!Object.prototype.hasOwnProperty.call(actual, key)) {
      differences.push(`${childPath}: missing`);
    } else {
      differences.push(
        ...treeDifferences(actual[key], expected[key], childPath),
      );
    }
  }

  for (const key of actualKeys) {
    if (!Object.prototype.hasOwnProperty.call(expected, key)) {
      differences.push(`${prefix ? `${prefix} › ` : ""}${key}: unexpected`);
    }
  }

  if (
    differences.length === 0 &&
    actualKeys.join("\u0000") !== expectedKeys.join("\u0000")
  ) {
    differences.push(`${prefix || "(root)"}: keys out of order`);
  }

  return differences;
}

describe("withoutIdentityEntries: what en.json ships", () => {
  test("drops every flat entry whose value is its own key", () => {
    const english: RuntimeLocaleTree = frozen({
      Save: "Save",
      "Loading...": "Loading...",
      "Note: this cannot be undone.": "Note: this cannot be undone.",
      "Delete {{itemName}}": "Delete {{itemName}}",
      "{{count}} monitors": "{{count}} monitors",
      μs: "μs",
      "← Back": "← Back",
      "📢 Announcement Updated: {{announcementTitle}}":
        "📢 Announcement Updated: {{announcementTitle}}",
    });

    expect(withoutIdentityEntries(english)).toEqual({});
  });

  test("keeps nested objects whole, a leaf that reads like its key included", () => {
    /*
     * t("common.save") answers a missing entry with "common.save", not with
     * the text, so nothing under a nested key may go.
     */
    const english: RuntimeLocaleTree = frozen({
      common: { save: "Save", Cancel: "Cancel" },
      navbar: { items: { formsTitle: "Forms", Forms: "Forms" } },
      Save: "Save",
    });

    expect(withoutIdentityEntries(english)).toEqual({
      common: { save: "Save", Cancel: "Cancel" },
      navbar: { items: { formsTitle: "Forms", Forms: "Forms" } },
    });
  });

  test("keeps plural _one forms and every value that differs from its key", () => {
    const english: RuntimeLocaleTree = frozen({
      "{{count}} monitors": "{{count}} monitors",
      "{{count}} monitors_one": "{{count}} monitor",
      "{{count}} {{itemsName}} Selected": "{{count}} {{itemsName}} Selected",
      "{{count}} {{itemsName}} Selected_one": "{{count}} {{itemName}} Selected",
      legacyTitle: "Legacy title",
      "Save ": "Save",
      save: "Save",
    });

    expect(withoutIdentityEntries(english)).toEqual({
      "{{count}} monitors_one": "{{count}} monitor",
      "{{count}} {{itemsName}} Selected_one": "{{count}} {{itemName}} Selected",
      legacyTitle: "Legacy title",
      "Save ": "Save",
      save: "Save",
    });
  });

  test("keeps every {{placeholder}} and the order of what it keeps", () => {
    const english: RuntimeLocaleTree = frozen({
      zeta: "Zeta {{value}}",
      Save: "Save",
      "{{field}} is between {{start}} and {{end}}_one":
        "{{field}} is between {{start}} and {{end}}",
      alpha: { "{{count}} rows": "{{count}} rows" },
    });

    const shipped: RuntimeLocaleTree = withoutIdentityEntries(english);

    expect(Object.keys(shipped)).toEqual([
      "zeta",
      "{{field}} is between {{start}} and {{end}}_one",
      "alpha",
    ]);
    expect(shipped["zeta"]).toBe("Zeta {{value}}");
    expect(shipped["{{field}} is between {{start}} and {{end}}_one"]).toBe(
      "{{field}} is between {{start}} and {{end}}",
    );
    expect(shipped["alpha"]).toEqual({ "{{count}} rows": "{{count}} rows" });
  });

  test("leaves its input as it was and returns a new object", () => {
    const english: RuntimeLocaleTree = frozen({
      Save: "Save",
      common: { save: "Save" },
    });

    const shipped: RuntimeLocaleTree = withoutIdentityEntries(english);

    expect(shipped).not.toBe(english);
    expect(english).toEqual({ Save: "Save", common: { save: "Save" } });
  });

  test("an empty file ships empty", () => {
    expect(withoutIdentityEntries({})).toEqual({});
  });
});

describe("withoutFallbackEntries: what every other locale ships", () => {
  const english: RuntimeLocaleTree = frozen({
    common: { save: "Save", cancel: "Cancel" },
    navbar: { items: { formsTitle: "Forms", homeTitle: "Home" } },
    Save: "Save",
    Status: "Status",
    "Delete {{itemName}}": "Delete {{itemName}}",
    "{{count}} monitors": "{{count}} monitors",
    "{{count}} monitors_one": "{{count}} monitor",
  });

  test("drops the English placeholders and keeps the translations", () => {
    const german: RuntimeLocaleTree = frozen({
      common: { save: "Speichern", cancel: "Cancel" },
      navbar: { items: { formsTitle: "Forms", homeTitle: "Home" } },
      Save: "Speichern",
      Status: "Status",
      "Delete {{itemName}}": "Delete {{itemName}}",
      "{{count}} monitors": "{{count}} Monitore",
      "{{count}} monitors_one": "{{count}} Monitor",
    });

    expect(withoutFallbackEntries(german, english)).toEqual({
      common: { save: "Speichern" },
      Save: "Speichern",
      "{{count}} monitors": "{{count}} Monitore",
      "{{count}} monitors_one": "{{count}} Monitor",
    });
  });

  test("a _one form still in English goes, as a translated one stays", () => {
    // Japanese has no "one" form: its _one keys keep the English sentence.
    const japanese: RuntimeLocaleTree = frozen({
      "{{count}} monitors": "{{count}} 件のモニター",
      "{{count}} monitors_one": "{{count}} monitor",
    });

    expect(withoutFallbackEntries(japanese, english)).toEqual({
      "{{count}} monitors": "{{count}} 件のモニター",
    });
  });

  test("a value equal to its key but not to the English stays", () => {
    // "_one" holds a sentence of its own; its key is not its English.
    const odd: RuntimeLocaleTree = frozen({
      "{{count}} monitors_one": "{{count}} monitors_one",
    });

    expect(withoutFallbackEntries(odd, english)).toEqual({
      "{{count}} monitors_one": "{{count}} monitors_one",
    });
  });

  test("drops a nested object once every leaf in it is English", () => {
    const partly: RuntimeLocaleTree = frozen({
      common: { save: "Save", cancel: "Cancel" },
      navbar: { items: { formsTitle: "Formulare", homeTitle: "Home" } },
    });

    expect(withoutFallbackEntries(partly, english)).toEqual({
      navbar: { items: { formsTitle: "Formulare" } },
    });
  });

  test("keeps what the fallback lacks, or has in another shape", () => {
    const other: RuntimeLocaleTree = frozen({
      "Only here": "Nur hier",
      Save: { nested: "Save" },
      common: "Save",
      navbar: { items: { newTitle: "Neu" } },
    });

    expect(withoutFallbackEntries(other, english)).toEqual({
      "Only here": "Nur hier",
      Save: { nested: "Save" },
      common: "Save",
      navbar: { items: { newTitle: "Neu" } },
    });
  });

  test("compares exactly: case, spaces and Unicode form all count", () => {
    const close: RuntimeLocaleTree = frozen({
      Save: "save",
      Status: "Status ",
      "Delete {{itemName}}": "Delete {{ itemName }}",
      common: { save: "Savé", cancel: "Cancel" },
    });
    const fallback: RuntimeLocaleTree = frozen({
      ...english,
      common: { save: "Savé", cancel: "Cancel" },
    });

    expect(withoutFallbackEntries(close, fallback)).toEqual({
      Save: "save",
      Status: "Status ",
      "Delete {{itemName}}": "Delete {{ itemName }}",
      common: { save: "Savé" },
    });
  });

  test("keeps every {{placeholder}} of a translation where the locale put it", () => {
    const german: RuntimeLocaleTree = frozen({
      "Delete {{itemName}}": "{{itemName}} löschen",
      "{{count}} monitors": "Monitore: {{count}}",
    });

    expect(withoutFallbackEntries(german, english)).toEqual({
      "Delete {{itemName}}": "{{itemName}} löschen",
      "{{count}} monitors": "Monitore: {{count}}",
    });
  });

  test("leaves both inputs as they were", () => {
    const german: RuntimeLocaleTree = frozen({
      common: { save: "Speichern", cancel: "Cancel" },
      Save: "Save",
    });

    withoutFallbackEntries(german, english);

    expect(german).toEqual({
      common: { save: "Speichern", cancel: "Cancel" },
      Save: "Save",
    });
    expect(english["Save"]).toBe("Save");
  });

  test("without a fallback, every string stays and only empty objects go", () => {
    expect(
      withoutFallbackEntries(
        frozen({ Save: "Save", empty: {}, common: { save: "Save" } }),
        undefined,
      ),
    ).toEqual({ Save: "Save", common: { save: "Save" } });
  });
});

describe("getRuntimeLocale", () => {
  const english: RuntimeLocaleTree = frozen({
    Save: "Save",
    "{{count}} rows_one": "{{count}} row",
  });

  test("ships the fallback language without its identity entries", () => {
    expect(
      getRuntimeLocale({
        language: "en",
        fallbackLanguage: "en",
        locale: english,
      }),
    ).toEqual({ "{{count}} rows_one": "{{count}} row" });
  });

  test("ships another language without what the fallback reads the same", () => {
    expect(
      getRuntimeLocale({
        language: "de",
        fallbackLanguage: "en",
        locale: frozen({
          Save: "Speichern",
          "{{count}} rows_one": "{{count}} row",
        }),
        fallback: english,
      }),
    ).toEqual({ Save: "Speichern" });
  });

  /*
   * A plural's "one" form ("<key>_one" beside "<key>"). The code hands it to
   * the lookup itself, so a reader of the fallback never needs the entry; a
   * language with a "one" form reads its own, or falls back to it.
   */
  const plurals: RuntimeLocaleTree = frozen({
    "{{count}} rows": "{{count}} rows",
    "{{count}} rows_one": "{{count}} row",
    "{{count}} items": "{{count}} items",
    "{{count}} items_one": "{{count}} item",
    "{{count}} hosts": "{{count}} hosts",
    "{{count}} hosts_one": "{{count}} host",
    legacyTitle: "Legacy Title",
  });

  test("ships the fallback language without its plural _one forms", () => {
    expect(
      getRuntimeLocale({
        language: "en",
        fallbackLanguage: "en",
        locale: plurals,
      }),
    ).toEqual({ legacyTitle: "Legacy Title" });
  });

  test("ships every _one form a language with a one form reads, translated or still English", () => {
    const shipped: RuntimeLocaleTree = getRuntimeLocale({
      language: "de",
      fallbackLanguage: "en",
      locale: frozen({
        "{{count}} rows": "{{count}} Zeilen",
        "{{count}} rows_one": "{{count}} row",
        "{{count}} items": "{{count}} items",
        "{{count}} items_one": "{{count}} Element",
        legacyTitle: "Legacy Title",
      }),
      fallback: plurals,
    });

    // The locale's order first, then a "_one" form it lacks, in English.
    expect(shipped).toEqual({
      "{{count}} rows": "{{count}} Zeilen",
      "{{count}} rows_one": "{{count}} row",
      "{{count}} items_one": "{{count}} Element",
      "{{count}} hosts_one": "{{count}} host",
    });
    expect(Object.keys(shipped)).toEqual([
      "{{count}} rows",
      "{{count}} rows_one",
      "{{count}} items_one",
      "{{count}} hosts_one",
    ]);
  });

  test("ships a language without a one form only the _one forms it translated", () => {
    // Japanese reads its general form for every count, 1 included.
    expect(
      getRuntimeLocale({
        language: "ja",
        fallbackLanguage: "en",
        locale: frozen({
          "{{count}} rows": "{{count}} 行",
          "{{count}} rows_one": "{{count}} row",
          "{{count}} items_one": "{{count}} 件",
        }),
        fallback: plurals,
      }),
    ).toEqual({
      "{{count}} rows": "{{count}} 行",
      "{{count}} items_one": "{{count}} 件",
    });
  });

  test("knows a _one form by the key beside it, and a language by its plural rules", () => {
    expect(
      getPluralOneFormKeys(
        frozen({
          "{{count}} rows": "{{count}} rows",
          "{{count}} rows_one": "{{count}} row",
          Only_one: "Only one",
          common: { "{{count}} rows_one": "{{count}} row" },
          "{{count}} items": { nested: "x" },
          "{{count}} items_one": "{{count}} item",
        }),
      ),
    ).toEqual(["{{count}} rows_one"]);

    for (const code of ["en", "de", "fr", "es", "ru", "hi", "fa", "no"]) {
      expect([code, usesPluralOneForm(code)]).toEqual([code, true]);
    }

    for (const code of ["ja", "ko", "zh-CN", "zh-TW"]) {
      expect([code, usesPluralOneForm(code)]).toEqual([code, false]);
    }
  });

  test("refuses to ship another language without the fallback to compare with", () => {
    expect(() => {
      return getRuntimeLocale({
        language: "de",
        fallbackLanguage: "en",
        locale: { Save: "Speichern" },
      });
    }).toThrow("the en locale is needed to ship de");
  });

  test("refuses a locale that is not a JSON object", () => {
    expect(() => {
      return getRuntimeLocale({
        language: "de",
        fallbackLanguage: "en",
        locale: ["Save"] as unknown as RuntimeLocaleTree,
        fallback: english,
      });
    }).toThrow("the de locale is not a JSON object");
  });
});

/*
 * A "_one" form a language words exactly as English does, on purpose -
 * French "{{count}} signal" beside its "{{count}} signaux" - reads like an
 * English placeholder, and the lookup reads a placeholder as English: French
 * at 0, which it counts as one, read "0 signals" (#7788). The language's
 * same-as-English list says the form is its own, so the form ships with a
 * mark the lookup reads: its key plus SAME_AS_ENGLISH_MARK, holding the same
 * text (Types/Translator's isEnglishPlaceholder).
 */
describe("the mark of a _one form a language words as English does", () => {
  const english: RuntimeLocaleTree = frozen({
    "{{count}} signals": "{{count}} signals",
    "{{count}} signals_one": "{{count}} signal",
    "{{count}} rows": "{{count}} rows",
    "{{count}} rows_one": "{{count}} row",
    "{{count}} hosts": "{{count}} hosts",
    "{{count}} hosts_one": "{{count}} host",
    Status: "Status",
  });
  const french: RuntimeLocaleTree = frozen({
    "{{count}} signals": "{{count}} signaux",
    "{{count}} signals_one": "{{count}} signal",
    "{{count}} rows": "{{count}} lignes",
    "{{count}} rows_one": "{{count}} row",
    "{{count}} hosts": "{{count}} hôtes",
    "{{count}} hosts_one": "{{count}} hôte",
    Status: "Status",
  });
  /*
   * French's list: the one form it keeps as English's, a one form's English
   * it has translated after all, and a text that is no one form.
   */
  const frenchList: Array<string> = frozen([
    "{{count}} signal",
    "{{count}} host",
    "Status",
  ]);

  test("is the suffix the lookup reads", () => {
    expect(SAME_AS_ENGLISH_MARK).toBe("_sameAsEnglish");
    expect(SAME_AS_ENGLISH_MARK).toBe(LOOKUP_SAME_AS_ENGLISH_MARK);
  });

  test("marks each _one form that reads as the fallback's and is on the list, and nothing else", () => {
    expect(
      getSameAsEnglishMarks({
        language: "fr",
        locale: french,
        fallback: english,
        sameAsEnglish: frenchList,
      }),
    ).toEqual({ "{{count}} signals_one_sameAsEnglish": "{{count}} signal" });
  });

  test("marks nothing without a list, or for a language that reads no one form", () => {
    for (const sameAsEnglish of [undefined, []]) {
      expect(
        getSameAsEnglishMarks({
          language: "fr",
          locale: french,
          fallback: english,
          sameAsEnglish: sameAsEnglish,
        }),
      ).toEqual({});
    }

    // Japanese reads its general form at every count.
    expect(
      getSameAsEnglishMarks({
        language: "ja",
        locale: french,
        fallback: english,
        sameAsEnglish: frenchList,
      }),
    ).toEqual({});
  });

  test("ships the mark right after its form, and a form off the list unmarked", () => {
    const shipped: RuntimeLocaleTree = getRuntimeLocale({
      language: "fr",
      fallbackLanguage: "en",
      locale: french,
      fallback: english,
      sameAsEnglish: frenchList,
    });

    expect(Object.keys(shipped)).toEqual([
      "{{count}} signals",
      "{{count}} signals_one",
      "{{count}} signals_one_sameAsEnglish",
      "{{count}} rows",
      "{{count}} rows_one",
      "{{count}} hosts",
      "{{count}} hosts_one",
    ]);
    expect(shipped["{{count}} signals_one_sameAsEnglish"]).toBe(
      "{{count}} signal",
    );
    // "{{count}} row" is English left in the locale: no mark.
    expect(shipped["{{count}} rows_one"]).toBe("{{count}} row");
  });

  test("the fallback language ships none", () => {
    expect(
      getRuntimeLocale({
        language: "en",
        fallbackLanguage: "en",
        locale: english,
        sameAsEnglish: frenchList,
      }),
    ).toEqual({});
  });
});

/*
 * A frontend that bundles every locale whole (the Admin Dashboard) ships
 * each as its file holds it: the build only adds the marks, each right
 * after its form (#8068).
 */
describe("getMarkedLocale: a locale shipped whole, with its marks", () => {
  const english: RuntimeLocaleTree = frozen({
    common: { save: "Save" },
    Save: "Save",
    "{{count}} monitors": "{{count}} monitors",
    "{{count}} monitors_one": "{{count}} monitor",
    "{{count}} people": "{{count}} people",
    "{{count}} people_one": "{{count}} person",
    "{{count}} rows": "{{count}} rows",
    "{{count}} rows_one": "{{count}} row",
  });
  const portuguese: RuntimeLocaleTree = frozen({
    common: { save: "Save" },
    Save: "Salvar",
    "{{count}} monitors": "{{count}} monitores",
    "{{count}} monitors_one": "{{count}} monitor",
    "{{count}} people": "{{count}} pessoas",
    "{{count}} people_one": "{{count}} pessoa",
    "{{count}} rows": "{{count}} linhas",
    "{{count}} rows_one": "{{count}} row",
  });
  /*
   * Portuguese's list: the one form it keeps as English's, a one form it
   * has translated after all, and a text that is no one form.
   */
  const portugueseList: Array<string> = frozen([
    "{{count}} monitor",
    "{{count}} person",
    "Save",
  ]);

  test("ships every entry of the file, in its order, and the mark right after its form", () => {
    const shipped: RuntimeLocaleTree = getMarkedLocale({
      language: "pt",
      fallbackLanguage: "en",
      locale: portuguese,
      fallback: english,
      sameAsEnglish: portugueseList,
    });

    expect(Object.keys(shipped)).toEqual([
      "common",
      "Save",
      "{{count}} monitors",
      "{{count}} monitors_one",
      "{{count}} monitors_one_sameAsEnglish",
      "{{count}} people",
      "{{count}} people_one",
      "{{count}} rows",
      "{{count}} rows_one",
    ]);
    expect(shipped).toEqual({
      ...portuguese,
      "{{count}} monitors_one_sameAsEnglish": "{{count}} monitor",
    });
  });

  // What the trimmed copy drops, the whole one keeps: nested and English alike.
  test("keeps what getRuntimeLocale() would drop", () => {
    const shipped: RuntimeLocaleTree = getMarkedLocale({
      language: "pt",
      fallbackLanguage: "en",
      locale: portuguese,
      fallback: english,
    });

    expect(shipped).toEqual(portuguese);
    expect(
      getRuntimeLocale({
        language: "pt",
        fallbackLanguage: "en",
        locale: portuguese,
        fallback: english,
      })["common"],
    ).toBeUndefined();
    expect(shipped["common"]).toEqual({ save: "Save" });
  });

  test("the fallback language ships as its file holds it, its _one forms and identity entries too", () => {
    const shipped: RuntimeLocaleTree = getMarkedLocale({
      language: "en",
      fallbackLanguage: "en",
      locale: english,
      sameAsEnglish: portugueseList,
    });

    expect(shipped).toEqual(english);
    expect(shipped).not.toBe(english);
    expect(Object.keys(shipped)).toEqual(Object.keys(english));
  });

  test("marks nothing without a list, or for a language that reads no one form", () => {
    for (const sameAsEnglish of [undefined, []]) {
      expect(
        getMarkedLocale({
          language: "pt",
          fallbackLanguage: "en",
          locale: portuguese,
          fallback: english,
          sameAsEnglish: sameAsEnglish,
        }),
      ).toEqual(portuguese);
    }

    // Japanese reads its general form at every count.
    expect(
      getMarkedLocale({
        language: "ja",
        fallbackLanguage: "en",
        locale: portuguese,
        fallback: english,
        sameAsEnglish: portugueseList,
      }),
    ).toEqual(portuguese);
  });

  test("marks the same forms the trimmed copy marks", () => {
    const whole: RuntimeLocaleTree = getMarkedLocale({
      language: "pt",
      fallbackLanguage: "en",
      locale: portuguese,
      fallback: english,
      sameAsEnglish: portugueseList,
    });
    const trimmed: RuntimeLocaleTree = getRuntimeLocale({
      language: "pt",
      fallbackLanguage: "en",
      locale: portuguese,
      fallback: english,
      sameAsEnglish: portugueseList,
    });
    const marksOf: (tree: RuntimeLocaleTree) => Array<string> = (
      tree: RuntimeLocaleTree,
    ): Array<string> => {
      return Object.keys(tree).filter((key: string): boolean => {
        return key.endsWith(SAME_AS_ENGLISH_MARK);
      });
    };

    expect(marksOf(whole)).toEqual(["{{count}} monitors_one_sameAsEnglish"]);
    expect(marksOf(whole)).toEqual(marksOf(trimmed));
  });

  test("refuses to mark another language without the fallback, or a locale that is not a JSON object", () => {
    expect(() => {
      return getMarkedLocale({
        language: "pt",
        fallbackLanguage: "en",
        locale: portuguese,
      });
    }).toThrow("getMarkedLocale: the en locale is needed to mark pt.");

    for (const locale of [null, [], "pt"]) {
      expect(() => {
        return getMarkedLocale({
          language: "pt",
          fallbackLanguage: "en",
          locale: locale as unknown as RuntimeLocaleTree,
          fallback: english,
        });
      }).toThrow("getMarkedLocale: the pt locale is not a JSON object.");
    }
  });
});

describe("createRuntimeLocalesPlugin", () => {
  test("is an esbuild plugin named for what it does", () => {
    const plugin: { name: string; setup: unknown } = createRuntimeLocalesPlugin(
      {
        localesDirectory: DASHBOARD_LOCALES,
        fallbackLanguage: "en",
      },
    );

    expect(plugin.name).toBe(RUNTIME_LOCALES_PLUGIN_NAME);
    expect(typeof plugin.setup).toBe("function");
    // esbuild rejects a plugin object with any other property.
    expect(Object.keys(plugin).sort()).toEqual(["name", "setup"]);
  });

  test.each([
    [{ fallbackLanguage: "en" }, '"localesDirectory" is required'],
    [
      { localesDirectory: " ", fallbackLanguage: "en" },
      '"localesDirectory" is required',
    ],
    [
      { localesDirectory: "src/Locales", fallbackLanguage: "en" },
      '"localesDirectory" must be absolute (got "src/Locales")',
    ],
    [{ localesDirectory: DASHBOARD_LOCALES }, '"fallbackLanguage" is required'],
    [
      { localesDirectory: DASHBOARD_LOCALES, fallbackLanguage: "" },
      '"fallbackLanguage" is required',
    ],
    [
      {
        localesDirectory: DASHBOARD_LOCALES,
        fallbackLanguage: "en",
        sameAsEnglishFile: "i18n/SameAsEnglish.json",
      },
      '"sameAsEnglishFile" must be absolute (got "i18n/SameAsEnglish.json")',
    ],
    [
      {
        localesDirectory: DASHBOARD_LOCALES,
        fallbackLanguage: "en",
        sameAsEnglishFile: " ",
      },
      '"sameAsEnglishFile" must be a path when given',
    ],
    [
      {
        localesDirectory: DASHBOARD_LOCALES,
        fallbackLanguage: "en",
        progressDirectory: "i18n/Progress",
      },
      '"progressDirectory" must be absolute (got "i18n/Progress")',
    ],
    [
      {
        localesDirectory: DASHBOARD_LOCALES,
        fallbackLanguage: "en",
        progressDirectory: 3,
      },
      '"progressDirectory" must be a path when given',
    ],
    [
      {
        localesDirectory: DASHBOARD_LOCALES,
        fallbackLanguage: "en",
        shipsWholeLocales: "yes",
      },
      '"shipsWholeLocales" must be true or false when given',
    ],
    [
      {
        localesDirectory: DASHBOARD_LOCALES,
        fallbackLanguage: "en",
        shipsWholeLocales: 1,
      },
      '"shipsWholeLocales" must be true or false when given',
    ],
  ])("refuses the options %j", (options: unknown, message: string) => {
    expect(() => {
      return createRuntimeLocalesPlugin(options as RuntimeLocalesPluginOptions);
    }).toThrow(message);
  });

  test.each([true, false, undefined])(
    "takes shipsWholeLocales: %s",
    (shipsWholeLocales: boolean | undefined) => {
      expect(
        createRuntimeLocalesPlugin({
          localesDirectory: DASHBOARD_LOCALES,
          fallbackLanguage: "en",
          shipsWholeLocales: shipsWholeLocales,
        }).name,
      ).toBe(RUNTIME_LOCALES_PLUGIN_NAME);
    },
  );
});

/*
 * A fixture laid out like the Dashboard: src/Locales/<code>.json, English
 * imported statically and the rest through a template-literal dynamic import,
 * plus JSON the plugin must leave alone.
 */
const FIXTURE_ENGLISH: RuntimeLocaleTree = {
  common: { save: "Save", Cancel: "Cancel" },
  menu: { title: "Shared Menu Sentinel" },
  Save: "Save",
  "Loading...": "Loading...",
  "Delete {{itemName}}": "Delete {{itemName}}",
  "{{count}} monitors": "{{count}} monitors",
  "{{count}} monitors_one": "{{count}} monitor",
  legacyTitle: "Legacy Title Sentinel",
  IDENTITY_SENTINEL: "IDENTITY_SENTINEL",
};

const FIXTURE_GERMAN: RuntimeLocaleTree = {
  common: { save: "Speichern", Cancel: "Cancel" },
  menu: { title: "Shared Menu Sentinel" },
  Save: "Speichern",
  "Loading...": "Loading...",
  "Delete {{itemName}}": "{{itemName}} löschen",
  "{{count}} monitors": "{{count}} Monitore",
  "{{count}} monitors_one": "{{count}} monitor",
  legacyTitle: "Legacy Title Sentinel",
  IDENTITY_SENTINEL: "IDENTITY_SENTINEL",
};

const FIXTURE_JAPANESE: RuntimeLocaleTree = {
  common: { save: "Save", Cancel: "Cancel" },
  menu: { title: "Shared Menu Sentinel" },
  Save: "保存",
  "Loading...": "Loading...",
  "Delete {{itemName}}": "Delete {{itemName}}",
  "{{count}} monitors": "{{count}} monitors",
  "{{count}} monitors_one": "{{count}} monitor",
  legacyTitle: "Legacy Title Sentinel",
  IDENTITY_SENTINEL: "IDENTITY_SENTINEL",
};

interface Fixture {
  root: string;
  localesDirectory: string;
  entry: string;
  outdir: string;
}

function makeFixture(): Fixture {
  const root: string = makeTempDir("oneuptime-runtime-locales-");
  const src: string = path.join(root, "src");
  const localesDirectory: string = path.join(src, "Locales");

  writeJson(path.join(localesDirectory, "en.json"), FIXTURE_ENGLISH);
  writeJson(path.join(localesDirectory, "de.json"), FIXTURE_GERMAN);
  writeJson(path.join(localesDirectory, "ja.json"), FIXTURE_JAPANESE);
  writeFile(path.join(localesDirectory, "README.md"), "# Not a locale\n");

  // Shaped like a locale, but not in the locales directory.
  writeJson(path.join(src, "Data", "settings.json"), {
    Save: "Save",
    KEEP_SENTINEL: "KEEP_SENTINEL",
  });
  writeJson(path.join(src, "Other", "Locales", "en.json"), {
    Save: "Save",
    OTHER_SENTINEL: "OTHER_SENTINEL",
  });

  writeFile(
    path.join(src, "Utils", "Loader.ts"),
    `
    export const load = async (code: string): Promise<unknown> => {
      const imported: { default?: unknown } = await import(
        \`../Locales/\${code}.json\`
      );
      return imported.default;
    };
    `,
  );

  writeFile(
    path.join(src, "Index.ts"),
    `
    import en from "./Locales/en.json";
    import settings from "./Data/settings.json";
    import otherEnglish from "./Other/Locales/en.json";
    export { load } from "./Utils/Loader";
    export const english: unknown = en;
    export const data: unknown = settings;
    export const other: unknown = otherEnglish;
    `,
  );

  return {
    root,
    localesDirectory,
    entry: path.join(src, "Index.ts"),
    outdir: path.join(root, "out"),
  };
}

// The same-as-English lists a build reads, as the plugin's options name them.
interface FixtureLists {
  sameAsEnglishFile?: string;
  progressDirectory?: string;
}

// The plugin's other options, beside the lists.
interface FixtureOptions extends FixtureLists {
  shipsWholeLocales?: boolean;
}

/*
 * Lists laid out like the Dashboard's i18n directory: one every language
 * shares, and a progress file for each language given.
 */
function writeLists(
  fixture: Fixture,
  lists: {
    global?: Array<string>;
    progress?: Record<string, Array<string>>;
  },
): FixtureLists {
  const written: FixtureLists = {};

  if (lists.global) {
    written.sameAsEnglishFile = path.join(
      fixture.root,
      "i18n",
      "SameAsEnglish.json",
    );
    writeJson(written.sameAsEnglishFile, lists.global);
  }

  if (lists.progress) {
    written.progressDirectory = path.join(fixture.root, "i18n", "Progress");
    fs.mkdirSync(written.progressDirectory, { recursive: true });

    for (const [code, sameAsEnglish] of Object.entries(lists.progress)) {
      writeJson(path.join(written.progressDirectory, `${code}.json`), {
        baseline: { keys: 1, untranslated: 0 },
        sameAsEnglish: sameAsEnglish,
      });
    }
  }

  return written;
}

interface OutputShape {
  file: string;
  // The outputs it imports statically.
  imports: Array<string>;
  // Locale code -> bytes of that file in this output.
  locales: Record<string, number>;
}

interface OutputSummary extends OutputShape {
  text: string;
}

interface FixtureBuild {
  ok: boolean;
  error: string;
  english: unknown;
  lazy: Record<string, unknown>;
  data: unknown;
  other: unknown;
  outputs: Array<OutputSummary>;
}

/*
 * Summarizes a metafile's JS outputs in the child: the src/Locales files
 * each one carries, its static imports and its text.
 */
const SUMMARIZE_OUTPUTS: string = `
  function summarize(metafile, workingDir) {
    return Object.keys(metafile.outputs).filter(function (output) {
      return output.endsWith(".js");
    }).map(function (output) {
      const details = metafile.outputs[output];
      const locales = {};
      for (const input of Object.keys(details.inputs)) {
        const match = /(?:^|\\/)src\\/Locales\\/([^/]+)\\.json$/.exec(input);
        if (match) {
          locales[match[1]] = details.inputs[input].bytesInOutput;
        }
      }
      return {
        file: path.basename(output),
        imports: (details.imports || []).filter(function (item) {
          return item.kind === "import-statement";
        }).map(function (item) {
          return path.basename(item.path);
        }),
        locales: locales,
        text: fs.readFileSync(path.resolve(workingDir, output), "utf8"),
      };
    });
  }
`;

function buildFixture(
  fixture: Fixture,
  env: Record<string, string | null> = { NODE_ENV: "production" },
  lists: FixtureOptions = {},
): FixtureBuild {
  const script: string = `
    const fs = require("fs");
    const path = require("path");
    const url = require("url");
    const { createConfig } = require(${JSON.stringify(ESBUILD_CONFIG)});
    const { createRuntimeLocalesPlugin } = require(${JSON.stringify(ESBUILD_LOCALES)});
    const esbuild = require(require.resolve("esbuild", {
      paths: [${JSON.stringify(UI_DIR)}],
    }));
    ${SUMMARIZE_OUTPUTS}

    (async function () {
      const outdir = ${JSON.stringify(fixture.outdir)};
      const config = createConfig({
        serviceName: "Fixture",
        publicPath: "/fixture/dist/",
        entryPoint: ${JSON.stringify(fixture.entry)},
        outdir: outdir,
        additionalPlugins: [
          createRuntimeLocalesPlugin(Object.assign({
            localesDirectory: ${JSON.stringify(fixture.localesDirectory)},
            fallbackLanguage: "en",
          }, ${JSON.stringify(lists)})),
        ],
      });
      config.metafile = true;
      config.logLevel = "silent";
      // Chunks import each other through publicPath; relative, node finds them.
      delete config.publicPath;

      let result;
      try {
        result = await esbuild.build(config);
      } catch (error) {
        console.log(JSON.stringify({
          ok: false,
          error: String((error && error.message) || error),
        }));
        return;
      }

      // Load the bundle the way a browser would: as ES modules.
      fs.writeFileSync(path.join(outdir, "package.json"), '{"type":"module"}');
      const bundle = await import(url.pathToFileURL(path.join(outdir, "Index.js")).href);
      const lazy = {};
      for (const code of ["de", "ja"]) {
        lazy[code] = await bundle.load(code);
      }

      console.log(JSON.stringify({
        ok: true,
        error: "",
        english: bundle.english,
        lazy: lazy,
        data: bundle.data,
        other: bundle.other,
        outputs: summarize(result.metafile, process.cwd()),
      }));
    })();
  `;

  return runNode({ script, cwd: fixture.root, env }) as FixtureBuild;
}

function outputWithLocale<T extends OutputShape>(
  outputs: Array<T>,
  code: string,
): T {
  const found: Array<T> = outputs.filter((output: T): boolean => {
    return output.locales[code] !== undefined;
  });

  expect([code, found.length]).toEqual([code, 1]);

  return found[0] as T;
}

/*
 * What a page load downloads: the entry output (`entryFile`) and every output
 * it imports statically, transitively. Dynamic imports are not followed -
 * they are what keeps a chunk out of the first load. (In the metafile each
 * lazy chunk is an entry point of its own, so the entry goes by its name.)
 */
function entryClosure<T extends OutputShape>(
  outputs: Array<T>,
  entryFile: string,
): Array<T> {
  const byFile: Map<string, T> = new Map<string, T>(
    outputs.map((output: T): [string, T] => {
      return [output.file, output];
    }),
  );
  const closure: Map<string, T> = new Map<string, T>();
  const visit: (output: T | undefined) => void = (
    output: T | undefined,
  ): void => {
    if (!output || closure.has(output.file)) {
      return;
    }

    closure.set(output.file, output);

    for (const imported of output.imports) {
      visit(byFile.get(imported));
    }
  };

  expect([entryFile, byFile.has(entryFile)]).toEqual([entryFile, true]);
  visit(byFile.get(entryFile));

  return Array.from(closure.values());
}

function localesIn<T extends OutputShape>(outputs: Array<T>): Array<string> {
  return outputs.flatMap((output: T): Array<string> => {
    return Object.keys(output.locales);
  });
}

describe("bundling a fixture for real", () => {
  let production: FixtureBuild;

  beforeAll(() => {
    production = buildFixture(makeFixture());
  }, BUILD_TIMEOUT_MS);

  test("English ships without its identity entries or its _one forms", () => {
    expect([production.ok, production.error]).toEqual([true, ""]);
    expect(production.english).toEqual({
      common: { save: "Save", Cancel: "Cancel" },
      menu: { title: "Shared Menu Sentinel" },
      legacyTitle: "Legacy Title Sentinel",
    });
  });

  test("the lazy chunks ship what differs from the English, and the _one forms they read", () => {
    // German reads a "one" form, here still the English sentence.
    expect(production.lazy["de"]).toEqual({
      common: { save: "Speichern" },
      Save: "Speichern",
      "Delete {{itemName}}": "{{itemName}} löschen",
      "{{count}} monitors": "{{count}} Monitore",
      "{{count}} monitors_one": "{{count}} monitor",
    });
    // Japanese has no "one" form.
    expect(production.lazy["ja"]).toEqual({ Save: "保存" });
  });

  test("what it drops is nowhere in the bundle", () => {
    const text: string = production.outputs
      .map((output: OutputSummary): string => {
        return output.text;
      })
      .join("\n");

    expect(text).not.toContain("IDENTITY_SENTINEL");

    for (const code of ["de", "ja"]) {
      const chunk: string = outputWithLocale(production.outputs, code).text;

      expect([code, chunk.includes("Shared Menu Sentinel")]).toEqual([
        code,
        false,
      ]);
      expect([code, chunk.includes("Legacy Title Sentinel")]).toEqual([
        code,
        false,
      ]);
    }

    // A "_one" form is in German's chunk only: not what every load downloads.
    const entryText: string = entryClosure(production.outputs, "Index.js")
      .map((output: OutputSummary): string => {
        return output.text;
      })
      .join("\n");

    expect(entryText).not.toContain("{{count}} monitors_one");
    expect(
      ["de", "ja"].map((code: string): [string, boolean] => {
        return [
          code,
          outputWithLocale(production.outputs, code).text.includes(
            "{{count}} monitors_one",
          ),
        ];
      }),
    ).toEqual([
      ["de", true],
      ["ja", false],
    ]);
  });

  test("other JSON, a Locales directory elsewhere included, is left to esbuild", () => {
    expect(production.data).toEqual({
      Save: "Save",
      KEEP_SENTINEL: "KEEP_SENTINEL",
    });
    expect(production.other).toEqual({
      Save: "Save",
      OTHER_SENTINEL: "OTHER_SENTINEL",
    });
  });

  test("English is in the entry bundle and every other locale in a chunk of its own", () => {
    const closure: Array<OutputSummary> = entryClosure(
      production.outputs,
      "Index.js",
    );

    expect(localesIn(closure)).toEqual(["en"]);

    for (const code of ["de", "ja"]) {
      const chunk: OutputSummary = outputWithLocale(production.outputs, code);

      expect([code, closure.includes(chunk)]).toEqual([code, false]);
      expect([code, Object.keys(chunk.locales)]).toEqual([code, [code]]);
    }
  });

  test(
    "a development build ships the same",
    () => {
      const development: FixtureBuild = buildFixture(makeFixture(), {});

      expect([development.ok, development.error]).toEqual([true, ""]);
      expect(development.english).toEqual(production.english);
      expect(development.lazy).toEqual(production.lazy);
    },
    BUILD_TIMEOUT_MS,
  );

  test(
    "a locale that is not JSON fails the build and names the file",
    () => {
      const fixture: Fixture = makeFixture();
      const germanPath: string = path.join(fixture.localesDirectory, "de.json");

      writeFile(
        germanPath,
        '{\n<<<<<<< HEAD\n  "Save": "Speichern"\n=======\n  "Save": "Sichern"\n>>>>>>> other\n}\n',
      );

      const result: FixtureBuild = buildFixture(fixture);

      expect(result.ok).toBe(false);
      expect(result.error).toContain(RUNTIME_LOCALES_PLUGIN_NAME);
      expect(result.error).toContain(`${germanPath} is not valid JSON`);
    },
    BUILD_TIMEOUT_MS,
  );

  test(
    "a locale that is not a JSON object fails the build",
    () => {
      const fixture: Fixture = makeFixture();

      writeFile(path.join(fixture.localesDirectory, "ja.json"), '["Save"]\n');

      const result: FixtureBuild = buildFixture(fixture);

      expect(result.ok).toBe(false);
      expect(result.error).toContain("must hold a JSON object of translations");
    },
    BUILD_TIMEOUT_MS,
  );

  test(
    "a broken English file fails the build of the other locales too",
    () => {
      const fixture: Fixture = makeFixture();

      writeFile(path.join(fixture.localesDirectory, "en.json"), "{ nope\n");

      const result: FixtureBuild = buildFixture(fixture);

      expect(result.ok).toBe(false);
      expect(result.error).toContain(
        `${path.join(fixture.localesDirectory, "en.json")} is not valid JSON`,
      );
    },
    BUILD_TIMEOUT_MS,
  );

  test(
    "a locales directory that is not there fails the build",
    () => {
      const fixture: Fixture = makeFixture();

      fs.rmSync(fixture.localesDirectory, { recursive: true, force: true });

      const result: FixtureBuild = buildFixture(fixture);

      expect(result.ok).toBe(false);
      expect(result.error).toContain("ENOENT");
    },
    BUILD_TIMEOUT_MS,
  );

  /*
   * German's "{{count}} monitor" here is English left in the file unless a
   * list says German words it so: then it ships with its mark, and the
   * lookup reads it as German's own (#7788).
   */
  test(
    "a _one form on its language's list ships with its mark, in that language's chunk only",
    () => {
      const fixture: Fixture = makeFixture();
      const lists: FixtureLists = writeLists(fixture, {
        global: ["Loading..."],
        progress: {
          de: ["{{count}} monitor"],
          ja: ["{{count}} monitor"],
        },
      });
      const result: FixtureBuild = buildFixture(
        fixture,
        { NODE_ENV: "production" },
        lists,
      );

      expect([result.ok, result.error]).toEqual([true, ""]);
      expect(result.lazy["de"]).toEqual({
        ...(production.lazy["de"] as RuntimeLocaleTree),
        "{{count}} monitors_one_sameAsEnglish": "{{count}} monitor",
      });
      // Japanese reads no one form.
      expect(result.lazy["ja"]).toEqual(production.lazy["ja"]);
      expect(result.english).toEqual(production.english);

      const entryText: string = entryClosure(result.outputs, "Index.js")
        .map((output: OutputSummary): string => {
          return output.text;
        })
        .join("\n");

      expect(entryText).not.toContain(SAME_AS_ENGLISH_MARK);
    },
    BUILD_TIMEOUT_MS,
  );

  // German has no progress file of its own here: the shared list is its list.
  test(
    "the list every language shares marks a form too",
    () => {
      const fixture: Fixture = makeFixture();
      const result: FixtureBuild = buildFixture(
        fixture,
        { NODE_ENV: "production" },
        writeLists(fixture, {
          global: ["{{count}} monitor"],
          progress: { ja: [] },
        }),
      );

      expect([result.ok, result.error]).toEqual([true, ""]);
      expect(result.lazy["de"]).toEqual({
        ...(production.lazy["de"] as RuntimeLocaleTree),
        "{{count}} monitors_one_sameAsEnglish": "{{count}} monitor",
      });
      expect(result.lazy["ja"]).toEqual(production.lazy["ja"]);
    },
    BUILD_TIMEOUT_MS,
  );

  /*
   * Without its lists every form a language words as English does would
   * ship unmarked, and read as English: a list the build names must be
   * there, and readable.
   */
  test(
    "a list that is not there fails the build",
    () => {
      const fixture: Fixture = makeFixture();
      const result: FixtureBuild = buildFixture(
        fixture,
        { NODE_ENV: "production" },
        {
          sameAsEnglishFile: path.join(fixture.root, "i18n", "Missing.json"),
        },
      );

      expect(result.ok).toBe(false);
      expect(result.error).toContain("ENOENT");
    },
    BUILD_TIMEOUT_MS,
  );

  test(
    "a list that is not a JSON array, or a progress file that is not JSON, fails the build and names the file",
    () => {
      const notAnArray: Fixture = makeFixture();
      const lists: FixtureLists = writeLists(notAnArray, { global: [] });

      writeJson(lists.sameAsEnglishFile as string, {
        de: ["{{count}} monitor"],
      });

      const notAnArrayResult: FixtureBuild = buildFixture(
        notAnArray,
        { NODE_ENV: "production" },
        lists,
      );

      expect(notAnArrayResult.ok).toBe(false);
      expect(notAnArrayResult.error).toContain(
        `${lists.sameAsEnglishFile} must hold a JSON array of strings`,
      );

      const notJson: Fixture = makeFixture();
      const progress: FixtureLists = writeLists(notJson, {
        progress: { de: [] },
      });
      const germanProgress: string = path.join(
        progress.progressDirectory as string,
        "de.json",
      );

      writeFile(germanProgress, "{ nope\n");

      const notJsonResult: FixtureBuild = buildFixture(
        notJson,
        { NODE_ENV: "production" },
        progress,
      );

      expect(notJsonResult.ok).toBe(false);
      expect(notJsonResult.error).toContain(
        `${germanProgress} is not valid JSON`,
      );
    },
    BUILD_TIMEOUT_MS,
  );

  /*
   * A frontend that bundles its locales whole (the Admin Dashboard): each
   * ships as its file holds it - English with its identity entries and its
   * _one forms - and a listed one form with its mark right after it
   * (#8068).
   */
  test(
    "with shipsWholeLocales every locale ships as its file holds it, and a listed _one form with its mark",
    () => {
      const fixture: Fixture = makeFixture();
      const lists: FixtureLists = writeLists(fixture, {
        progress: {
          de: ["{{count}} monitor"],
          ja: ["{{count}} monitor"],
        },
      });
      const result: FixtureBuild = buildFixture(
        fixture,
        { NODE_ENV: "production" },
        { ...lists, shipsWholeLocales: true },
      );
      const germanMarked: RuntimeLocaleTree = {};

      for (const key of Object.keys(FIXTURE_GERMAN)) {
        germanMarked[key] = FIXTURE_GERMAN[key] as string | RuntimeLocaleTree;

        if (key === "{{count}} monitors_one") {
          germanMarked[`${key}${SAME_AS_ENGLISH_MARK}`] = "{{count}} monitor";
        }
      }

      expect([result.ok, result.error]).toEqual([true, ""]);
      expect(treeDifferences(result.english, FIXTURE_ENGLISH)).toEqual([]);
      expect(treeDifferences(result.lazy["de"], germanMarked)).toEqual([]);
      // Japanese reads no one form: no mark, and nothing dropped either.
      expect(treeDifferences(result.lazy["ja"], FIXTURE_JAPANESE)).toEqual([]);
      expect(result.data).toEqual(production.data);
      expect(result.other).toEqual(production.other);

      // What the trimmed copies drop is in the bundle; the mark is not in the entry.
      const entryText: string = entryClosure(result.outputs, "Index.js")
        .map((output: OutputSummary): string => {
          return output.text;
        })
        .join("\n");

      expect(entryText).toContain("IDENTITY_SENTINEL");
      expect(entryText).toContain("{{count}} monitors_one");
      expect(entryText).not.toContain(SAME_AS_ENGLISH_MARK);
      expect(outputWithLocale(result.outputs, "de").text).toContain(
        `{{count}} monitors_one${SAME_AS_ENGLISH_MARK}`,
      );
    },
    BUILD_TIMEOUT_MS,
  );

  test(
    "with shipsWholeLocales and no lists, every locale ships exactly as its file holds it",
    () => {
      const result: FixtureBuild = buildFixture(
        makeFixture(),
        { NODE_ENV: "production" },
        { shipsWholeLocales: true },
      );

      expect([result.ok, result.error]).toEqual([true, ""]);
      expect(treeDifferences(result.english, FIXTURE_ENGLISH)).toEqual([]);
      expect(treeDifferences(result.lazy["de"], FIXTURE_GERMAN)).toEqual([]);
      expect(treeDifferences(result.lazy["ja"], FIXTURE_JAPANESE)).toEqual([]);
    },
    BUILD_TIMEOUT_MS,
  );
});

describe("rebuilding in watch mode", () => {
  interface Rebuilds {
    ok: boolean;
    error: string;
    germanChunks: Array<string>;
  }

  /*
   * One esbuild context rebuilt three times: as is, unchanged, and after
   * `change` rewrote a file.
   */
  function rebuild(
    fixture: Fixture,
    change: { file: string; value: unknown },
    lists: FixtureLists = {},
  ): Rebuilds {
    const script: string = `
      const fs = require("fs");
      const path = require("path");
      const { createConfig } = require(${JSON.stringify(ESBUILD_CONFIG)});
      const { createRuntimeLocalesPlugin } = require(${JSON.stringify(ESBUILD_LOCALES)});
      const esbuild = require(require.resolve("esbuild", {
        paths: [${JSON.stringify(UI_DIR)}],
      }));
      ${SUMMARIZE_OUTPUTS}

      function germanChunk(result) {
        return summarize(result.metafile, process.cwd()).filter(function (output) {
          return output.locales.de !== undefined;
        })[0].text;
      }

      (async function () {
        const config = createConfig({
          serviceName: "Fixture",
          publicPath: "/fixture/dist/",
          entryPoint: ${JSON.stringify(fixture.entry)},
          outdir: ${JSON.stringify(fixture.outdir)},
          additionalPlugins: [
            createRuntimeLocalesPlugin(Object.assign({
              localesDirectory: ${JSON.stringify(fixture.localesDirectory)},
              fallbackLanguage: "en",
            }, ${JSON.stringify(lists)})),
          ],
        });
        config.metafile = true;
        config.logLevel = "silent";
        delete config.publicPath;

        const context = await esbuild.context(config);
        const germanChunks = [];
        try {
          germanChunks.push(germanChunk(await context.rebuild()));
          germanChunks.push(germanChunk(await context.rebuild()));
          fs.writeFileSync(
            ${JSON.stringify(change.file)},
            ${JSON.stringify(JSON.stringify(change.value, null, 2))},
          );
          germanChunks.push(germanChunk(await context.rebuild()));
        } catch (error) {
          console.log(JSON.stringify({ ok: false, error: String(error), germanChunks: [] }));
          return;
        } finally {
          await context.dispose();
        }

        console.log(JSON.stringify({ ok: true, error: "", germanChunks: germanChunks }));
      })();
    `;

    return runNode({
      script,
      cwd: fixture.root,
      env: { NODE_ENV: "production" },
    }) as Rebuilds;
  }

  /*
   * en.json's menu title changes: the German placeholder then no longer
   * reads the same as the English, so it must ship.
   */
  test(
    "an unchanged rebuild ships the same, and a changed fallback re-ships the locales",
    () => {
      const fixture: Fixture = makeFixture();
      const result: Rebuilds = rebuild(fixture, {
        file: path.join(fixture.localesDirectory, "en.json"),
        value: { ...FIXTURE_ENGLISH, menu: { title: "English Menu Title" } },
      });

      expect([result.ok, result.error]).toEqual([true, ""]);
      expect(result.germanChunks).toHaveLength(3);

      const [first, unchanged, afterChange] = result.germanChunks as [
        string,
        string,
        string,
      ];

      expect(first).not.toContain("Shared Menu Sentinel");
      expect(unchanged).toBe(first);
      expect(afterChange).toContain("Shared Menu Sentinel");
      expect(afterChange).toContain("Speichern");
    },
    BUILD_TIMEOUT_MS,
  );

  // German's list comes to name its "{{count}} monitor": it ships its mark.
  test(
    "a changed list re-ships the locale it marks",
    () => {
      const fixture: Fixture = makeFixture();
      const lists: FixtureLists = writeLists(fixture, {
        global: ["Loading..."],
        progress: { de: [] },
      });
      const result: Rebuilds = rebuild(
        fixture,
        {
          file: path.join(lists.progressDirectory as string, "de.json"),
          value: {
            baseline: { keys: 1, untranslated: 0 },
            sameAsEnglish: ["{{count}} monitor"],
          },
        },
        lists,
      );

      expect([result.ok, result.error]).toEqual([true, ""]);

      const [first, unchanged, afterChange] = result.germanChunks as [
        string,
        string,
        string,
      ];

      expect(first).not.toContain(SAME_AS_ENGLISH_MARK);
      expect(unchanged).toBe(first);
      expect(afterChange).toContain(
        `{{count}} monitors_one${SAME_AS_ENGLISH_MARK}`,
      );
      expect(afterChange).toContain("Speichern");
    },
    BUILD_TIMEOUT_MS,
  );
});

describe("the Dashboard's own build", () => {
  interface DashboardOutput extends OutputShape {
    bytes: number;
  }

  interface DashboardBuild {
    plugins: Array<string>;
    outputs: Array<DashboardOutput>;
  }

  /*
   * en.json's share of the entry bundle. It ships its nested keys only -
   * about 10 KB, against 1.8 MB for the whole file - and not its plural
   * "_one" forms, which ship with the languages that read them: there is
   * one for every count-dependent sentence routed through translation (52 KB
   * of them when they moved out), so in the entry they would outgrow any
   * budget. A build that ships the identity entries, or the "_one" forms,
   * again lands far above this.
   */
  const ENGLISH_ENTRY_BUDGET_BYTES: number = 32 * 1024;

  // What esbuild names the output of an entry point read from stdin.
  const STDIN_ENTRY: string = "stdin.js";

  let built: DashboardBuild;
  let runtime: Record<string, RuntimeLocaleTree> = {};

  const readSourceLocale: (code: string) => RuntimeLocaleTree = (
    code: string,
  ): RuntimeLocaleTree => {
    return JSON.parse(
      fs.readFileSync(path.join(DASHBOARD_LOCALES, `${code}.json`), "utf8"),
    ) as RuntimeLocaleTree;
  };

  /*
   * Runs the shipped esbuild.config.js with build() swapped for a probe
   * (preloaded into the same module instance, as EsbuildEnterpriseAlias does),
   * then builds the real locale files with the config it produced: English
   * imported the way Utils/i18n.ts does, every other locale through the real
   * Utils/I18nLocaleLoader. NODE_PATH lets "Common/..." resolve where the
   * Dashboard is not installed (the Common Test CI job installs Common alone).
   */
  beforeAll(() => {
    const probeDir: string = makeTempDir("oneuptime-dashboard-locales-");
    const preload: string = path.join(probeDir, "probe.js");
    const outdir: string = path.join(probeDir, "out");
    const runtimePath: string = path.join(probeDir, "runtime.json");

    writeFile(
      preload,
      `
      const config = require(${JSON.stringify(ESBUILD_CONFIG)});
      globalThis.__dashboardBuilds = [];
      config.build = function (built) {
        globalThis.__dashboardBuilds.push(built);
      };
      config.watch = config.build;
      `,
    );

    const entry: string = `
      import en from "../Locales/en.json";
      export { loadLocaleResource } from "./I18nLocaleLoader";
      export const english: unknown = en;
    `;

    const script: string = `
      require(${JSON.stringify(path.join(DASHBOARD_DIR, "esbuild.config.js"))});
      const fs = require("fs");
      const path = require("path");
      const url = require("url");
      const esbuild = require(require.resolve("esbuild", {
        paths: [${JSON.stringify(UI_DIR)}],
      }));
      ${SUMMARIZE_OUTPUTS}

      (async function () {
        const config = globalThis.__dashboardBuilds[0];
        const outdir = ${JSON.stringify(outdir)};
        const build = Object.assign({}, config, {
          stdin: {
            contents: ${JSON.stringify(entry)},
            resolveDir: ${JSON.stringify(path.join(DASHBOARD_DIR, "src", "Utils"))},
            sourcefile: "LocaleProbe.ts",
            loader: "ts",
          },
          // The real Common, since the Dashboard may not be installed.
          alias: Object.assign({}, config.alias, {
            Common: ${JSON.stringify(path.join(PACKAGES_DIR, "Common"))},
          }),
          outdir: outdir,
          metafile: true,
          logLevel: "silent",
        });
        delete build.entryPoints;
        // Chunks import each other through publicPath; relative, node finds them.
        delete build.publicPath;

        const result = await esbuild.build(build);
        fs.writeFileSync(path.join(outdir, "package.json"), '{"type":"module"}');
        const bundle = await import(url.pathToFileURL(path.join(outdir, "stdin.js")).href);

        const runtime = { en: bundle.english };
        for (const code of ${JSON.stringify(LAZY_CODES)}) {
          runtime[code] = await bundle.loadLocaleResource(code);
        }
        fs.writeFileSync(${JSON.stringify(runtimePath)}, JSON.stringify(runtime));

        console.log(JSON.stringify({
          plugins: config.plugins.map(function (plugin) { return plugin.name; }),
          outputs: summarize(result.metafile, process.cwd()).map(function (output) {
            const bytes = Buffer.byteLength(output.text);
            delete output.text;
            output.bytes = bytes;
            return output;
          }),
        }));
      })().catch(function (error) {
        console.error(error);
        process.exit(1);
      });
    `;

    built = runNode({
      script,
      cwd: DASHBOARD_DIR,
      env: {
        NODE_ENV: "production",
        ONEUPTIME_EDITION: "community",
        NODE_PATH: PACKAGES_DIR,
      },
      preload,
    }) as DashboardBuild;

    runtime = JSON.parse(fs.readFileSync(runtimePath, "utf8")) as Record<
      string,
      RuntimeLocaleTree
    >;
  }, BUILD_TIMEOUT_MS);

  test("the config the Dashboard builds with carries the plugin", () => {
    expect(built.plugins).toContain(RUNTIME_LOCALES_PLUGIN_NAME);
  });

  test("English ships exactly what getRuntimeLocale() keeps of en.json", () => {
    const english: RuntimeLocaleTree = readSourceLocale(
      DEFAULT_DASHBOARD_LANGUAGE,
    );
    const shipped: RuntimeLocaleTree = runtime[
      DEFAULT_DASHBOARD_LANGUAGE
    ] as RuntimeLocaleTree;

    expect(
      treeDifferences(
        shipped,
        getRuntimeLocale({
          language: DEFAULT_DASHBOARD_LANGUAGE,
          fallbackLanguage: DEFAULT_DASHBOARD_LANGUAGE,
          locale: english,
        }),
      ),
    ).toEqual([]);
    // The nested keys components read with t("a.b") are all there.
    expect(Object.keys(shipped || {})).toEqual(
      expect.arrayContaining(["navbar", "commandPalette", "eventItem"]),
    );
    // And none of the plural "_one" forms, of which en.json has hundreds.
    expect(getPluralOneFormKeys(english).length).toBeGreaterThan(100);
    expect(
      getPluralOneFormKeys(english).filter((key: string): boolean => {
        return Object.prototype.hasOwnProperty.call(shipped, key);
      }),
    ).toEqual([]);
  });

  test.each(LAZY_CODES)(
    "%s ships its translations, and every _one form it reads",
    (code: string) => {
      const english: RuntimeLocaleTree = readSourceLocale(
        DEFAULT_DASHBOARD_LANGUAGE,
      );
      const locale: RuntimeLocaleTree = readSourceLocale(code);
      const shipped: RuntimeLocaleTree = runtime[code] as RuntimeLocaleTree;
      const expected: RuntimeLocaleTree = getRuntimeLocale({
        language: code,
        fallbackLanguage: DEFAULT_DASHBOARD_LANGUAGE,
        locale: locale,
        fallback: english,
        // The lists i18n/SameAsEnglish.json and i18n/Progress/<code>.json hold.
        sameAsEnglish: readDashboardSameAsEnglish(code),
      });

      expect(treeDifferences(shipped, expected)).toEqual([]);
      expect(Object.keys(expected).length).toBeGreaterThan(0);

      /*
       * A language with a "one" form ships every "_one" form, its own or the
       * English the full files would fall back to. One without ships no
       * English placeholder, as for any other string.
       */
      const misshipped: Array<string> = getPluralOneFormKeys(english).filter(
        (key: string): boolean => {
          return usesPluralOneForm(code)
            ? shipped[key] !==
                (typeof locale[key] === "string" ? locale[key] : english[key])
            : shipped[key] === english[key];
        },
      );

      expect([code, misshipped]).toEqual([code, []]);
    },
  );

  /*
   * #7788's forms: French "{{count}} signal", Portuguese "{{count}}
   * monitor", Russian "{{count}} CPU" - each its language's own, on its
   * list - ship with their marks. A form worded apart from English since
   * (French "{{count}} flux") needs none, and English ships none.
   */
  test("the _one forms a language words as English does ship with their marks", () => {
    const markOf: (key: string) => string = (key: string): string => {
      return `${key}_one${SAME_AS_ENGLISH_MARK}`;
    };

    expect(runtime["fr"]?.[markOf("{{count}} signals")]).toBe(
      "{{count}} signal",
    );
    expect(runtime["pt"]?.[markOf("{{count}} monitors")]).toBe(
      "{{count}} monitor",
    );
    expect(runtime["ru"]?.[markOf("{{count}} CPUs")]).toBe("{{count}} CPU");
    expect(runtime["fr"]?.["{{count}} flows_one"]).toBe("{{count}} flux");
    expect(runtime["fr"]?.[markOf("{{count}} flows")]).toBeUndefined();

    const marked: (code: string) => Array<string> = (
      code: string,
    ): Array<string> => {
      return Object.keys(runtime[code] || {}).filter((key: string): boolean => {
        return key.endsWith(SAME_AS_ENGLISH_MARK);
      });
    };

    expect(marked("fr").length).toBeGreaterThan(10);
    expect(marked(DEFAULT_DASHBOARD_LANGUAGE)).toEqual([]);
    expect(marked("ja")).toEqual([]);
  });

  test("en.json's share of the entry bundle stays within its budget", () => {
    const englishBytes: number = entryClosure(
      built.outputs,
      STDIN_ENTRY,
    ).reduce((total: number, output: DashboardOutput): number => {
      return total + (output.locales[DEFAULT_DASHBOARD_LANGUAGE] || 0);
    }, 0);
    const sourceBytes: number = fs.statSync(
      path.join(DASHBOARD_LOCALES, `${DEFAULT_DASHBOARD_LANGUAGE}.json`),
    ).size;

    expect(englishBytes).toBeGreaterThan(0);
    expect(englishBytes).toBeLessThanOrEqual(ENGLISH_ENTRY_BUDGET_BYTES);
    expect(englishBytes).toBeLessThan(sourceBytes / 50);
  });

  test("no other locale is in the entry bundle, and each is a chunk of its own", () => {
    const closure: Array<DashboardOutput> = entryClosure(
      built.outputs,
      STDIN_ENTRY,
    );

    expect(localesIn(closure)).toEqual([DEFAULT_DASHBOARD_LANGUAGE]);

    for (const code of LAZY_CODES) {
      const chunk: DashboardOutput = outputWithLocale(built.outputs, code);

      expect([code, Object.keys(chunk.locales)]).toEqual([code, [code]]);
      expect([code, closure.includes(chunk)]).toEqual([code, false]);
    }
  });
});

/*
 * The Admin Dashboard's build (#8068, #8146). Its Utils/i18n.ts bundled all
 * eighteen locales whole, about 4.2 MB of the entry chunk. It loads them as
 * the Dashboard does now: English in the entry chunk, without its identity
 * entries and its plural "_one" forms; every other language a chunk of its
 * own, behind Utils/I18nLocaleLoader's dynamic import, without the strings
 * English reads the same - and with a mark beside each "_one" form its
 * language's same-as-English list names (AdminDashboard/i18n/Progress/
 * <code>.json): Portuguese "{{count}} monitor", which it reads at 0 as well
 * as at 1.
 */
describe("the Admin Dashboard's own build", () => {
  interface AdminOutput extends OutputShape {
    bytes: number;
  }

  interface AdminBuild {
    plugins: Array<string>;
    outputs: Array<AdminOutput>;
  }

  /*
   * en.json's share of the entry bundle: its nested keys - the Admin's
   * pages read most of their words as t("pages...."), about 34 KB of them -
   * and the few texts it words apart from their key. The whole file is about
   * 280 KB, and all eighteen came to about 4.2 MB of the entry chunk.
   */
  const ENGLISH_ENTRY_BUDGET_BYTES: number = 48 * 1024;

  // What esbuild names the output of an entry point read from stdin.
  const STDIN_ENTRY: string = "stdin.js";

  const ADMIN_LAZY_CODES: Array<string> = ADMIN_DASHBOARD_CODES.filter(
    (code: string): boolean => {
      return code !== ADMIN_DASHBOARD_ENGLISH;
    },
  );

  let built: AdminBuild;
  let shipped: Record<string, RuntimeLocaleTree> = {};

  const readSourceLocale: (code: string) => RuntimeLocaleTree = (
    code: string,
  ): RuntimeLocaleTree => {
    return JSON.parse(
      fs.readFileSync(
        path.join(ADMIN_DASHBOARD_LOCALES_DIRECTORY, `${code}.json`),
        "utf8",
      ),
    ) as RuntimeLocaleTree;
  };

  const marksIn: (tree: RuntimeLocaleTree) => Record<string, unknown> = (
    tree: RuntimeLocaleTree,
  ): Record<string, unknown> => {
    const marks: Record<string, unknown> = {};

    for (const key of Object.keys(tree)) {
      if (key.endsWith(SAME_AS_ENGLISH_MARK)) {
        marks[key] = tree[key];
      }
    }

    return marks;
  };

  /*
   * Runs the shipped esbuild.config.js with build() swapped for a probe, as
   * the Dashboard's block does, then builds the real locale files with the
   * config it produced: English imported the way Utils/i18n.ts imports it,
   * every other language through the real Utils/I18nLocaleLoader, each read
   * back from the built bundle.
   */
  beforeAll(() => {
    const probeDir: string = makeTempDir("oneuptime-admin-locales-");
    const preload: string = path.join(probeDir, "probe.js");
    const outdir: string = path.join(probeDir, "out");
    const shippedPath: string = path.join(probeDir, "shipped.json");

    writeFile(
      preload,
      `
      const config = require(${JSON.stringify(ESBUILD_CONFIG)});
      globalThis.__adminBuilds = [];
      config.build = function (built) {
        globalThis.__adminBuilds.push(built);
      };
      config.watch = config.build;
      `,
    );

    const entry: string = `
      import en from "../Locales/en.json";
      export { loadLocaleResource } from "./I18nLocaleLoader";
      export const english: unknown = en;
    `;

    const script: string = `
      require(${JSON.stringify(path.join(ADMIN_DASHBOARD_DIRECTORY, "esbuild.config.js"))});
      const fs = require("fs");
      const path = require("path");
      const url = require("url");
      const esbuild = require(require.resolve("esbuild", {
        paths: [${JSON.stringify(UI_DIR)}],
      }));
      ${SUMMARIZE_OUTPUTS}

      (async function () {
        const config = globalThis.__adminBuilds[0];
        const outdir = ${JSON.stringify(outdir)};
        const build = Object.assign({}, config, {
          stdin: {
            contents: ${JSON.stringify(entry)},
            resolveDir: ${JSON.stringify(path.join(ADMIN_DASHBOARD_DIRECTORY, "src", "Utils"))},
            sourcefile: "LocaleProbe.ts",
            loader: "ts",
          },
          // The real Common, since the Admin Dashboard may not be installed.
          alias: Object.assign({}, config.alias, {
            Common: ${JSON.stringify(path.join(PACKAGES_DIR, "Common"))},
          }),
          outdir: outdir,
          metafile: true,
          logLevel: "silent",
        });
        delete build.entryPoints;
        // Chunks import each other through publicPath; relative, node finds them.
        delete build.publicPath;

        const result = await esbuild.build(build);
        fs.writeFileSync(path.join(outdir, "package.json"), '{"type":"module"}');
        const bundle = await import(url.pathToFileURL(path.join(outdir, "stdin.js")).href);

        const shipped = { en: bundle.english };
        for (const code of ${JSON.stringify(ADMIN_LAZY_CODES)}) {
          shipped[code] = await bundle.loadLocaleResource(code);
        }
        fs.writeFileSync(${JSON.stringify(shippedPath)}, JSON.stringify(shipped));

        console.log(JSON.stringify({
          plugins: config.plugins.map(function (plugin) { return plugin.name; }),
          outputs: summarize(result.metafile, process.cwd()).map(function (output) {
            const bytes = Buffer.byteLength(output.text);
            delete output.text;
            output.bytes = bytes;
            return output;
          }),
        }));
      })().catch(function (error) {
        console.error(error);
        process.exit(1);
      });
    `;

    built = runNode({
      script,
      cwd: ADMIN_DASHBOARD_DIRECTORY,
      env: {
        NODE_ENV: "production",
        ONEUPTIME_EDITION: "community",
        NODE_PATH: PACKAGES_DIR,
      },
      preload,
    }) as AdminBuild;

    shipped = JSON.parse(fs.readFileSync(shippedPath, "utf8")) as Record<
      string,
      RuntimeLocaleTree
    >;
  }, BUILD_TIMEOUT_MS);

  test("the config the Admin Dashboard builds with carries the plugin", () => {
    expect(built.plugins).toContain(RUNTIME_LOCALES_PLUGIN_NAME);
  });

  test("English ships exactly what getRuntimeLocale() keeps of en.json: no identity entry, no _one form", () => {
    const english: RuntimeLocaleTree = readSourceLocale(
      ADMIN_DASHBOARD_ENGLISH,
    );
    const ships: RuntimeLocaleTree = shipped[
      ADMIN_DASHBOARD_ENGLISH
    ] as RuntimeLocaleTree;

    expect(
      treeDifferences(
        ships,
        getRuntimeLocale({
          language: ADMIN_DASHBOARD_ENGLISH,
          fallbackLanguage: ADMIN_DASHBOARD_ENGLISH,
          locale: english,
        }),
      ),
    ).toEqual([]);
    // The nested keys the pages read with t("pages.settings.sso.cardTitle") are all there.
    expect(Object.keys(ships)).toEqual(
      expect.arrayContaining(["pages", "breadcrumbs", "sideMenu", "navbar"]),
    );
    expect(getPluralOneFormKeys(english).length).toBeGreaterThan(50);
    expect(
      getPluralOneFormKeys(english).filter((key: string): boolean => {
        return Object.prototype.hasOwnProperty.call(ships, key);
      }),
    ).toEqual([]);
    expect(marksIn(ships)).toEqual({});
  });

  test.each(ADMIN_LAZY_CODES)(
    "%s ships its translations, every _one form it reads, and a mark for each form its list names",
    (code: string) => {
      const english: RuntimeLocaleTree = readSourceLocale(
        ADMIN_DASHBOARD_ENGLISH,
      );
      const locale: RuntimeLocaleTree = readSourceLocale(code);
      const ships: RuntimeLocaleTree = shipped[code] as RuntimeLocaleTree;

      expect(
        treeDifferences(
          ships,
          getRuntimeLocale({
            language: code,
            fallbackLanguage: ADMIN_DASHBOARD_ENGLISH,
            locale: locale,
            fallback: english,
            sameAsEnglish: readAdminDashboardSameAsEnglish(code),
          }),
        ),
      ).toEqual([]);

      // Smaller than its file: what English reads the same is left out.
      expect([
        code,
        Object.keys(ships).length < Object.keys(locale).length,
      ]).toEqual([code, true]);

      /*
       * A language with a "one" form ships every "_one" form, its own or the
       * English the full files would fall back to. One without ships none
       * read as English.
       */
      const misshipped: Array<string> = getPluralOneFormKeys(english).filter(
        (key: string): boolean => {
          return usesPluralOneForm(code)
            ? ships[key] !==
                (typeof locale[key] === "string" ? locale[key] : english[key])
            : ships[key] === english[key];
        },
      );

      expect([code, misshipped]).toEqual([code, []]);
    },
  );

  /*
   * The forms #8068 found, French's minutes and instances, which it reads at
   * 0, and the Enterprise health pages' one node, which Danish, Dutch and
   * Norwegian write as English does (#8599, #8728).
   */
  test("the one forms the Admin's languages word as English does ship with their marks", () => {
    const marks: Record<string, Record<string, unknown>> = {};

    for (const code of ADMIN_DASHBOARD_CODES) {
      const found: Record<string, unknown> = marksIn(shipped[code] || {});

      if (Object.keys(found).length > 0) {
        marks[code] = found;
      }
    }

    const markOf: (key: string) => string = (key: string): string => {
      return `${key}_one${SAME_AS_ENGLISH_MARK}`;
    };

    expect(marks).toEqual({
      da: {
        [markOf("{{count}} monitors")]: "{{count}} monitor",
        [markOf("{{count}} nodes")]: "{{count}} node",
        [markOf("{{count}} people")]: "{{count}} person",
      },
      es: { [markOf("{{count}} monitors")]: "{{count}} monitor" },
      fr: {
        [markOf("{{count}} instances")]: "{{count}} instance",
        [markOf("{{count}} minutes")]: "{{count}} minute",
      },
      nl: {
        [markOf("{{count}} nodes")]: "{{count}} node",
        [markOf("{{count}} products")]: "{{count}} product",
        [markOf("{{count}} projects")]: "{{count}} project",
      },
      no: {
        [markOf("{{count}} monitors")]: "{{count}} monitor",
        [markOf("{{count}} nodes")]: "{{count}} node",
        [markOf("{{count}} people")]: "{{count}} person",
      },
      pt: { [markOf("{{count}} monitors")]: "{{count}} monitor" },
      sv: {
        [markOf("{{count}} monitors")]: "{{count}} monitor",
        [markOf("{{count}} people")]: "{{count}} person",
      },
    });

    // Right after its form.
    const portugueseKeys: Array<string> = Object.keys(shipped["pt"] || {});

    expect(
      portugueseKeys[portugueseKeys.indexOf("{{count}} monitors_one") + 1],
    ).toBe(markOf("{{count}} monitors"));
  });

  test("en.json's share of the entry bundle stays within its budget", () => {
    const englishBytes: number = entryClosure(
      built.outputs,
      STDIN_ENTRY,
    ).reduce((total: number, output: AdminOutput): number => {
      return total + (output.locales[ADMIN_DASHBOARD_ENGLISH] || 0);
    }, 0);
    const sourceBytes: number = fs.statSync(
      path.join(
        ADMIN_DASHBOARD_LOCALES_DIRECTORY,
        `${ADMIN_DASHBOARD_ENGLISH}.json`,
      ),
    ).size;

    expect(englishBytes).toBeGreaterThan(0);
    expect(englishBytes).toBeLessThanOrEqual(ENGLISH_ENTRY_BUDGET_BYTES);
    expect(englishBytes).toBeLessThan(sourceBytes / 5);
  });

  /*
   * What a page load downloads is the entry chunk and what it imports: the
   * reader's language comes as one chunk more, and a switch fetches the
   * next (AdminLazyLocalesInTheBrowser proves what the page asks for).
   */
  test("no other locale is in the entry bundle, and each is a chunk of its own", () => {
    const closure: Array<AdminOutput> = entryClosure(
      built.outputs,
      STDIN_ENTRY,
    );

    expect(localesIn(closure)).toEqual([ADMIN_DASHBOARD_ENGLISH]);

    for (const code of ADMIN_LAZY_CODES) {
      const chunk: AdminOutput = outputWithLocale(built.outputs, code);

      expect([code, Object.keys(chunk.locales)]).toEqual([code, [code]]);
      expect([code, closure.includes(chunk)]).toEqual([code, false]);
    }
  });

  test("the entry bundle is a fraction of the eighteen files it used to carry", () => {
    const entryBytes: number = entryClosure(built.outputs, STDIN_ENTRY).reduce(
      (total: number, output: AdminOutput): number => {
        return total + output.bytes;
      },
      0,
    );
    const everyFile: number = ADMIN_DASHBOARD_CODES.reduce(
      (total: number, code: string): number => {
        return (
          total +
          fs.statSync(
            path.join(ADMIN_DASHBOARD_LOCALES_DIRECTORY, `${code}.json`),
          ).size
        );
      },
      0,
    );

    expect(everyFile).toBeGreaterThan(3 * 1024 * 1024);
    expect(entryBytes).toBeLessThan(everyFile / 20);
  });
});
