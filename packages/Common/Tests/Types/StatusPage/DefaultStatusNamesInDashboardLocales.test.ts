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
import { STATUS_PAGE_LANGUAGES } from "../../Helpers/TranslatedLanguages";

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

/*
 * Every language a default name is read in, on any of the three: a
 * language one of them adds is checked the day it is added.
 */
const EVERY_LANGUAGE: ReadonlyArray<string> = Array.from(
  new Set<string>([
    "en",
    ...DASHBOARD_LANGUAGES,
    ...STATUS_PAGE_LANGUAGES,
    ...Object.keys(SERVER_LOCALES),
  ]),
);

type LocaleTree = { [key: string]: string | LocaleTree };

const readStatusPageLocale: (language: string) => LocaleTree = (
  language: string,
): LocaleTree => {
  return JSON.parse(
    fs.readFileSync(
      path.join(STATUS_PAGE_SOURCE, "Locales", `${language}.json`),
      "utf8",
    ),
  ) as LocaleTree;
};

// The value at a dotted key of a status page locale ("overview.operational").
const valueAt: (tree: LocaleTree, key: string) => string | undefined = (
  tree: LocaleTree,
  key: string,
): string | undefined => {
  let node: string | LocaleTree | undefined = tree;

  for (const part of key.split(".")) {
    if (!node || typeof node === "string") {
      return undefined;
    }

    node = node[part];
  }

  return typeof node === "string" ? node : undefined;
};

/*
 * The status page's keys, outside statusNames, whose English is a default
 * name as written: "overview.operational", what a resource with no status
 * reads (Overview, MonitorOverview), beside a monitor in the default
 * Operational status, which reads statusNames.operational.
 */
const readStatusPageKeysNamingADefault: () => Array<{
  key: string;
  name: string;
}> = (): Array<{ key: string; name: string }> => {
  const found: Array<{ key: string; name: string }> = [];
  const walk: (tree: LocaleTree, prefix: string) => void = (
    tree: LocaleTree,
    prefix: string,
  ): void => {
    for (const [key, value] of Object.entries(tree)) {
      const dotted: string = prefix ? `${prefix}.${key}` : key;

      if (typeof value !== "string") {
        if (dotted !== "statusNames") {
          walk(value, dotted);
        }
      } else if (DEFAULT_STATUS_NAMES.includes(value)) {
        found.push({ key: dotted, name: value });
      }
    }
  };

  walk(readStatusPageLocale("en"), "");

  return found;
};

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

  test("the Dashboard, a status page and the server's messages are read in the same languages", () => {
    const sorted: (languages: ReadonlyArray<string>) => Array<string> = (
      languages: ReadonlyArray<string>,
    ): Array<string> => {
      return [...languages].sort();
    };

    expect(sorted(["en", ...DASHBOARD_LANGUAGES])).toEqual(
      sorted(EVERY_LANGUAGE),
    );
    expect(sorted(["en", ...STATUS_PAGE_LANGUAGES])).toEqual(
      sorted(EVERY_LANGUAGE),
    );
    expect(sorted(Object.keys(SERVER_LOCALES))).toEqual(sorted(EVERY_LANGUAGE));
  });

  test.each(EVERY_LANGUAGE)(
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

  test.each(EVERY_LANGUAGE)(
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

  test("a status page names a default by the word its statusNames give it wherever else it says the name", () => {
    const found: Array<{ key: string; name: string }> =
      readStatusPageKeysNamingADefault();

    // overview.operational is one, so the walk reads the file.
    expect(found).toContainEqual({
      key: "overview.operational",
      name: "Operational",
    });
  });

  test.each(EVERY_LANGUAGE)(
    "%s words a default name alike wherever a status page says it",
    (language: string) => {
      const locale: LocaleTree = readStatusPageLocale(language);
      const words: DefaultNameWords = readStatusPageWords(language);
      const apart: Array<string> = [];

      for (const { key, name } of readStatusPageKeysNamingADefault()) {
        const word: string | undefined = valueAt(locale, key);

        if (word !== words[name]) {
          apart.push(`${key} is ${word}, ${name} is ${words[name]}`);
        }
      }

      expect({ language, apart }).toEqual({ language, apart: [] });
    },
  );
});
