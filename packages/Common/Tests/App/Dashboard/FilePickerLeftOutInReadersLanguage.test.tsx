import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import fs from "fs";
import path from "path";
import React from "react";
import { I18nextProvider } from "react-i18next";
import { setDateDisplayLanguage } from "../../../Types/DateLanguage";
import MimeType from "../../../Types/File/MimeType";
import { PluralTemplate } from "../../../Types/Translator";
import FilePicker, {
  FILE_PICKER_ERROR_TEST_ID,
} from "../../../UI/Components/FilePicker/FilePicker";
import { FILE_PICKER_FULL_NOTE } from "../../../UI/Components/FilePicker/FilePickerLayout";
import {
  FILE_PICKER_NO_ROOM_FOR_FILE,
  FILE_PICKER_NO_ROOM_FOR_FILES,
} from "../../../UI/Components/FilePicker/FilePickerLeftOut";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { isolated, withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import {
  ACCOUNTS_LANGUAGES,
  ADMIN_DASHBOARD_LANGUAGES,
  DASHBOARD_LANGUAGES,
} from "../../Helpers/TranslatedLanguages";

/*
 * THE FILES A PICKER LEFT OUT, NAMED IN THE READER'S LANGUAGE (issue #8041).
 *
 * A picker of several files that is given more than it has room for adds
 * what fits and names the rest, with how many it holds: in the reader's
 * words and digits, in the form of the noun their language takes for that
 * count, the names listed with the language's own separator and set apart
 * on a page read from the right, so a name in Latin letters keeps its
 * ".log" at its end and the sentence its full stop. The Dashboard, the
 * public form page (Accounts) and the Admin Dashboard each word it in all
 * their languages.
 */

const APPS_DIR: string = path.resolve(__dirname, "../../../../App/FeatureSet");

const LOCALE_DIRS: Record<string, string> = {
  Dashboard: path.join(APPS_DIR, "Dashboard/src/Locales"),
  Accounts: path.join(APPS_DIR, "Accounts/src/Locales"),
  AdminDashboard: path.join(APPS_DIR, "AdminDashboard/src/Locales"),
};

const LANGUAGES_OF: Record<string, ReadonlyArray<string>> = {
  Dashboard: DASHBOARD_LANGUAGES,
  Accounts: ACCOUNTS_LANGUAGES,
  AdminDashboard: ADMIN_DASHBOARD_LANGUAGES,
};

const PLURALS: Array<PluralTemplate> = [
  FILE_PICKER_NO_ROOM_FOR_FILE,
  FILE_PICKER_NO_ROOM_FOR_FILES,
];

const LATIN_DIGIT: RegExp = /[0-9]/;

const readAppLocale: (
  app: string,
  language: string,
) => Record<string, string> = (
  app: string,
  language: string,
): Record<string, string> => {
  return JSON.parse(
    fs.readFileSync(
      path.join(LOCALE_DIRS[app] as string, `${language}.json`),
      "utf8",
    ),
  ) as Record<string, string>;
};

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  const pages: Array<[string, string, Record<string, string>]> = [
    ...["en", "de", "ru", "fa", "ar", "ja"].map(
      (language: string): [string, string, Record<string, string>] => {
        return [language, language, readDashboardLocale(language)];
      },
    ),
    // The public form page draws the picker with Accounts' words.
    ["accounts-de", "de", readAppLocale("Accounts", "de")],
  ];

  for (const [name, language, words] of pages) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: { [language]: { translation: words } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    instances[name] = instance;
  }
});

afterEach(() => {
  cleanup();
  setDateDisplayLanguage("en");
});

type MakeFileFunction = (name: string) => File;

// jsdom's File cannot read itself: each one reads the bytes it was made of.
const makeFile: MakeFileFunction = (name: string): File => {
  const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(16).fill(0x41);
  const file: File = new File([bytes], name, { type: MimeType.txt });
  file.arrayBuffer = async (): Promise<ArrayBuffer> => {
    return bytes.slice().buffer;
  };
  return file;
};

type LeftOutLineFunction = (data: {
  page: string;
  maxFiles: number;
  names: Array<string>;
}) => Promise<string>;

/*
 * What a picker of `maxFiles` files, kept in the browser as a public form
 * keeps them, says when `names` are dropped on it on `page`: the line that
 * names what it left out, as drawn.
 */
const leftOutLine: LeftOutLineFunction = async (data: {
  page: string;
  maxFiles: number;
  names: Array<string>;
}): Promise<string> => {
  const language: string = data.page.replace(/^accounts-/, "");

  setDateDisplayLanguage(language);
  render(
    <I18nextProvider i18n={instances[data.page]!}>
      <FilePicker
        isMultiFilePicker={true}
        maxFiles={data.maxFiles}
        keepFilesInBrowser={true}
        mimeTypes={[MimeType.txt]}
        dataTestId="picker"
      />
    </I18nextProvider>,
  );

  await act(async () => {
    fireEvent.drop(screen.getByTestId("picker"), {
      dataTransfer: {
        files: data.names.map((name: string): File => {
          return makeFile(name);
        }),
        types: ["Files"],
      },
    });
  });

  return (
    (await screen.findByTestId(FILE_PICKER_ERROR_TEST_ID)).textContent || ""
  );
};

// Names a..z with ".log", as many as asked.
const logs: (count: number) => Array<string> = (
  count: number,
): Array<string> => {
  return Array.from({ length: count }, (_: unknown, index: number): string => {
    return `${String.fromCharCode(97 + (index % 26))}${index >= 26 ? index : ""}.log`;
  });
};

describe("one file it had no room for, named in the reader's words", () => {
  test.each([
    ["en", 3, '"d.log" was not added: this field holds up to 3 files.'],
    ["en", 1, '"b.log" was not added: this field holds one file.'],
    [
      "de",
      3,
      "„d.log“ wurde nicht hinzugefügt: Dieses Feld fasst bis zu 3 Dateien.",
    ],
    ["de", 1, "„b.log“ wurde nicht hinzugefügt: Dieses Feld fasst eine Datei."],
    ["ru", 3, "Файл «d.log» не добавлен. Максимум файлов в этом поле: 3."],
    // 21 is a count Russian calls "one": the general sentence, which names it.
    ["ru", 21, "Файл «v.log» не добавлен. Максимум файлов в этом поле: 21."],
    [
      "ru",
      1,
      "Файл «b.log» не добавлен: в этом поле может быть только один файл.",
    ],
    ["fa", 3, "«d.log» افزوده نشد: این فیلد حداکثر ۳ فایل می‌پذیرد."],
    ["fa", 1, "«b.log» افزوده نشد: این فیلد یک فایل می‌پذیرد."],
    ["ar", 3, "لم تتم إضافة «d.log»، فالحد الأقصى للملفات في هذا الحقل: 3."],
    // Arabic's 11 is its "many": the general sentence again.
    ["ar", 11, "لم تتم إضافة «l.log»، فالحد الأقصى للملفات في هذا الحقل: 11."],
    ["ar", 1, "لم تتم إضافة «b.log»، فهذا الحقل يحمل ملفًا واحدًا."],
    [
      "ja",
      3,
      "「d.log」は追加されませんでした。このフィールドに入れられるファイルは最大 3 個です。",
    ],
  ] as Array<[string, number, string]>)(
    "%s: a field of %p files",
    async (page: string, maxFiles: number, words: string) => {
      const line: string = await leftOutLine({
        page,
        maxFiles,
        names: logs(maxFiles + 1),
      });

      expect(withoutIsolateMarks(line)).toBe(words);
    },
  );
});

describe("several it had no room for, listed as the reader's language lists", () => {
  test.each([
    [
      "en",
      "These files were not added, as this field holds up to 3 files: d.log, e.log.",
    ],
    [
      "de",
      "Diese Dateien wurden nicht hinzugefügt, da dieses Feld bis zu 3 Dateien fasst: d.log, e.log.",
    ],
    [
      "ru",
      "Максимум файлов в этом поле: 3, поэтому эти файлы не добавлены: d.log, e.log.",
    ],
    [
      "fa",
      "این فایل‌ها افزوده نشدند، چون این فیلد حداکثر ۳ فایل می‌پذیرد: d.log، e.log.",
    ],
    [
      "ar",
      "الحد الأقصى للملفات في هذا الحقل: 3، لذا لم تتم إضافة هذه الملفات: d.log، e.log.",
    ],
    [
      "ja",
      "このフィールドに入れられるファイルは最大 3 個のため、次のファイルは追加されませんでした: d.log、e.log。",
    ],
    // The public form page, in Accounts' words.
    [
      "accounts-de",
      "Diese Dateien wurden nicht hinzugefügt, da dieses Feld bis zu 3 Dateien fasst: d.log, e.log.",
    ],
  ] as Array<[string, string]>)("%s", async (page: string, words: string) => {
    const line: string = await leftOutLine({
      page,
      maxFiles: 3,
      names: logs(5),
    });

    expect(withoutIsolateMarks(line)).toBe(words);
  });
});

/*
 * On a page read from the right, the names are a value of the sentence set
 * apart from its words, so "d.log" keeps its ".log" at its end and the
 * sentence its full stop; the count is in the reader's digits.
 */
describe("on a page read from the right", () => {
  test.each(["fa", "ar"])(
    "%s: each name, and a list of names, is set apart from the words",
    async (page: string) => {
      expect(
        await leftOutLine({ page, maxFiles: 3, names: logs(4) }),
      ).toContain(isolated("d.log"));
      cleanup();

      const several: string = await leftOutLine({
        page,
        maxFiles: 3,
        names: logs(5),
      });

      expect(several).toContain(isolated("d.log، e.log"));
    },
  );

  test("fa: the count in Persian digits, and no Latin digit outside the names", async () => {
    const line: string = await leftOutLine({
      page: "fa",
      maxFiles: 10,
      names: logs(12),
    });

    expect(line).toContain("۱۰");
    expect(
      withoutIsolateMarks(line).replace(/[a-z0-9]+\.log/g, ""),
    ).not.toMatch(LATIN_DIGIT);
  });

  test("en: drawn as English writes it, nothing set apart", async () => {
    const line: string = await leftOutLine({
      page: "en",
      maxFiles: 3,
      names: logs(5),
    });

    expect(line).toBe(withoutIsolateMarks(line));
  });
});

/*
 * Every language of every app that draws a file picker words both
 * sentences, in both forms: the general one says the count once and writes
 * no number of its own, the one form names no count. Russian and Arabic
 * say their general form for most counts (2, 5, 21; 2, 3, 11, 100), so it
 * names its count as a label's value and no noun has to agree with a count
 * it cannot see (Locales/ARABIC.md).
 */
describe("in every language of every app", () => {
  const cases: Array<[string, string]> = Object.keys(LOCALE_DIRS).flatMap(
    (app: string): Array<[string, string]> => {
      return ["en", ...(LANGUAGES_OF[app] as ReadonlyArray<string>)].map(
        (language: string): [string, string] => {
          return [app, language];
        },
      );
    },
  );

  test("every app and every language is checked", () => {
    expect(cases.length).toBeGreaterThanOrEqual(3 * 18);
  });

  test.each(cases)(
    "%s %s: both sentences, in both forms, the count a value",
    (app: string, language: string) => {
      const words: Record<string, string> = readAppLocale(app, language);

      for (const plural of PLURALS) {
        const general: string | undefined = words[plural.other];
        const one: string | undefined = words[`${plural.other}_one`];
        const names: string = plural.other.includes("{{fileNames}}")
          ? "{{fileNames}}"
          : "{{fileName}}";

        expect({ app, language, general: typeof general }).toEqual({
          app,
          language,
          general: "string",
        });
        expect({ app, language, one: typeof one }).toEqual({
          app,
          language,
          one: "string",
        });
        expect(general!.split("{{count}}")).toHaveLength(2);
        expect(general!.split(names)).toHaveLength(2);
        expect(general).not.toMatch(/[0-9٠-٩۰-۹]/);
        expect(one).not.toContain("{{count}}");
        expect(one!.split(names)).toHaveLength(2);

        if (language === "en") {
          expect(general).toBe(plural.other);
          expect(one).toBe(plural.one);
        } else {
          expect({ language, general }).not.toEqual({
            language,
            general: plural.other,
          });
          expect({ language, one }).not.toEqual({ language, one: plural.one });
        }

        if (language === "ru" || language === "ar") {
          expect(general).toMatch(/: \{\{count\}\}[.,،]/);
        }
      }
    },
  );

  // A shared component says the same in every app: its words are the Dashboard's.
  test.each(
    cases.filter(([app]: [string, string]): boolean => {
      return app !== "Dashboard";
    }),
  )(
    "%s %s: worded as the Dashboard words them",
    (app: string, language: string) => {
      const words: Record<string, string> = readAppLocale(app, language);
      const dashboard: Record<string, string> = readDashboardLocale(language);

      for (const plural of PLURALS) {
        for (const key of [plural.other, `${plural.other}_one`]) {
          expect({ app, language, key, words: words[key] }).toEqual({
            app,
            language,
            key,
            words: dashboard[key],
          });
        }
      }
    },
  );

  /*
   * The hand-kept files keep the picker's words together: right after the
   * full picker's note, each "_one" form after its key.
   */
  test.each(
    cases.filter(([app]: [string, string]): boolean => {
      return app !== "Dashboard";
    }),
  )(
    "%s %s: after the full picker's note, in English's order",
    (app: string, language: string) => {
      const keys: Array<string> = Object.keys(readAppLocale(app, language));
      const after: number = keys.indexOf(`${FILE_PICKER_FULL_NOTE.other}_one`);

      expect(after).toBeGreaterThan(-1);
      expect(keys.slice(after + 1, after + 5)).toEqual([
        FILE_PICKER_NO_ROOM_FOR_FILE.other,
        `${FILE_PICKER_NO_ROOM_FOR_FILE.other}_one`,
        FILE_PICKER_NO_ROOM_FOR_FILES.other,
        `${FILE_PICKER_NO_ROOM_FOR_FILES.other}_one`,
      ]);
    },
  );
});
