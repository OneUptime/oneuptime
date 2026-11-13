import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  alignLocale,
  buildEnglishLocale,
  DASHBOARD_LOCALES_DIRECTORY,
  DASHBOARD_SHARED_TEXT_SOURCES,
  ENGLISH,
  findServerTextKeys,
  getDashboardSharedKeys,
  getLocalePath,
  listSourceFiles,
  LocaleDictionary,
  PLURAL_ONE_SUFFIX,
  readDashboardLocale,
  readLocale,
  REPOSITORY_ROOT,
  SERVER_TEXT_SOURCES,
  ServerTextKey,
  toLocaleText,
  TRANSLATED_LANGUAGES,
  withDashboardWordings,
} from "../../../Scripts/I18n/ServerLocales";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { createTranslator, Translator } from "../../../Types/Translator";

/*
 * SENTENCES THE SERVER AND THE DASHBOARD BOTH WRITE (#7247).
 *
 * A new monitor's default criteria - each criteria's name and description,
 * and the title and description of the incident and alert it opens - are
 * written in the language of the person the monitor is made for: by the
 * Dashboard (Create Monitor, the website guided setup) and by the server
 * when Ask AI sets the monitor up (SetupTools). The same answers must make
 * the same record, so the server's locale set holds a copy of those
 * sentences that is never worded by hand: npm run i18n:server-sync copies
 * each language's wording from the Dashboard's file (withDashboardWordings).
 *
 * These hold that copy to the Dashboard's files, the shared sources to the
 * builders that write a new monitor's criteria, and the sync's helpers to
 * what they promise.
 */

const english: LocaleDictionary = readLocale(ENGLISH);
const keys: Array<ServerTextKey> = findServerTextKeys();
const sharedKeys: Set<string> = getDashboardSharedKeys(keys);

const MONITOR_TYPES: Array<MonitorType> = Object.values(
  MonitorType,
) as Array<MonitorType>;

/*
 * Every sentence a new monitor's default criteria look up, for every
 * monitor type: a translator that records what it is asked and words
 * nothing.
 */
const sentencesTheCriteriaLookUp: () => Set<string> = (): Set<string> => {
  const asked: Set<string> = new Set<string>();
  const recording: Translator = createTranslator(
    (text: string): string | undefined => {
      asked.add(text);
      return undefined;
    },
    "de",
  );

  for (const monitorType of MONITOR_TYPES) {
    MonitorSteps.getDefaultMonitorSteps({
      defaultMonitorStatusId: ObjectID.generate(),
      onlineMonitorStatusId: ObjectID.generate(),
      offlineMonitorStatusId: ObjectID.generate(),
      defaultIncidentSeverityId: ObjectID.generate(),
      defaultAlertSeverityId: ObjectID.generate(),
      warningAlertSeverityId: ObjectID.generate(),
      monitorType: monitorType,
      monitorName: "Acme Checkout",
      translator: recording,
    });
  }

  return asked;
};

describe("the sentences the server and the Dashboard both write", () => {
  test("come from files the server's scan reads, a new monitor's criteria among them", () => {
    expect(DASHBOARD_SHARED_TEXT_SOURCES).toContain(
      "packages/Common/Types/Monitor/MonitorCriteriaInstance.ts",
    );

    const scanned: Array<string> = listSourceFiles();

    for (const source of DASHBOARD_SHARED_TEXT_SOURCES) {
      expect(SERVER_TEXT_SOURCES).toContain(source);
      expect(fs.existsSync(path.join(REPOSITORY_ROOT, source))).toBe(true);
      expect(scanned).toContain(path.join(REPOSITORY_ROOT, source));
    }

    expect(fs.existsSync(DASHBOARD_LOCALES_DIRECTORY)).toBe(true);
  });

  test("are every sentence a new monitor's default criteria are written with, for every monitor type, and nothing else", () => {
    const asked: Set<string> = sentencesTheCriteriaLookUp();

    // The criteria of the website and API monitors Ask AI sets up are among them.
    expect(asked).toContain("Check if {{monitorName}} is online");
    expect(asked).toContain("{{monitorName}} is offline");
    // In single quotes in the source: Prettier's, for a sentence with double quotes.
    expect(asked).toContain(
      'This criteria checks if the request body of {{monitorName}} does not contain "{{keyword}}"',
    );

    expect(
      Array.from(asked)
        .filter((sentence: string): boolean => {
          return !sharedKeys.has(sentence);
        })
        .sort(),
    ).toEqual([]);

    expect(
      Array.from(sharedKeys)
        .filter((key: string): boolean => {
          return !asked.has(key);
        })
        .sort(),
    ).toEqual([]);
  });

  test("are in en.json as their own English", () => {
    expect(sharedKeys.size).toBeGreaterThan(80);

    for (const key of sharedKeys) {
      expect([key, english[key]]).toEqual([key, key]);
    }
  });

  test.each(TRANSLATED_LANGUAGES)(
    "%s words each of them exactly as the Dashboard's file of that language does",
    (language: string) => {
      const locale: LocaleDictionary = readLocale(language);
      const dashboard: LocaleDictionary = readDashboardLocale(language);
      let wordedApart: number = 0;

      for (const key of sharedKeys) {
        // The Dashboard words every one of them: none is left in English.
        expect([key, typeof dashboard[key]]).toEqual([key, "string"]);
        expect([key, locale[key]]).toEqual([key, dashboard[key]]);

        if (locale[key] !== english[key]) {
          wordedApart++;
        }
      }

      // Worded in the language, not copied from the English.
      expect(wordedApart).toBeGreaterThan(sharedKeys.size / 2);
    },
  );

  test.each(TRANSLATED_LANGUAGES)(
    "%s is what npm run i18n:server-sync writes: running it changes nothing",
    (language: string) => {
      const expected: LocaleDictionary = alignLocale({
        english: buildEnglishLocale(keys),
        locale: withDashboardWordings({
          english: buildEnglishLocale(keys),
          locale: readLocale(language),
          dashboard: readDashboardLocale(language),
          sharedKeys: sharedKeys,
        }),
      });

      expect(fs.readFileSync(getLocalePath(language), "utf8")).toBe(
        toLocaleText(expected),
      );
    },
  );
});

describe("getDashboardSharedKeys", () => {
  const shared: string = DASHBOARD_SHARED_TEXT_SOURCES[0]!;

  test("keeps the sentences of the shared files, a plural's one form with its key", () => {
    expect(
      Array.from(
        getDashboardSharedKeys([
          { key: "Check if {{monitorName}} is online", file: shared },
          { key: "{{count}} checks", one: "{{count}} check", file: shared },
          { key: "[Incident] {{title}}", file: "packages/Other.ts" },
          { key: "", file: shared },
        ]),
      ).sort(),
    ).toEqual(
      [
        "Check if {{monitorName}} is online",
        "{{count}} checks",
        `{{count}} checks${PLURAL_ONE_SUFFIX}`,
      ].sort(),
    );
  });

  test("a sentence a shared file and another file both look up is shared", () => {
    expect(
      getDashboardSharedKeys([
        { key: "Both", file: "packages/Other.ts" },
        { key: "Both", file: shared },
      ]).has("Both"),
    ).toBe(true);
  });
});

describe("withDashboardWordings", () => {
  const englishWords: LocaleDictionary = {
    "Check if {{monitorName}} is online": "Check if {{monitorName}} is online",
    "[Incident] {{title}}": "[Incident] {{title}}",
    New: "New",
  };

  test("the Dashboard's wording replaces one of the server's own, and the server's other sentences keep theirs", () => {
    expect(
      withDashboardWordings({
        english: englishWords,
        locale: {
          "Check if {{monitorName}} is online": "Hand-made {{monitorName}}",
          "[Incident] {{title}}": "[Vorfall] {{title}}",
        },
        dashboard: {
          "Check if {{monitorName}} is online":
            "Prüfen, ob {{monitorName}} online ist",
          "[Incident] {{title}}": "Not the server's",
        },
        sharedKeys: new Set<string>(["Check if {{monitorName}} is online"]),
      }),
    ).toEqual({
      "Check if {{monitorName}} is online":
        "Prüfen, ob {{monitorName}} online ist",
      "[Incident] {{title}}": "[Vorfall] {{title}}",
    });
  });

  test("a sentence the Dashboard has not worded yet is the English, never an older wording", () => {
    expect(
      withDashboardWordings({
        english: englishWords,
        locale: { New: "Neu (alt)" },
        dashboard: { New: "" },
        sharedKeys: new Set<string>(["New"]),
      }),
    ).toEqual({ New: "New" });
  });

  test("reads only the Dashboard's own wordings, never one it inherits", () => {
    const dashboard: LocaleDictionary = Object.create({
      New: "Inherited",
    }) as LocaleDictionary;

    expect(
      withDashboardWordings({
        english: englishWords,
        locale: {},
        dashboard: dashboard,
        sharedKeys: new Set<string>(["New"]),
      }),
    ).toEqual({ New: "New" });
  });

  test("leaves the file it is given as it was", () => {
    const locale: LocaleDictionary = { New: "Neu" };

    withDashboardWordings({
      english: englishWords,
      locale: locale,
      dashboard: { New: "Neu!" },
      sharedKeys: new Set<string>(["New"]),
    });

    expect(locale).toEqual({ New: "Neu" });
  });
});
