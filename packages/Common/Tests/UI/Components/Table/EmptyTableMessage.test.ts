import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  COULD_NOT_LOAD_THIS_LIST,
  EmptyMessageParts,
  LONGEST_HEADLINE,
  NOTHING_HERE_YET,
  NOTHING_MATCHES_SEARCH_OR_FILTERS,
  TranslateFunction,
  getEmptyMessageParts,
  getEmptyTableMessage,
  getEmptyTableTitle,
  getLoadErrorTitle,
  splitEmptyMessage,
  toHeadline,
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

  /*
   * A failed load is headed in the reader's language too. No locale has a
   * sentence per list, so every one of them says its noun-free sentence -
   * as a heading, without the full stop the key keeps.
   */
  test.each(nonEnglish)(
    "%s heads a failed load with its own noun-free sentence",
    (code: string) => {
      const ownSentence: unknown = locales[code]![COULD_NOT_LOAD_THIS_LIST];

      expect(typeof ownSentence).toBe("string");
      expect(ownSentence).not.toBe(COULD_NOT_LOAD_THIS_LIST);

      const title: string = getLoadErrorTitle({
        pluralLabel: "Monitors",
        translate: translateIn(code),
      });

      expect(title).toBe(toHeadline(ownSentence as string));
      expect(title).not.toContain("monitors");
    },
  );

  test.each(nonEnglish)(
    "%s heads an empty core list with its own sentence, without the stop",
    (code: string) => {
      for (const [label, sentence] of CORE_LISTS) {
        const title: string = getEmptyTableTitle({
          pluralLabel: label,
          isFiltered: false,
          translate: translateIn(code),
        });

        expect([label, title]).toEqual([
          label,
          toHeadline(locales[code]![sentence] as string),
        ]);
      }
    },
  );

  test("English heads a failed load with the list's own noun", () => {
    expect(
      getLoadErrorTitle({
        pluralLabel: "Incident Measurements",
        translate: translateIn("en"),
      }),
    ).toBe("Couldn't load incident measurements");
  });
});

describe("toHeadline", () => {
  test.each([
    ["No monitors yet.", "No monitors yet"],
    ["Hier ist noch nichts.", "Hier ist noch nichts"],
    ["まだ何もありません。", "まだ何もありません"],
    ["这里还没有内容。", "这里还没有内容"],
    ["यहां अभी कुछ नहीं है।", "यहां अभी कुछ नहीं है"],
    ["Fullwidth stop．", "Fullwidth stop"],
  ])("drops a sentence's full stop: %s", (sentence: string, title: string) => {
    expect(toHeadline(sentence)).toBe(title);
  });

  test.each([
    ["Nice work!", "Nice work!"],
    ["Is anything here?", "Is anything here?"],
    ["Loading...", "Loading..."],
    ["No monitors yet", "No monitors yet"],
  ])("keeps what says something: %s", (sentence: string, title: string) => {
    expect(toHeadline(sentence)).toBe(title);
  });

  test("trims the ends, before and after the stop goes", () => {
    expect(toHeadline("  No monitors yet.  ")).toBe("No monitors yet");
    expect(toHeadline("No monitors yet .")).toBe("No monitors yet");
  });

  test("an empty or blank sentence stays empty", () => {
    expect(toHeadline("")).toBe("");
    expect(toHeadline("   ")).toBe("");
    expect(toHeadline(".")).toBe("");
  });
});

describe("getEmptyTableTitle", () => {
  test("is the table's own sentence, as a heading", () => {
    expect(
      getEmptyTableTitle({
        pluralLabel: "Incident Measurements",
        isFiltered: false,
        translate: IDENTITY,
      }),
    ).toBe("No incident measurements yet");
    expect(
      getEmptyTableTitle({
        pluralLabel: "SLOs",
        isFiltered: true,
        translate: IDENTITY,
      }),
    ).toBe("No SLOs match your search or filters");
  });

  test("a locale's whole sentence and its noun-free one are headed the same way", () => {
    expect(
      getEmptyTableTitle({
        pluralLabel: "Monitors",
        isFiltered: false,
        translate: translatorFor({ "No monitors yet.": "Noch keine Monitore." }),
      }),
    ).toBe("Noch keine Monitore");
    expect(
      getEmptyTableTitle({
        pluralLabel: "Widgets",
        isFiltered: true,
        translate: translatorFor({
          [NOTHING_MATCHES_SEARCH_OR_FILTERS]:
            "Nichts entspricht Ihrer Suche oder Ihren Filtern.",
        }),
      }),
    ).toBe("Nichts entspricht Ihrer Suche oder Ihren Filtern");
  });
});

describe("getLoadErrorTitle", () => {
  test("names what failed to load, in English", () => {
    expect(
      getLoadErrorTitle({ pluralLabel: "Monitors", translate: IDENTITY }),
    ).toBe("Couldn't load monitors");
    expect(
      getLoadErrorTitle({ pluralLabel: "API Keys", translate: IDENTITY }),
    ).toBe("Couldn't load API keys");
  });

  test('falls back to "items" when the table has no plural label', () => {
    expect(getLoadErrorTitle({ pluralLabel: "", translate: IDENTITY })).toBe(
      "Couldn't load items",
    );
  });

  test("a locale's whole sentence wins, then its noun-free one", () => {
    expect(
      getLoadErrorTitle({
        pluralLabel: "Monitors",
        translate: translatorFor({
          "Couldn't load monitors.": "Monitore konnten nicht geladen werden.",
          [COULD_NOT_LOAD_THIS_LIST]: "Diese Liste konnte nicht geladen werden.",
        }),
      }),
    ).toBe("Monitore konnten nicht geladen werden");
    expect(
      getLoadErrorTitle({
        pluralLabel: "Monitors",
        translate: translatorFor({
          [COULD_NOT_LOAD_THIS_LIST]: "Diese Liste konnte nicht geladen werden.",
        }),
      }),
    ).toBe("Diese Liste konnte nicht geladen werden");
  });

  test("never looks a word up on its own", () => {
    const looked: Array<string> = [];

    getLoadErrorTitle({
      pluralLabel: "Monitors",
      translate: (value: string): string => {
        looked.push(value);
        return value;
      },
    });

    expect(looked).toEqual(["Couldn't load monitors.", COULD_NOT_LOAD_THIS_LIST]);
  });
});

describe("splitEmptyMessage: a page's own message as a title and a description", () => {
  test("one sentence is the title alone, headed without its stop", () => {
    expect(splitEmptyMessage("No custom fields found.")).toEqual({
      title: "No custom fields found",
    });
    expect(splitEmptyMessage("No activity")).toEqual({ title: "No activity" });
  });

  test("the first sentence heads it, the rest describes it", () => {
    expect(
      splitEmptyMessage(
        "No site types yet. Add one to start describing your site hierarchy.",
      ),
    ).toEqual({
      title: "No site types yet",
      description: "Add one to start describing your site hierarchy.",
    });
  });

  test("everything after the first sentence stays in the description", () => {
    const parts: EmptyMessageParts = splitEmptyMessage(
      "No usage history found. Maybe you have not used Telemetry features yet. Please wait until the end of the day.",
    );

    expect(parts.title).toBe("No usage history found");
    expect(parts.description).toBe(
      "Maybe you have not used Telemetry features yet. Please wait until the end of the day.",
    );
  });

  test("an exclamation ends a sentence too, and keeps its mark", () => {
    expect(splitEmptyMessage("Nice work! No Active Alerts so far.")).toEqual({
      title: "Nice work!",
      description: "No Active Alerts so far.",
    });
  });

  test.each([
    ["Add a probe, e.g. a global probe."],
    ["Version 1.2 is required. ok"],
    ["Send spans to otel.example.com first"],
    ["Use host:port, i.e. db.internal:5432."],
  ])("a stop not followed by a new sentence does not split: %s", (message: string) => {
    expect(splitEmptyMessage(message).description).toBeUndefined();
  });

  test("a sentence may start with a digit or a quote", () => {
    expect(splitEmptyMessage("No runs yet. 3 are queued.")).toEqual({
      title: "No runs yet",
      description: "3 are queued.",
    });
    expect(
      splitEmptyMessage('No executions yet. "Run Now" starts one.'),
    ).toEqual({
      title: "No executions yet",
      description: '"Run Now" starts one.',
    });
  });

  test("Chinese and Japanese sentences end on their own full stop", () => {
    expect(
      splitEmptyMessage(
        "アクティブなエピソードはありません。すべてのエピソードは解決済みです。",
      ),
    ).toEqual({
      title: "アクティブなエピソードはありません",
      description: "すべてのエピソードは解決済みです。",
    });
    expect(splitEmptyMessage("没有活动片段。所有片段均已解决。")).toEqual({
      title: "没有活动片段",
      description: "所有片段均已解决。",
    });
  });

  test("Hindi and Persian sentences split where a reader would", () => {
    expect(
      splitEmptyMessage("कोई सक्रिय एपिसोड नहीं। सभी एपिसोड सुलझाए गए हैं।"),
    ).toEqual({
      title: "कोई सक्रिय एपिसोड नहीं",
      description: "सभी एपिसोड सुलझाए गए हैं।",
    });
    expect(
      splitEmptyMessage("هیچ اپیزود فعالی نیست. همه اپیزودها برطرف شده‌اند."),
    ).toEqual({
      title: "هیچ اپیزود فعالی نیست",
      description: "همه اپیزودها برطرف شده‌اند.",
    });
  });

  test("German capitals after a stop split, its lower case does not", () => {
    expect(
      splitEmptyMessage("Keine aktiven Episoden. Alle Episoden sind behoben."),
    ).toEqual({
      title: "Keine aktiven Episoden",
      description: "Alle Episoden sind behoben.",
    });
    expect(
      splitEmptyMessage("Fügen Sie z. B. eine Sonde hinzu.").description,
    ).toBeUndefined();
  });

  test("surrounding white space is not part of either half", () => {
    expect(splitEmptyMessage("  No probes yet.   Add one.  ")).toEqual({
      title: "No probes yet",
      description: "Add one.",
    });
  });
});

describe("getEmptyMessageParts", () => {
  test("splits a message whose first sentence fits a heading", () => {
    expect(
      getEmptyMessageParts({
        message: "No SLOs yet. Create one.",
        defaultTitle: "No SLOs yet",
      }),
    ).toEqual({ title: "No SLOs yet", description: "Create one." });
  });

  /*
   * "No burn rate rules on this SLO - nothing will page anyone when the
   * error budget starts burning." is a paragraph, not a heading.
   */
  test("a first sentence too long for a heading goes under the table's own title", () => {
    const longSentence: string = `No burn rate rules on this SLO ${"and more words ".repeat(8)}here.`;
    const message: string = `${longSentence} Create a fast-burn rule.`;

    expect(longSentence.length).toBeGreaterThan(LONGEST_HEADLINE);
    expect(
      getEmptyMessageParts({
        message: message,
        defaultTitle: "No burn rate rules yet",
      }),
    ).toEqual({ title: "No burn rate rules yet", description: message });
  });

  test("a single long sentence is a description too", () => {
    const message: string = `Please wait ${"while things refresh ".repeat(8)}now.`;

    expect(
      getEmptyMessageParts({ message: `  ${message}  `, defaultTitle: "No users yet" }),
    ).toEqual({ title: "No users yet", description: message });
  });

  test("exactly the longest heading still heads the state", () => {
    const title: string = "x".repeat(LONGEST_HEADLINE);

    expect(
      getEmptyMessageParts({ message: `${title}.`, defaultTitle: "Default" }),
    ).toEqual({ title: title });
  });
});
