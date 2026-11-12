import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import i18next from "Common/node_modules/i18next";
import {
  ExtractedString,
  HardcodedString,
  SourceScanResult,
  scanSourceText,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "Common/Tests/Helpers/DashboardLocales";
import { withoutIsolateMarks } from "Common/Tests/Helpers/IsolateMarks";
import {
  PluralTemplate,
  TemplateValues,
  Translator,
  formatList,
} from "Common/Types/Translator";
import { getNumberLocale } from "Common/Types/DateLanguage";
import DefaultNetworkSiteType from "Common/Types/NetworkSite/DefaultNetworkSiteType";
import { ToolImportOutcome } from "Common/Types/ToolImport/ToolImportPlan";
import StatusPageGroupViewMode from "Common/Types/StatusPage/StatusPageGroupViewMode";
import {
  NetworkSiteTypeOption,
  SiteCsvError,
  SiteCsvParseResult,
  parseSiteCsv,
} from "../../FeatureSet/Dashboard/src/Utils/NetworkSiteCsv";
import {
  StatusPageGroupCsvError,
  StatusPageGroupCsvParseResult,
  parseStatusPageGroupCsv,
} from "../../FeatureSet/Dashboard/src/Utils/StatusPageGroupCsv";
import {
  SiteImportSummary,
  runSiteImport,
} from "../../FeatureSet/Dashboard/src/Utils/NetworkSiteImportRunner";
import {
  StatusPageGroupImportSummary,
  runStatusPageGroupImport,
} from "../../FeatureSet/Dashboard/src/Utils/StatusPageGroupImportRunner";
import {
  CREATED_IMPORT_RESULT,
  CREATED_IMPORT_RESULT_IN_ENGLISH,
  getCreatedImportResultLabel,
} from "../../FeatureSet/Dashboard/src/Utils/ImportResultWords";
import { getToolImportOutcomeLabel } from "../../FeatureSet/Dashboard/src/Components/ToolImport/ToolImportText";

/*
 * THE CSV IMPORTS' WORDS, WHOLE, IN THE READER'S LANGUAGE (#7097).
 *
 * The site import (Network > Sites > Import from CSV) and a status page's
 * group import say what is wrong with a file before anything is created,
 * and what happened to each row after. A reader on an Arabic or a German
 * Dashboard read those problems in English - the parsers built them from
 * English pieces - and the results marked every created row with the
 * date column's "Created", which Arabic words تاريخ الإنشاء ("creation
 * date"), not what happened to the row.
 *
 * Now every problem is one whole sentence of the locale, its values (a
 * column's name, a cell as it was written, a line of the file in the
 * reader's digits) filled in where the language puts them; the outcome
 * has a key of its own ("Created (import result)", تم الإنشاء); and the
 * runners' fallback for a create that failed without a message is
 * looked up too.
 *
 * The parsers and runners run outside React, through the global i18next
 * instance (getGlobalTranslator), as the Dashboard's i18n.ts sets it up -
 * so this suite initializes that instance with the real locale files and
 * switches it from language to language.
 */

const DASHBOARD: string = path.resolve(__dirname, "../../FeatureSet/Dashboard");
const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../..");

const LANGUAGES: ReadonlyArray<string> = [...DASHBOARD_LANGUAGES];

// The parsers, the runners and the words they share: nothing in them is drawn as written.
const LOOKUP_ONLY_FILES: ReadonlyArray<string> = [
  "src/Utils/NetworkSiteCsv.ts",
  "src/Utils/StatusPageGroupCsv.ts",
  "src/Utils/NetworkSiteImportRunner.ts",
  "src/Utils/StatusPageGroupImportRunner.ts",
  "src/Utils/ImportResultWords.ts",
].map((file: string): string => {
  return path.join(DASHBOARD, file);
});

// The two dialogs that draw them.
const DIALOG_FILES: ReadonlyArray<string> = [
  "src/Components/NetworkSite/ImportSitesFromCsvModal.tsx",
  "src/Components/StatusPage/ImportGroupsFromCsvModal.tsx",
].map((file: string): string => {
  return path.join(DASHBOARD, file);
});

function readSource(file: string): string {
  return fs.readFileSync(file, "utf8");
}

function scan(file: string): SourceScanResult {
  return scanSourceText(
    path.relative(REPOSITORY_ROOT, file),
    readSource(file),
    { kind: "ui" },
  );
}

interface Word {
  key: string;
  english: string;
}

function wordsOf(files: ReadonlyArray<string>): Array<Word> {
  const words: Array<Word> = [];

  for (const file of files) {
    for (const entry of scan(file).strings as Array<ExtractedString>) {
      words.push({ key: entry.text, english: entry.text });

      if (entry.pluralOne) {
        words.push({ key: `${entry.text}_one`, english: entry.pluralOne });
      }
    }
  }

  return words;
}

const WORDS: Array<Word> = wordsOf([...LOOKUP_ONLY_FILES, ...DIALOG_FILES]);

// The keys `language` leaves in English, as npm run i18n:check counts it.
function unworded(language: string, words: ReadonlyArray<Word>): Array<string> {
  return words
    .filter((word: Word): boolean => {
      return !isWordedInDashboardLocale(word.key, language);
    })
    .map((word: Word): string => {
      return word.key;
    });
}

describe("the CSV imports' words", () => {
  test("the scan finds the parsers' whole sentences, the runners' fallbacks and the outcome's own key", () => {
    const keys: Array<string> = WORDS.map((word: Word): string => {
      return word.key;
    });

    for (const sentence of [
      // The site import's problems, each one whole.
      'Unknown siteType "{{value}}". Valid values: {{values}}.',
      'Duplicate site name "{{name}}" (first used on line {{line}}).',
      '{{column}} "{{value}}" is not a number.',
      "{{column}} {{value}} is out of range ({{min}} to {{max}}).",
      "Row has {{values}} values but the header has {{columns}} columns.",
      "A site cannot be its own parent.",
      "latitude and longitude must be provided together.",
      // The group import's.
      'Unknown {{column}} "{{value}}". Valid values: {{values}}.',
      'Duplicate group name "{{name}}" (first used on line {{line}}).',
      "{{columns}} only apply when viewMode is {{grid}}.",
      "{{columns}} only apply when viewMode is {{grid}}._one",
      "A group cannot be its own parent.",
      // What a create that failed without a message says.
      "Something went wrong while creating this site.",
      "Something went wrong while creating this group.",
      // The results' outcome, apart from the date column's "Created".
      CREATED_IMPORT_RESULT,
      // The dialogs' line before each problem.
      "Line {{line}}: {{message}}",
    ]) {
      expect({ sentence, found: keys.includes(sentence) }).toEqual({
        sentence,
        found: true,
      });
    }

    expect(WORDS.length).toBeGreaterThan(60);
  });

  test("the parsers and the runners draw no word outside a lookup", () => {
    const hardcoded: Array<{ file: string; text: string }> = [];

    for (const file of LOOKUP_ONLY_FILES) {
      for (const entry of scan(file).hardcoded as Array<HardcodedString>) {
        hardcoded.push({
          file: path.relative(REPOSITORY_ROOT, file),
          text: entry.text,
        });
      }
    }

    expect(hardcoded).toEqual([]);
  });

  test("every one is a key of the English locale, holding its English", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    for (const word of WORDS) {
      expect({ key: word.key, english: english[word.key] }).toEqual({
        key: word.key,
        english: word.english,
      });
    }
  });

  test.each(LANGUAGES)("%s words every one of them", (language: string) => {
    expect({ language, english: unworded(language, WORDS) }).toEqual({
      language,
      english: [],
    });
  });

  test.each(LANGUAGES)(
    "%s keeps every placeholder of every one",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const word of WORDS) {
        expect({
          language,
          key: word.key,
          placeholders: placeholdersOf(String(words[word.key])),
        }).toEqual({
          language,
          key: word.key,
          placeholders: placeholdersOf(word.english),
        });
      }
    },
  );

  // The check above sees a sentence no language has, and English's own words.
  test("the check catches a sentence left in English (negative control)", () => {
    const missing: Word = {
      key: 'Unknown siteType "{{value}}". Pick one of: {{values}}.',
      english: 'Unknown siteType "{{value}}". Pick one of: {{values}}.',
    };

    for (const language of LANGUAGES) {
      expect(unworded(language, [missing, ...WORDS])).toEqual([missing.key]);
    }
  });
});

/*
 * "Created" over a row an import just made: its own key in every language,
 * as the results of both CSV imports and an import from another tool draw
 * it. Arabic says تم الإنشاء ("was created"), not the date column's
 * تاريخ الإنشاء; Japanese 作成済み, not the column's 作成.
 */
describe("the import outcome's Created", () => {
  test("Arabic and Japanese word it as what happened to the row, not as the date column", () => {
    expect(getCreatedImportResultLabel(dashboardTranslator("ar"))).toBe(
      "تم الإنشاء",
    );
    expect(readDashboardLocale("ar")["Created"]).toBe("تاريخ الإنشاء");
    expect(getCreatedImportResultLabel(dashboardTranslator("ja"))).toBe(
      "作成済み",
    );
    expect(readDashboardLocale("ja")["Created"]).toBe("作成");
    // An English page still says Created, as the docs quote it.
    expect(getCreatedImportResultLabel(dashboardTranslator("en"))).toBe(
      CREATED_IMPORT_RESULT_IN_ENGLISH,
    );
    expect(CREATED_IMPORT_RESULT_IN_ENGLISH).toBe("Created");
  });

  test.each(LANGUAGES)(
    "%s draws the outcome's own wording, in the CSV results and in the tool import's report",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);
      const outcome: string = readDashboardLocale(language)[
        CREATED_IMPORT_RESULT
      ] as string;

      expect(isWordedInDashboardLocale(CREATED_IMPORT_RESULT, language)).toBe(
        true,
      );
      expect(getCreatedImportResultLabel(translator)).toBe(outcome);
      expect(
        getToolImportOutcomeLabel(translator, ToolImportOutcome.Created),
      ).toBe(outcome);
      // Never the key's own English, which names the meaning for a translator.
      expect(outcome).not.toContain("import result");
    },
  );

  test("a language without a wording of its own reads Created, never the key", () => {
    const silent: Translator = {
      ...dashboardTranslator("de"),
      hasTranslation: (): boolean => {
        return false;
      },
      translateText: (text: string | undefined): string | undefined => {
        return text;
      },
    };

    expect(getCreatedImportResultLabel(silent)).toBe("Created");
  });

  test("the dialogs draw it with getCreatedImportResultLabel, never the date column's key", () => {
    const lookupOfCreated: RegExp =
      /\b(?:t|translateText|translateString)\(\s*["']Created["']\s*\)/;

    for (const file of [
      ...DIALOG_FILES,
      path.join(DASHBOARD, "src/Components/ToolImport/ToolImportReport.tsx"),
    ]) {
      expect({
        file: path.basename(file),
        looksUpCreated: lookupOfCreated.test(readSource(file)),
      }).toEqual({ file: path.basename(file), looksUpCreated: false });
    }

    for (const file of DIALOG_FILES) {
      expect({
        file: path.basename(file),
        draws: readSource(file).includes(
          "{getCreatedImportResultLabel(translator)}",
        ),
      }).toEqual({ file: path.basename(file), draws: true });
    }

    // The regex above does see the old lookup (negative control).
    expect(lookupOfCreated.test('{translator.translateText("Created")}')).toBe(
      true,
    );
  });
});

/*
 * The parsers, in the reader's language: the global i18next instance with
 * every locale, switched as the language picker does.
 */
beforeAll(async () => {
  await i18next.init({
    lng: "en",
    fallbackLng: "en",
    resources: Object.fromEntries(
      ["en", ...LANGUAGES].map((language: string) => {
        return [language, { translation: readDashboardLocale(language) }];
      }),
    ),
    interpolation: { escapeValue: false },
    initImmediate: false,
  });
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

async function readIn(language: string): Promise<void> {
  await i18next.changeLanguage(language);
  expect(i18next.resolvedLanguage || i18next.language).toBe(language);
}

const SITE_TYPES: Array<NetworkSiteTypeOption> = [
  { id: "type-region", name: DefaultNetworkSiteType.Region },
  { id: "type-unit", name: DefaultNetworkSiteType.Unit },
];

/*
 * Every row wrong in one way: an unknown site type, no name, its own
 * parent, a latitude past the pole, a name used twice, and one value too
 * many. Line numbers are the file's: the header is line 1.
 */
const BAD_SITES_CSV: string = [
  "name,siteType,parentName,address,latitude,longitude",
  "Unit 1042,Planet,,,,",
  ",Region,,,,",
  "Loop,Region,Loop,,,",
  "Far North,Region,,,95,10",
  "Twin,Region,,,,",
  "Twin,Region,,,,",
  "a,Region,,,1,2,extra",
  "Halfway,Region,,,45,",
].join("\n");

function sentence(
  translator: Translator,
  template: string,
  values: TemplateValues = {},
): string {
  return translator.translateTemplate(template, values, {
    setsValuesApart: true,
  });
}

function pluralSentence(
  translator: Translator,
  template: PluralTemplate,
  count: number,
  values: TemplateValues,
): string {
  return translator.translatePlural(template, count, values, {
    setsValuesApart: true,
  });
}

// What each bad line says, in `language`.
function expectedSiteErrors(language: string): Array<SiteCsvError> {
  const translator: Translator = dashboardTranslator(language);
  const number: (value: number) => string = translator.formatNumber;

  return [
    {
      line: 2,
      message: sentence(
        translator,
        'Unknown siteType "{{value}}". Valid values: {{values}}.',
        {
          value: "Planet",
          values: formatList(
            [DefaultNetworkSiteType.Region, DefaultNetworkSiteType.Unit],
            translator,
          ),
        },
      ),
    },
    { line: 3, message: sentence(translator, "name is required.") },
    {
      line: 4,
      message: sentence(translator, "A site cannot be its own parent."),
    },
    {
      line: 5,
      message: sentence(
        translator,
        "{{column}} {{value}} is out of range ({{min}} to {{max}}).",
        { column: "latitude", value: "95", min: number(-90), max: number(90) },
      ),
    },
    {
      line: 7,
      message: sentence(
        translator,
        'Duplicate site name "{{name}}" (first used on line {{line}}).',
        { name: "Twin", line: number(6) },
      ),
    },
    {
      line: 8,
      message: sentence(
        translator,
        "Row has {{values}} values but the header has {{columns}} columns.",
        { values: number(7), columns: number(6) },
      ),
    },
    {
      line: 9,
      message: sentence(
        translator,
        "latitude and longitude must be provided together.",
      ),
    },
  ];
}

const BAD_GROUPS_CSV: string = [
  "name,parentName,description,isExpandedByDefault,viewMode,rowAxisLabel,columnAxisLabel",
  "Core,,,maybe,,,",
  "Core,,,,,,",
  "Self,Self,,,,,",
  "Axes,,,,List,Region,Tier",
  "Axis,,,,List,Region,",
  "Odd,,,,Carousel,,",
].join("\n");

function expectedGroupErrors(language: string): Array<StatusPageGroupCsvError> {
  const translator: Translator = dashboardTranslator(language);
  const gridOnly: PluralTemplate = {
    one: "{{columns}} only applies when viewMode is {{grid}}.",
    other: "{{columns}} only apply when viewMode is {{grid}}.",
  };

  return [
    {
      line: 2,
      message: sentence(
        translator,
        '{{column}} "{{value}}" is not a true/false value. Use true or false (yes/no and 1/0 also work).',
        { column: "isExpandedByDefault", value: "maybe" },
      ),
    },
    {
      line: 3,
      message: sentence(
        translator,
        'Duplicate group name "{{name}}" (first used on line {{line}}).',
        { name: "Core", line: translator.formatNumber(2) },
      ),
    },
    {
      line: 4,
      message: sentence(translator, "A group cannot be its own parent."),
    },
    {
      line: 5,
      message: pluralSentence(translator, gridOnly, 2, {
        columns: formatList(["rowAxisLabel", "columnAxisLabel"], translator),
        grid: StatusPageGroupViewMode.Grid,
      }),
    },
    {
      line: 6,
      message: pluralSentence(translator, gridOnly, 1, {
        columns: formatList(["rowAxisLabel"], translator),
        grid: StatusPageGroupViewMode.Grid,
      }),
    },
    {
      line: 7,
      message: sentence(
        translator,
        'Unknown {{column}} "{{value}}". Valid values: {{values}}.',
        {
          column: "viewMode",
          value: "Carousel",
          values: formatList(Object.keys(StatusPageGroupViewMode), translator),
        },
      ),
    },
  ];
}

// A line's messages, sorted: the order rows report in is not this suite's subject.
function byLine<T extends { line: number; message: string }>(
  errors: Array<T>,
): Array<{ line: number; message: string }> {
  return errors
    .map((error: T) => {
      return { line: error.line, message: error.message };
    })
    .sort(
      (
        a: { line: number; message: string },
        b: { line: number; message: string },
      ): number => {
        return a.line - b.line || a.message.localeCompare(b.message);
      },
    );
}

// A number as `language` writes it: Persian ۶, Arabic (in OneUptime) 6.
function digitsIn(language: string, value: number): string {
  return value.toLocaleString(getNumberLocale(language));
}

describe("the site import's problems, in the reader's language", () => {
  test.each(["en", ...LANGUAGES])(
    "%s: each bad line says what is wrong as the locale words it",
    async (language: string) => {
      await readIn(language);

      const result: SiteCsvParseResult = parseSiteCsv(
        BAD_SITES_CSV,
        SITE_TYPES,
      );

      expect(byLine(result.errors)).toEqual(
        byLine(expectedSiteErrors(language)),
      );
      // The first Twin is a good row; its repeat is the one reported.
      expect(
        result.rows.map((row: { name: string; line: number }) => {
          return [row.line, row.name];
        }),
      ).toEqual([[6, "Twin"]]);
    },
  );

  test.each(LANGUAGES)(
    "%s: no problem is left in English, and the values are as the file wrote them",
    async (language: string) => {
      await readIn(language);

      const errors: Array<SiteCsvError> = parseSiteCsv(
        BAD_SITES_CSV,
        SITE_TYPES,
      ).errors;
      const english: Array<string> = expectedSiteErrors("en").map(
        (error: SiteCsvError): string => {
          return error.message;
        },
      );

      for (const error of errors) {
        expect({ language, message: error.message, english: false }).toEqual({
          language,
          message: error.message,
          english: english.includes(error.message),
        });
      }

      const text: string = withoutIsolateMarks(
        errors
          .map((error: SiteCsvError): string => {
            return error.message;
          })
          .join("\n"),
      );

      // What the file said, untranslated: the cell, the name, the bound.
      expect(text).toContain("Planet");
      expect(text).toContain("Twin");
      expect(text).toContain("95");
      expect(text).toContain("latitude");
      // The line a name was first used on and the counts, in the reader's digits.
      expect(text).toContain(digitsIn(language, 6));
      expect(text).toContain(digitsIn(language, 7));
    },
  );

  test("Persian numbers the first use and the counts in Persian digits", async () => {
    await readIn("fa");

    const text: string = withoutIsolateMarks(
      parseSiteCsv(BAD_SITES_CSV, SITE_TYPES)
        .errors.map((error: SiteCsvError): string => {
          return error.message;
        })
        .join("\n"),
    );

    expect(text).toContain("۶");
    expect(text).toContain("۷");
    // The cell as written keeps its Latin digits: "95" is what the file says.
    expect(text).toContain("95");
  });

  test("a file-level problem is the locale's too", async () => {
    await readIn("de");

    expect(parseSiteCsv("", SITE_TYPES).errors).toEqual([
      {
        line: 0,
        message: sentence(dashboardTranslator("de"), "The CSV is empty."),
      },
    ]);
    expect(parseSiteCsv("", SITE_TYPES).errors[0]?.message).not.toBe(
      "The CSV is empty.",
    );
  });
});

describe("the group import's problems, in the reader's language", () => {
  test.each(["en", ...LANGUAGES])(
    "%s: each bad line says what is wrong as the locale words it",
    async (language: string) => {
      await readIn(language);

      const result: StatusPageGroupCsvParseResult =
        parseStatusPageGroupCsv(BAD_GROUPS_CSV);

      /*
       * Line 3 repeats "Core": a name is taken on the line it is first
       * written, even when that row has a problem of its own.
       */
      expect(byLine(result.errors)).toEqual(
        byLine(expectedGroupErrors(language)),
      );
      expect(result.rows).toEqual([]);
    },
  );

  test.each(LANGUAGES)(
    "%s: no problem is left in English, and one grid column reads as one",
    async (language: string) => {
      await readIn(language);

      const errors: Array<StatusPageGroupCsvError> =
        parseStatusPageGroupCsv(BAD_GROUPS_CSV).errors;
      const english: Array<string> = expectedGroupErrors("en").map(
        (error: StatusPageGroupCsvError): string => {
          return error.message;
        },
      );

      for (const error of errors) {
        expect({ language, message: error.message, english: false }).toEqual({
          language,
          message: error.message,
          english: english.includes(error.message),
        });
      }

      const oneColumn: string = withoutIsolateMarks(
        errors.find((error: StatusPageGroupCsvError): boolean => {
          return error.line === 6;
        })?.message || "",
      );
      const twoColumns: string = withoutIsolateMarks(
        errors.find((error: StatusPageGroupCsvError): boolean => {
          return error.line === 5;
        })?.message || "",
      );

      expect(oneColumn).toContain("rowAxisLabel");
      expect(oneColumn).not.toContain("columnAxisLabel");
      expect(twoColumns).toContain("rowAxisLabel");
      expect(twoColumns).toContain("columnAxisLabel");
      expect(oneColumn).toContain(StatusPageGroupViewMode.Grid);
    },
  );

  test("English says applies for one column and apply for two", async () => {
    await readIn("en");

    const messages: Array<string> = parseStatusPageGroupCsv(
      BAD_GROUPS_CSV,
    ).errors.map((error: StatusPageGroupCsvError): string => {
      return error.message;
    });

    expect(messages).toContain(
      "rowAxisLabel only applies when viewMode is Grid.",
    );
    expect(messages).toContain(
      "rowAxisLabel, columnAxisLabel only apply when viewMode is Grid.",
    );
  });
});

describe("a create that failed without a message, in the reader's language", () => {
  test.each(["en", ...LANGUAGES])(
    "%s: the site and the group say so as the locale words it",
    async (language: string) => {
      await readIn(language);

      const translator: Translator = dashboardTranslator(language);
      const sites: SiteImportSummary = await runSiteImport({
        rows: parseSiteCsv("name,siteType\nHeadquarters,Region\n", SITE_TYPES)
          .rows,
        existingSiteIdByName: new Map<string, string>(),
        createSite: (): Promise<never> => {
          // A throw that is not an Error: nothing to tell the reader but the fallback.
          return Promise.reject("network gone");
        },
      });
      const groups: StatusPageGroupImportSummary =
        await runStatusPageGroupImport({
          rows: parseStatusPageGroupCsv("name\nCore\n").rows,
          existingGroups: [],
          createGroup: (): Promise<never> => {
            return Promise.reject("network gone");
          },
        });

      const site: string =
        translator.translateText(
          "Something went wrong while creating this site.",
        ) || "";
      const group: string =
        translator.translateText(
          "Something went wrong while creating this group.",
        ) || "";

      expect(sites.results).toHaveLength(1);
      expect(sites.results[0]).toMatchObject({
        status: "failed",
        message: site,
      });
      expect(groups.results).toHaveLength(1);
      expect(groups.results[0]).toMatchObject({
        status: "failed",
        message: group,
      });

      if (language !== "en") {
        expect(site).not.toBe("Something went wrong while creating this site.");
        expect(group).not.toBe(
          "Something went wrong while creating this group.",
        );
      }
    },
  );

  test("a server's own message is shown as it came", async () => {
    await readIn("de");

    const sites: SiteImportSummary = await runSiteImport({
      rows: parseSiteCsv("name,siteType\nHeadquarters,Region\n", SITE_TYPES)
        .rows,
      existingSiteIdByName: new Map<string, string>(),
      createSite: (): Promise<never> => {
        return Promise.reject(
          new Error("A site with this name already exists."),
        );
      },
    });

    expect(sites.results[0]).toMatchObject({
      status: "failed",
      message: "A site with this name already exists.",
    });
  });
});

/*
 * WHERE EACH IMPORT OPENS, IN THE READER'S LANGUAGE (UI review of #7097).
 *
 * The site import opens from the Sites list's menu entry "Import from
 * CSV", and the group import from a status page's "Import groups from
 * CSV". The dialog was worded in every language while the entry that
 * opens it stayed English in twelve of them (Persian and Hindi among
 * them): a reader met the import in English before reaching its words.
 */
describe("the entries that open the CSV imports", () => {
  interface Entry {
    file: string;
    label: string;
  }

  const ENTRIES: ReadonlyArray<Entry> = [
    { file: "src/Pages/NetworkSite/Sites.tsx", label: "Import from CSV" },
    {
      file: "src/Pages/StatusPages/View/Resources.tsx",
      label: "Import groups from CSV",
    },
  ];

  test("each page draws its entry with that label", () => {
    for (const entry of ENTRIES) {
      expect({
        file: entry.file,
        draws: readSource(path.join(DASHBOARD, entry.file)).includes(
          JSON.stringify(entry.label),
        ),
      }).toEqual({ file: entry.file, draws: true });
    }
  });

  test.each(LANGUAGES)("%s words both entries", (language: string) => {
    const english: Array<string> = unworded(
      language,
      ENTRIES.map((entry: Entry): Word => {
        return { key: entry.label, english: entry.label };
      }),
    );

    expect({ language, english }).toEqual({ language, english: [] });
  });

  test("Persian and Hindi name the site import's entry with their dialog title's verb", () => {
    expect(readDashboardLocale("fa")["Import from CSV"]).toBe(
      "وارد کردن از CSV",
    );
    expect(readDashboardLocale("hi")["Import from CSV"]).toBe(
      "CSV से आयात करें",
    );
  });
});

/*
 * ONE HINDI WORD FOR IMPORT IN BOTH DIALOGS (UI review of #7097).
 *
 * Hindi has two words for an import: आयात, and the loanword इम्पोर्ट
 * (also spelt इंपोर्ट). The dialogs' own buttons and headings said आयात
 * (आयात का पूर्वावलोकन, आयात के परिणाम, CSV से समूह आयात करें), while
 * the site import's title, its submit button, its "ready to import" line
 * and both dialogs' help texts said इम्पोर्ट: two words for one action
 * in one dialog. Every word the dialogs and their parsers draw says आयात.
 */
describe("Hindi says import one way in the CSV imports", () => {
  const LOANWORD: RegExp = /इम्पोर्ट|इंपोर्ट/u;
  const DANDA_AFTER_COLUMNS: RegExp = /^कॉलम: \{\{columns\}\}। /u;

  function loanwordKeys(
    words: ReadonlyArray<Word>,
    hindi: Record<string, string>,
  ): Array<string> {
    return words
      .filter((word: Word): boolean => {
        return LOANWORD.test(String(hindi[word.key] || ""));
      })
      .map((word: Word): string => {
        return word.key;
      });
  }

  test("no Hindi value the dialogs or parsers draw uses the loanword", () => {
    expect(loanwordKeys(WORDS, readDashboardLocale("hi"))).toEqual([]);
  });

  test("the title, the button, the count line and the help say आयात", () => {
    const hindi: Record<string, string> = readDashboardLocale("hi");

    expect(hindi["Import Sites from CSV"]).toBe("CSV से साइटें आयात करें");
    expect(hindi["Import {{count}} Sites"]).toBe("{{count}} साइटें आयात करें");
    expect(hindi["Import {{count}} Sites_one"]).toBe(
      "{{count}} साइट आयात करें",
    );
    expect(hindi["{{count}} sites ready to import."]).toBe(
      "{{count}} साइटें आयात के लिए तैयार हैं।",
    );
    expect(hindi["Import {{count}} Groups"]).toBe("{{count}} समूह आयात करें");
    expect(hindi["Preview Import"]).toBe("आयात का पूर्वावलोकन");

    // A Hindi sentence ends with a danda, the columns' list's included.
    const helpTexts: Array<Word> = WORDS.filter((word: Word): boolean => {
      return word.key.startsWith("Columns: {{columns}}.");
    });

    expect(helpTexts.length).toBe(3);

    for (const word of helpTexts) {
      expect({
        key: word.key.slice(0, 40),
        endsWithDanda: DANDA_AFTER_COLUMNS.test(String(hindi[word.key])),
      }).toEqual({ key: word.key.slice(0, 40), endsWithDanda: true });
    }
  });

  test("the check finds a value that says इम्पोर्ट (negative control)", () => {
    const key: string = "Import Sites from CSV";

    expect(
      loanwordKeys(WORDS, {
        ...readDashboardLocale("hi"),
        [key]: "CSV से साइटें इम्पोर्ट करें",
      }),
    ).toEqual([key]);
  });
});
