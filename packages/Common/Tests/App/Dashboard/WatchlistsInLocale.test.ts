import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import * as WatchlistsCopy from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Watchlists/WatchlistsCopy";
import {
  SIGMA_MODIFIER_DOCS,
  SigmaModifierDoc,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/HowItWorks/DetectionRulesGuide";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SecurityWatchlist from "../../../Models/DatabaseModels/SecurityWatchlist";
import SecurityWatchlistItem from "../../../Models/DatabaseModels/SecurityWatchlistItem";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import {
  getSecurityWatchlistNameProblem,
  getSecurityWatchlistNoteProblem,
  getSecurityWatchlistProblems,
  getSecurityWatchlistSizeProblem,
  getSecurityWatchlistValueProblem,
  SECURITY_WATCHLIST_MESSAGES,
  SecurityWatchlistProblem,
  SecurityWatchlistShape,
  SecurityWatchlistSource,
} from "../../../Types/SecurityEvent/SecurityWatchlist";
import { PluralTemplate } from "../../../UI/Utils/TranslateTemplate";

/*
 * EVERY WORD OF WATCHLISTS IS EVERY LANGUAGE'S OWN: the list and its
 * common lists to start with, the form, a list's page and its Import
 * Values dialog, the line under a rule's YAML, the guide's |expand row,
 * the two models' names and titles, and every problem the shared rules
 * answer a form, an import or a save with - read from the Dashboard's
 * locale files themselves, so a key that lost its translation, kept the
 * English or dropped a placeholder is caught.
 *
 * A watchlist is named the way rules write it, so a name in an example
 * (vip_users, '%vip_users%', svc-*, 10.20.0.0/16) stays exactly as written
 * in every language: a reader copies it into a rule.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

// Japanese, Korean and Chinese read no "one" form: theirs may say the same.
const WITHOUT_ONE_FORM: Array<string> = ["ja", "ko", "zh-CN", "zh-TW"];

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const ENGLISH: Record<string, string> = readLocale("en");

function isPlural(value: unknown): value is PluralTemplate {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as PluralTemplate).one === "string" &&
    typeof (value as PluralTemplate).other === "string"
  );
}

// The sentences the copy exports, and its plural sentences; test ids aside.
const COPY_SENTENCES: Array<string> = [];
const PLURALS: Array<PluralTemplate> = [];

for (const [name, value] of Object.entries(
  WatchlistsCopy as unknown as Record<string, unknown>,
)) {
  if (name.endsWith("TEST_IDS")) {
    continue;
  }

  if (typeof value === "string") {
    COPY_SENTENCES.push(value);
  } else if (isPlural(value)) {
    PLURALS.push(value);
  }
}

/*
 * Every problem the shared rules can answer with, found by asking about a
 * value, a note, a name, a list and a list's size wrong in each way they
 * can be.
 */
const WRONG_VALUES: Array<{ value: unknown; entityType: unknown }> = [
  { value: "", entityType: SecurityEntityType.User },
  { value: "*", entityType: SecurityEntityType.User },
  { value: "x".repeat(257), entityType: SecurityEntityType.User },
  { value: "a\tb", entityType: SecurityEntityType.User },
  { value: "not an address", entityType: SecurityEntityType.IpAddress },
  { value: "not-a-hash", entityType: SecurityEntityType.FileHash },
];

const WRONG_LISTS: Array<SecurityWatchlistShape> = [
  { name: "", entityType: "Spaceship" },
  { name: "n".repeat(51), entityType: SecurityEntityType.User },
  { name: "vip users", entityType: SecurityEntityType.User },
  {
    name: "vip_users",
    entityType: SecurityEntityType.User,
    description: "d".repeat(501),
  },
  {
    name: "vip_users",
    entityType: SecurityEntityType.User,
    source: "Somewhere",
  },
  {
    name: "vip_users",
    entityType: SecurityEntityType.User,
    source: SecurityWatchlistSource.ThreatIntelFeed,
  },
];

const PROBLEMS: Array<string> = Array.from(
  new Set(
    [
      ...WRONG_VALUES.map(
        (data: { value: unknown; entityType: unknown }): string | null => {
          return getSecurityWatchlistValueProblem(data);
        },
      ),
      getSecurityWatchlistNoteProblem("n".repeat(501)),
      getSecurityWatchlistNameProblem("1st_list"),
      ...WRONG_LISTS.flatMap((list: SecurityWatchlistShape): Array<string> => {
        return getSecurityWatchlistProblems(list).map(
          (problem: SecurityWatchlistProblem): string => {
            return problem.message;
          },
        );
      }),
      getSecurityWatchlistSizeProblem({ total: 5001, patterns: 0, ranges: 0 }),
      getSecurityWatchlistSizeProblem({ total: 101, patterns: 101, ranges: 0 }),
      getSecurityWatchlistSizeProblem({ total: 101, patterns: 0, ranges: 101 }),
    ].filter((problem: string | null): problem is string => {
      return Boolean(problem);
    }),
  ),
).sort();

// The guide's row for |expand: what the modifier means, a key of its own.
const EXPAND_DOC: SigmaModifierDoc | undefined = SIGMA_MODIFIER_DOCS.find(
  (doc: SigmaModifierDoc): boolean => {
    return doc.modifier === "expand";
  },
);

// Every model's own columns (BaseModel): not these models' words.
const BASE_COLUMNS: ReadonlyArray<string> = [
  "_id",
  "createdAt",
  "updatedAt",
  "deletedAt",
  "version",
];

// Everything a reader sees of a model: its names, description and titles.
function modelTexts(model: BaseModel): Array<string> {
  const texts: Array<string> = [];

  for (const text of [
    model.singularName,
    model.pluralName,
    model.tableDescription,
  ]) {
    if (text) {
      texts.push(text);
    }
  }

  for (const column of model.getTableColumns().columns) {
    if (BASE_COLUMNS.includes(column)) {
      continue;
    }

    const title: string | undefined =
      model.getTableColumnMetadata(column)?.title;

    if (title) {
      texts.push(title);
    }
  }

  return texts;
}

const MODEL_TEXTS: Array<string> = [
  ...modelTexts(new SecurityWatchlist()),
  ...modelTexts(new SecurityWatchlistItem()),
];

const SENTENCES: Array<string> = Array.from(
  new Set([
    ...COPY_SENTENCES,
    ...PROBLEMS,
    ...(EXPAND_DOC ? [EXPAND_DOC.meaning] : []),
    ...MODEL_TEXTS,
  ]),
);

// A rule's name for a list: written the same in every language.
const MAY_STAY_AS_WRITTEN: Array<string> = ["vip_users"];

// A word some languages write as English does.
const SAME_WORD_IN: Record<string, Array<string>> = {
  Description: ["fr"],
  Hosts: ["de", "es", "pt", "nl"],
  Name: ["de"],
  Note: ["fr", "da"],
  Project: ["nl"],
  Source: ["fr"],
  URLs: ["de", "pt"],
};

// What a reader copies into a rule, exactly as written, in every language.
const WRITTEN_AS_IS: Record<string, Array<string>> = {
  "What rules call it, between % signs: '%vip_users%'. Letters, digits and underscores.":
    ["'%vip_users%'"],
  "Enter a name, such as vip_users.": ["vip_users"],
  "Use letters, digits and underscores, starting with a letter, such as vip_users.":
    ["vip_users"],
  "Matched whatever the case. * stands for any run of characters: svc-* matches every service account.":
    ["svc-*", "*"],
  "Matched whatever the case. A value can be a range such as 10.20.0.0/16, or a pattern with *.":
    ["10.20.0.0/16", "*"],
  "Enter an IP address, a range such as 10.20.0.0/16, or a pattern with *.": [
    "10.20.0.0/16",
    "*",
  ],
  "Enter an MD5, SHA-1, SHA-256 or SHA-512 hash.": [
    "MD5",
    "SHA-1",
    "SHA-256",
    "SHA-512",
  ],
  "MD5, SHA-1, SHA-256 and SHA-512 hashes, matched whatever the case.": [
    "MD5",
    "SHA-1",
    "SHA-256",
    "SHA-512",
  ],
  "Paste values, one a line, or choose a .txt or .csv file. A note can follow a comma: alice@example.com, CFO.":
    [".txt", ".csv", "alice@example.com, CFO"],
  "The field is on one of your watchlists, named between % signs. Used alone: the list's values say how they match.":
    ["%"],
};

function placeholders(text: string): Array<string> {
  return Array.from(new Set(text.match(/\{\{[a-zA-Z]+\}\}/g) || [])).sort();
}

const LOCALES: Record<string, Record<string, string>> = {};

for (const language of LANGUAGES) {
  LOCALES[language] = readLocale(language);
}

describe("the words there are", () => {
  test("every problem a form, an import or a save can show, each a sentence of its own", () => {
    expect(PROBLEMS).toEqual(
      [
        "A description is at most 500 characters.",
        "A name is at most 50 characters.",
        "A note is at most 500 characters.",
        "A threat intel feed carries IP addresses, file hashes, domains and URLs. Keep a list of anything else by hand.",
        "A value is at most 256 characters.",
        "A value is one line, without tabs.",
        "A value of only * would match everything.",
        "A watchlist holds at most 100 address ranges.",
        "A watchlist holds at most 100 values with *.",
        "A watchlist holds at most 5,000 values. Follow a threat intel feed for a longer list.",
        "Choose the threat intel feed to follow.",
        "Choose what the watchlist holds.",
        "Choose where the values come from.",
        "Enter a name, such as vip_users.",
        "Enter a value.",
        "Enter an IP address, a range such as 10.20.0.0/16, or a pattern with *.",
        "Enter an MD5, SHA-1, SHA-256 or SHA-512 hash.",
        "Use letters, digits and underscores, starting with a letter, such as vip_users.",
      ].sort(),
    );
  });

  test("every message the shared rules keep is one a form can show", () => {
    for (const entry of Object.values(SECURITY_WATCHLIST_MESSAGES)) {
      expect(PROBLEMS).toContain(entry.message);
    }
  });

  test("the guide has its |expand row", () => {
    expect(EXPAND_DOC?.example).toBe("principalUser|expand: '%vip_users%'");
  });

  test("the copy's words, its plurals and the models' titles", () => {
    expect(COPY_SENTENCES.length).toBeGreaterThan(80);
    expect(PLURALS.length).toBe(11);
    expect(MODEL_TEXTS).toEqual(
      expect.arrayContaining([
        "Watchlist",
        "Watchlists",
        "Watchlist Value",
        "Watchlist Values",
        "Holds",
        "Value Count",
        "Watchlist ID",
      ]),
    );
  });
});

describe("English holds every sentence under its own words", () => {
  test.each(SENTENCES)("%s", (sentence: string) => {
    expect(ENGLISH[sentence]).toBe(sentence);
  });

  test.each(PLURALS)("the plural %j", (plural: PluralTemplate) => {
    expect(ENGLISH[plural.other]).toBe(plural.other);
    expect(ENGLISH[`${plural.other}_one`]).toBe(plural.one);
  });
});

describe.each(LANGUAGES)("%s words every sentence", (language: string) => {
  const locale: Record<string, string> = LOCALES[language]!;

  test.each(SENTENCES)("%s", (sentence: string) => {
    const translated: string | undefined = locale[sentence];

    expect(translated).toBeDefined();
    expect(translated!.trim().length).toBeGreaterThan(0);

    if (
      !MAY_STAY_AS_WRITTEN.includes(sentence) &&
      !(SAME_WORD_IN[sentence] || []).includes(language)
    ) {
      expect(translated).not.toBe(sentence);
    }

    expect(placeholders(translated!)).toEqual(placeholders(sentence));

    for (const written of WRITTEN_AS_IS[sentence] || []) {
      expect(translated).toContain(written);
    }
  });

  test.each(PLURALS)("the plural %j", (plural: PluralTemplate) => {
    const other: string | undefined = locale[plural.other];
    const one: string | undefined = locale[`${plural.other}_one`];

    expect(other).toBeDefined();
    expect(one).toBeDefined();
    expect(other).not.toBe(plural.other);
    expect(placeholders(other!)).toEqual(placeholders(plural.other));
    expect(placeholders(one!)).toEqual(placeholders(plural.one));

    if (!WITHOUT_ONE_FORM.includes(language)) {
      expect(one).not.toBe(plural.one);
    }
  });
});

describe("a watchlist's words are its own", () => {
  test("the kept-as-written words are still the copy's words", () => {
    for (const sentence of [
      ...MAY_STAY_AS_WRITTEN,
      ...Object.keys(SAME_WORD_IN),
      ...Object.keys(WRITTEN_AS_IS),
    ]) {
      expect({ sentence, shown: SENTENCES.includes(sentence) }).toEqual({
        sentence,
        shown: true,
      });
    }
  });

  test("the link under a rule's YAML names the Watchlists page as the menu does", () => {
    for (const language of LANGUAGES) {
      const locale: Record<string, string> = LOCALES[language]!;
      const page: string = locale["Watchlists"]!.toLowerCase();
      const link: string = locale["Create it in Watchlists"]!.toLowerCase();

      // Russian declines the page's name after в: в списках отслеживания.
      if (language === "ru") {
        expect(link).toContain("списках отслеживания");
        continue;
      }

      expect({ language, link: link.includes(page) }).toEqual({
        language,
        link: true,
      });
    }
  });

  test("German says Beobachtungsliste, Japanese ウォッチリスト, Chinese 监视列表 and 監看清單", () => {
    expect(LOCALES["de"]!["Watchlists"]).toBe("Beobachtungslisten");
    expect(LOCALES["ja"]!["Watchlists"]).toBe("ウォッチリスト");
    expect(LOCALES["zh-CN"]!["Watchlists"]).toBe("监视列表");
    expect(LOCALES["zh-TW"]!["Watchlists"]).toBe("監看清單");
  });
});
