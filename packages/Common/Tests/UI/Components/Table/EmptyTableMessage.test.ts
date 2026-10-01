import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  NOTHING_HERE_YET,
  NOTHING_MATCHES_SEARCH_OR_FILTERS,
  TranslateFunction,
  getEmptyTableMessage,
  toSentenceNoun,
} from "../../../../UI/Components/Table/EmptyTableMessage";

/*
 * The sentence an empty table shows when its page has not written one.
 *
 * It used to be glued together a word at a time -
 * `${tx("No")} ${plural} ${tx("yet.")}` - and every word was then looked up
 * on its own. "No" is also the answer to a question, so German read
 * "Nein monitors yet.", and no language gets word order or plural agreement
 * right that way. The helper now looks the WHOLE sentence up, falls back to a
 * sentence that needs no noun ("Nothing here yet."), and only builds the
 * sentence from the noun where neither is translated - which is English.
 *
 * The last block runs the helper against the real Dashboard locale files, so
 * a locale that loses one of the core lists' sentences, or a new core list
 * shipped without them, fails here rather than in front of a user.
 */

const IDENTITY: TranslateFunction = (value: string): string => {
  return value;
};

type Dictionary = Record<string, string>;

const translatorFor: (dictionary: Dictionary) => TranslateFunction = (
  dictionary: Dictionary,
): TranslateFunction => {
  return (value: string): string => {
    return dictionary[value] ?? value;
  };
};

describe("toSentenceNoun", () => {
  test.each([
    ["Monitors", "monitors"],
    ["Status Pages", "status pages"],
    ["On-Call Duty Policies", "on-call duty policies"],
    ["Scheduled Maintenance Events", "scheduled maintenance events"],
  ])(
    "lower-cases an ordinary plural: %s -> %s",
    (label: string, noun: string) => {
      expect(toSentenceNoun(label)).toBe(noun);
    },
  );

  /*
   * The old code lower-cased every letter, so the SLO list's default
   * sentence would have read "No slos yet.".
   */
  test.each([
    ["SLOs", "SLOs"],
    ["API Keys", "API keys"],
    ["SSO Configs", "SSO configs"],
    ["Service Level Objectives", "service level objectives"],
  ])("keeps an acronym as written: %s -> %s", (label: string, noun: string) => {
    expect(toSentenceNoun(label)).toBe(noun);
  });

  test("collapses runs of spaces and trims the ends", () => {
    expect(toSentenceNoun("  Status    Pages  ")).toBe("status pages");
  });

  test("an empty or blank label gives an empty noun", () => {
    expect(toSentenceNoun("")).toBe("");
    expect(toSentenceNoun("   ")).toBe("");
  });
});

describe("getEmptyTableMessage in English (every lookup returns its key)", () => {
  test('says "No <plural> yet." for a table with nothing in it', () => {
    expect(
      getEmptyTableMessage({
        pluralLabel: "Monitors",
        isFiltered: false,
        translate: IDENTITY,
      }),
    ).toBe("No monitors yet.");
  });

  test("says the search or filters missed when one of them emptied the table", () => {
    expect(
      getEmptyTableMessage({
        pluralLabel: "Monitors",
        isFiltered: true,
        translate: IDENTITY,
      }),
    ).toBe("No monitors match your search or filters.");
  });

  test.each([
    ["SLOs", "No SLOs yet."],
    ["API Keys", "No API keys yet."],
    ["On-Call Duty Policies", "No on-call duty policies yet."],
    ["On-Call Schedules", "No on-call schedules yet."],
  ])("builds a natural sentence from %s", (label: string, sentence: string) => {
    expect(
      getEmptyTableMessage({
        pluralLabel: label,
        isFiltered: false,
        translate: IDENTITY,
      }),
    ).toBe(sentence);
  });

  test('falls back to "items" when the table has no plural label at all', () => {
    expect(
      getEmptyTableMessage({
        pluralLabel: "   ",
        isFiltered: false,
        translate: IDENTITY,
      }),
    ).toBe("No items yet.");
    expect(
      getEmptyTableMessage({
        pluralLabel: "",
        isFiltered: true,
        translate: IDENTITY,
      }),
    ).toBe("No items match your search or filters.");
  });

  /*
   * English maps the noun-free sentences to themselves too (they are keys in
   * en.json), and that must NOT be mistaken for a translation - English
   * readers get the sentence with the noun in it.
   */
  test("does not prefer the noun-free sentence when it only looks up to itself", () => {
    const english: TranslateFunction = translatorFor({
      [NOTHING_HERE_YET]: NOTHING_HERE_YET,
      [NOTHING_MATCHES_SEARCH_OR_FILTERS]: NOTHING_MATCHES_SEARCH_OR_FILTERS,
      "No monitors yet.": "No monitors yet.",
    });

    expect(
      getEmptyTableMessage({
        pluralLabel: "Monitors",
        isFiltered: false,
        translate: english,
      }),
    ).toBe("No monitors yet.");
    expect(
      getEmptyTableMessage({
        pluralLabel: "Monitors",
        isFiltered: true,
        translate: english,
      }),
    ).toBe("No monitors match your search or filters.");
  });
});

describe("getEmptyTableMessage in another language", () => {
  const GERMAN: Dictionary = {
    "No monitors yet.": "Noch keine Monitore.",
    [NOTHING_HERE_YET]: "Hier ist noch nichts.",
    [NOTHING_MATCHES_SEARCH_OR_FILTERS]:
      "Nichts entspricht Ihrer Suche oder Ihren Filtern.",
    // What the old word-by-word lookup used to pick up.
    No: "Nein",
    "yet.": "noch.",
    Monitors: "Monitore",
  };

  test("the whole sentence's own translation wins", () => {
    expect(
      getEmptyTableMessage({
        pluralLabel: "Monitors",
        isFiltered: false,
        translate: translatorFor(GERMAN),
      }),
    ).toBe("Noch keine Monitore.");
  });

  test("a sentence the locale does not have falls back to the noun-free one", () => {
    expect(
      getEmptyTableMessage({
        pluralLabel: "Widgets",
        isFiltered: false,
        translate: translatorFor(GERMAN),
      }),
    ).toBe("Hier ist noch nichts.");
  });

  test("an emptied search gets the noun-free search sentence", () => {
    expect(
      getEmptyTableMessage({
        pluralLabel: "Monitors",
        isFiltered: true,
        translate: translatorFor(GERMAN),
      }),
    ).toBe("Nichts entspricht Ihrer Suche oder Ihren Filtern.");
  });

  test.each([
    ["Monitors", false],
    ["Monitors", true],
    ["Widgets", false],
    ["Widgets", true],
  ])(
    'never glues a translated "No" onto an English noun (%s, filtered: %s)',
    (label: string, isFiltered: boolean) => {
      const message: string = getEmptyTableMessage({
        pluralLabel: label,
        isFiltered: isFiltered,
        translate: translatorFor(GERMAN),
      });

      expect(message).not.toContain("Nein");
      expect(message).not.toContain("yet");
      expect(message).not.toContain(label.toLowerCase());
    },
  );

  /*
   * The worst case: a locale that has neither the sentence nor the
   * noun-free fallback. It gets English, whole - never a mixture.
   */
  test("a locale with nothing to offer gets the English sentence whole", () => {
    const sparse: TranslateFunction = translatorFor({ No: "Nein" });

    expect(
      getEmptyTableMessage({
        pluralLabel: "Monitors",
        isFiltered: false,
        translate: sparse,
      }),
    ).toBe("No monitors yet.");
  });

  test("an empty translation is treated as missing, not shown", () => {
    const blank: TranslateFunction = translatorFor({
      "No monitors yet.": "",
      [NOTHING_HERE_YET]: "",
    });

    expect(
      getEmptyTableMessage({
        pluralLabel: "Monitors",
        isFiltered: false,
        translate: blank,
      }),
    ).toBe("No monitors yet.");
  });
});

/*
 * The real Dashboard locales. Every one of these plural labels is a list a
 * new user lands on, and its default sentence has to exist, whole, in every
 * language - otherwise that language falls back to "Nothing here yet.",
 * which is correct but vaguer than it needs to be.
 */
describe("the Dashboard locale files", () => {
  const LOCALES_DIR: string = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "..",
    "App",
    "FeatureSet",
    "Dashboard",
    "src",
    "Locales",
  );

  const localeCodes: Array<string> = fs
    .readdirSync(LOCALES_DIR)
    .filter((file: string): boolean => {
      return file.endsWith(".json");
    })
    .map((file: string): string => {
      return file.replace(/\.json$/, "");
    })
    .sort();

  const locales: Record<string, Record<string, unknown>> = {};

  for (const code of localeCodes) {
    locales[code] = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
    ) as Record<string, unknown>;
  }

  // The same flat-key lookup useTranslateValue does: a miss gives the key.
  const translateIn: (code: string) => TranslateFunction = (
    code: string,
  ): TranslateFunction => {
    return (value: string): string => {
      const found: unknown = locales[code]![value];
      return typeof found === "string" ? found : value;
    };
  };

  const nonEnglish: Array<string> = localeCodes.filter(
    (code: string): boolean => {
      return code !== "en";
    },
  );

  const CORE_LISTS: Array<[string, string]> = [
    ["Monitors", "No monitors yet."],
    ["Incidents", "No incidents yet."],
    ["Alerts", "No alerts yet."],
    ["Status Pages", "No status pages yet."],
    ["On-Call Duty Policies", "No on-call duty policies yet."],
    ["On-Call Schedules", "No on-call schedules yet."],
    ["Scheduled Maintenance Events", "No scheduled maintenance events yet."],
    ["Workflows", "No workflows yet."],
    ["Dashboards", "No dashboards yet."],
    ["Teams", "No teams yet."],
    ["Services", "No services yet."],
    ["Runbooks", "No runbooks yet."],
  ];

  test("all 17 locales are here", () => {
    expect(localeCodes).toHaveLength(17);
    expect(localeCodes).toContain("en");
  });

  test.each(CORE_LISTS)(
    "English builds the %s sentence and has it as a key",
    (label: string, sentence: string) => {
      expect(
        getEmptyTableMessage({
          pluralLabel: label,
          isFiltered: false,
          translate: translateIn("en"),
        }),
      ).toBe(sentence);
      expect(locales["en"]![sentence]).toBe(sentence);
    },
  );

  test.each(nonEnglish)(
    "%s shows its own whole sentence for every core list",
    (code: string) => {
      const noWord: unknown = locales[code]!["No"];

      for (const [label, sentence] of CORE_LISTS) {
        const message: string = getEmptyTableMessage({
          pluralLabel: label,
          isFiltered: false,
          translate: translateIn(code),
        });
        const ownSentence: unknown = locales[code]![sentence];

        // Pairs keep the failing list in the assertion message.
        expect([label, typeof ownSentence]).toEqual([label, "string"]);
        expect([label, message]).toEqual([label, ownSentence]);
        expect([label, message]).not.toEqual([label, sentence]);
        expect(message).not.toContain(" yet.");

        /*
         * The word-by-word bug started the sentence with the locale's word
         * for the answer "No" ("Nein ...").
         */
        if (typeof noWord === "string" && noWord !== "No") {
          expect(message.startsWith(`${noWord} `)).toBe(false);
        }
      }
    },
  );

  test.each(nonEnglish)(
    "%s falls back to its own noun-free sentences for any other list",
    (code: string) => {
      const nothingHere: unknown = locales[code]![NOTHING_HERE_YET];
      const nothingMatches: unknown =
        locales[code]![NOTHING_MATCHES_SEARCH_OR_FILTERS];

      expect(typeof nothingHere).toBe("string");
      expect(typeof nothingMatches).toBe("string");
      expect(nothingHere).not.toBe(NOTHING_HERE_YET);
      expect(nothingMatches).not.toBe(NOTHING_MATCHES_SEARCH_OR_FILTERS);

      expect(
        getEmptyTableMessage({
          pluralLabel: "Widgets",
          isFiltered: false,
          translate: translateIn(code),
        }),
      ).toBe(nothingHere);
      expect(
        getEmptyTableMessage({
          pluralLabel: "Widgets",
          isFiltered: true,
          translate: translateIn(code),
        }),
      ).toBe(nothingMatches);
    },
  );

  /*
   * No locale carries a "No <plural> match your search or filters." sentence
   * of its own, so every language says the noun-free one after a search
   * misses - for the core lists too.
   */
  test.each(nonEnglish)(
    "%s says the noun-free search sentence when a core list's search misses",
    (code: string) => {
      for (const [label] of CORE_LISTS) {
        expect([
          label,
          getEmptyTableMessage({
            pluralLabel: label,
            isFiltered: true,
            translate: translateIn(code),
          }),
        ]).toEqual([label, locales[code]![NOTHING_MATCHES_SEARCH_OR_FILTERS]]);
      }
    },
  );

  test("English keeps the noun for an unknown list", () => {
    expect(
      getEmptyTableMessage({
        pluralLabel: "Widgets",
        isFiltered: false,
        translate: translateIn("en"),
      }),
    ).toBe("No widgets yet.");
    expect(
      getEmptyTableMessage({
        pluralLabel: "Widgets",
        isFiltered: true,
        translate: translateIn("en"),
      }),
    ).toBe("No widgets match your search or filters.");
  });
});
