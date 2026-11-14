import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { SERVER_LOCALES } from "../../../Server/Utils/ServerTranslation";
import { DEFAULT_STATUS_NAMES } from "../../../Types/StatusPage/DefaultStatusNames";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * ONEUPTIME'S DEFAULT NAMES ARE WORDS OF THE DASHBOARD, IN EVERY LANGUAGE
 * (#7821).
 *
 * A badge on a Dashboard page looks its text up in the reader's language
 * (Pill), so the states, severities and statuses a new project starts with
 * read in the reader's words - while their names are keys of the
 * Dashboard's locale files. "Critical Incident", "Major Incident" and
 * "Minor Incident" were not: no file the Dashboard's extraction reads
 * writes them, so the severities every project starts with read English in
 * every language, where the status page and the notifications said them in
 * the reader's.
 *
 * The extraction does not read DEFAULT_STATUS_NAMES: the Admin Dashboard's
 * bundle reaches the list (through BaseModelTable), and every frontend that
 * reaches an extracted file is held to its words
 * (AdminImportedCommonStringsLocales), though no Admin page shows a
 * project's severity. This test keeps every name of the list a key of the
 * Dashboard's own files instead: written as itself in en.json, and worded
 * in every other language.
 *
 * A key is a whole name, as written. A severity a project renamed has none
 * and reads as its owner wrote it (DefaultIncidentSeverityNamesInLocale).
 *
 * ONE WORD FOR EACH NAME, WHEREVER IT IS READ (#7895).
 *
 * A reader meets a default name in three places, each worded by locale
 * files of its own: the Dashboard; a public status page (its statusNames,
 * StatusPage/src/Utils/StatusTranslation); and the server's messages - a
 * status page's notifications to its subscribers and a person's on-call
 * pages (Common/Server/Locales, translateStateName). Translated apart, they
 * drifted apart in 15 places, and three were wrong: a Japanese status page
 * wrote Identified as 確認済み, the Dashboard's word for Acknowledged; a
 * Russian one wrote Ended and Completed alike, Завершено; a Hindi one wrote
 * Degraded as घटित, "occurred". So every default name reads the same in all
 * three, and no two default names share a word in any of them. Where they
 * differ, keep the Dashboard's word: it is the one each language's docs
 * name the state by (Docs/Content/<language>).
 */

const DEFAULT_INCIDENT_SEVERITY_NAMES: ReadonlyArray<string> = [
  "Critical Incident",
  "Major Incident",
  "Minor Incident",
];

const STATUS_PAGE_SOURCE: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/StatusPage/src",
);

// The map a status page's translateStatusName looks a default name's key up in.
const STATUS_PAGE_NAME_KEYS_REGEX: RegExp =
  /DEFAULT_STATUS_NAME_KEYS[^{]*\{([^}]*)\}/;

// One entry of that map: `Identified: "identified"` or `"Major Incident": "majorIncident"`.
const STATUS_PAGE_NAME_KEY_REGEX: RegExp = /(?:"([^"]+)"|(\w+))\s*:\s*"(\w+)"/g;

/*
 * The key a status page reads each default name's word under, in its
 * locale files' statusNames: read from StatusTranslation.ts itself, so a
 * key the status page changes is the one checked here.
 */
const readStatusPageNameKeys: () => Record<string, string> = (): Record<
  string,
  string
> => {
  const source: string = fs.readFileSync(
    path.join(STATUS_PAGE_SOURCE, "Utils", "StatusTranslation.ts"),
    "utf8",
  );
  const body: string = source.match(STATUS_PAGE_NAME_KEYS_REGEX)?.[1] || "";
  const keys: Record<string, string> = {};

  for (const entry of Array.from(body.matchAll(STATUS_PAGE_NAME_KEY_REGEX))) {
    keys[(entry[1] || entry[2])!] = entry[3]!;
  }

  return keys;
};

type DefaultNameWords = Record<string, string | undefined>;

// Each default name's word in `words`, a locale file keyed by the English.
const pickDefaultNames: (
  words: Readonly<Record<string, string>>,
) => DefaultNameWords = (
  words: Readonly<Record<string, string>>,
): DefaultNameWords => {
  const picked: DefaultNameWords = {};

  for (const name of DEFAULT_STATUS_NAMES) {
    picked[name] = words[name];
  }

  return picked;
};

// Each default name's word on a status page read in `language`.
const readStatusPageWords: (language: string) => DefaultNameWords = (
  language: string,
): DefaultNameWords => {
  const keys: Record<string, string> = readStatusPageNameKeys();
  const locale: { statusNames?: Record<string, string> } = JSON.parse(
    fs.readFileSync(
      path.join(STATUS_PAGE_SOURCE, "Locales", `${language}.json`),
      "utf8",
    ),
  ) as { statusNames?: Record<string, string> };
  const words: DefaultNameWords = {};

  for (const name of DEFAULT_STATUS_NAMES) {
    const key: string | undefined = keys[name];

    words[name] = key ? locale.statusNames?.[key] : undefined;
  }

  return words;
};

interface SurfaceWords {
  surface: string;
  words: DefaultNameWords;
}

// The default names' words in `language`, everywhere a reader meets them.
const readWordsOfEverySurface: (language: string) => Array<SurfaceWords> = (
  language: string,
): Array<SurfaceWords> => {
  const server: Readonly<Record<string, string>> | undefined =
    SERVER_LOCALES[language];

  expect({ language, hasServerLocale: Boolean(server) }).toEqual({
    language,
    hasServerLocale: true,
  });

  return [
    {
      surface: "the Dashboard",
      words: pickDefaultNames(readDashboardLocale(language)),
    },
    { surface: "a status page", words: readStatusPageWords(language) },
    { surface: "the server's messages", words: pickDefaultNames(server!) },
  ];
};

describe("OneUptime's default names in the Dashboard's locale files", () => {
  test("the severities a new project starts with are among the default names", () => {
    for (const name of DEFAULT_INCIDENT_SEVERITY_NAMES) {
      expect(DEFAULT_STATUS_NAMES).toContain(name);
    }
  });

  test("every default name is a key of en.json, written as itself", () => {
    const english: Record<string, string> = readDashboardLocale("en");
    const missing: Array<string> = DEFAULT_STATUS_NAMES.filter(
      (name: string): boolean => {
        return english[name] !== name;
      },
    );

    expect(missing).toEqual([]);
  });

  test.each([...DASHBOARD_LANGUAGES])(
    "%s words every default name",
    (language: string) => {
      const unworded: Array<string> = DEFAULT_STATUS_NAMES.filter(
        (name: string): boolean => {
          return !isWordedInDashboardLocale(name, language);
        },
      );

      expect({ language, unworded }).toEqual({ language, unworded: [] });
    },
  );
});

describe("OneUptime's default names read alike wherever they are read", () => {
  test("a status page looks every default name up by a key of its own", () => {
    const keys: Record<string, string> = readStatusPageNameKeys();

    expect(Object.keys(keys).sort()).toEqual([...DEFAULT_STATUS_NAMES].sort());
    expect(new Set(Object.values(keys)).size).toBe(DEFAULT_STATUS_NAMES.length);
  });

  test.each(["en", ...DASHBOARD_LANGUAGES])(
    "%s words every default name alike on the Dashboard, on a status page and in the server's messages",
    (language: string) => {
      const surfaces: Array<SurfaceWords> = readWordsOfEverySurface(language);
      const apart: Array<string> = [];

      for (const name of DEFAULT_STATUS_NAMES) {
        const words: Array<string | undefined> = surfaces.map(
          (surface: SurfaceWords): string | undefined => {
            return surface.words[name];
          },
        );

        if (
          !words[0] ||
          words.some((word: string | undefined): boolean => {
            return word !== words[0];
          })
        ) {
          apart.push(
            `${name}: ${surfaces
              .map((surface: SurfaceWords): string => {
                return `${surface.surface} ${surface.words[name]}`;
              })
              .join(", ")}`,
          );
        }
      }

      expect({ language, apart }).toEqual({ language, apart: [] });
    },
  );

  test.each(["en", ...DASHBOARD_LANGUAGES])(
    "%s gives no two default names one word, on the Dashboard, on a status page or in the server's messages",
    (language: string) => {
      const shared: Array<string> = [];

      for (const surface of readWordsOfEverySurface(language)) {
        // What the reader reads: the word, or the English where there is none.
        const wordOf: (name: string) => string = (name: string): string => {
          return (surface.words[name] || name).trim();
        };

        // The names each word stands for, by the word as a reader tells words apart.
        const namesByWord: Map<string, Array<string>> = new Map<
          string,
          Array<string>
        >();

        for (const name of DEFAULT_STATUS_NAMES) {
          const seen: string = wordOf(name).toLowerCase();

          namesByWord.set(seen, [...(namesByWord.get(seen) || []), name]);
        }

        for (const names of Array.from(namesByWord.values())) {
          if (names.length > 1) {
            shared.push(
              `${surface.surface}: ${wordOf(names[0]!)} is ${names.join(" and ")}`,
            );
          }
        }
      }

      expect({ language, shared }).toEqual({ language, shared: [] });
    },
  );
});
