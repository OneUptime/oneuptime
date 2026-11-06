import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  createTranslator,
  getListSeparator,
  Translator,
} from "../../../Types/Translator";
import { formatDroppedScopeHint as formatLogsHint } from "../../../../App/FeatureSet/Dashboard/src/Utils/LogsCrossSignalPivot";
import {
  COMPANION_SCOPE_NOTES,
  formatDroppedScopeHint as formatMetricsHint,
  getAttributeScopeNote,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/MetricsCrossSignalPivot";
import {
  COMPANION_DESCRIPTIONS,
  COMPANION_EMPTY_MESSAGES,
  COMPANION_METRICS_SHOWN,
  CompanionEventNoun,
  CompanionSignal,
  CompanionWindow,
  describeCompanion,
  getCompanionWindow,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetryCompanionSignalTabs";
import {
  describeRailCoverage,
  RAIL_COVERAGE_NOTE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplayRailTabs";
import {
  CLOCK_ANCHORED_NOTE,
  CLOCK_ANCHORED_WITHIN_NOTE,
  CLOCK_SKEW_NOTE,
  CLOCK_UNANCHORED_NOTE,
  describeClockAlignment,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplayClockAlignment";
import { ReplayClockAlignmentState } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplaySignalTypes";

/*
 * THE TELEMETRY HINTS, IN THE READER'S LANGUAGE.
 *
 * A pivot button's tooltip says what the pivot could not carry over ("Not
 * carried over: services, severity"); an incident's or an alert's companion
 * tabs say what each card shows and what an empty one found; the session
 * replay rail says how much of the footage its rows come from and how its
 * server times were lined up. Each was English on every page. Each is now a
 * whole sentence in the reader's language - the sentence, every field it
 * names and the list's separator - read here from the Dashboard's own locale
 * files, and the English it always was with no translator.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const READ: Map<string, Record<string, unknown>> = new Map();

const readLocale: (language: string) => Record<string, unknown> = (
  language: string,
): Record<string, unknown> => {
  const known: Record<string, unknown> | undefined = READ.get(language);

  if (known) {
    return known;
  }

  const locale: Record<string, unknown> = JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;

  READ.set(language, locale);

  return locale;
};

const LANGUAGES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((name: string): boolean => {
    return name.endsWith(".json") && name !== "en.json";
  })
  .map((name: string): string => {
    return name.slice(0, -".json".length);
  })
  .sort();

const worded: (language: string, english: string) => string = (
  language: string,
  english: string,
): string => {
  const value: unknown = readLocale(language)[english];

  return typeof value === "string" && value.length > 0 ? value : english;
};

const translatorFor: (language: string) => Translator = (
  language: string,
): Translator => {
  const locale: Record<string, unknown> = readLocale(language);

  return createTranslator((key: string): string | undefined => {
    const value: unknown = locale[key];

    return typeof value === "string" ? value : undefined;
  }, language);
};

// A language that has worded none of it yet.
const unwordedTranslatorFor: (language: string) => Translator = (
  language: string,
): Translator => {
  return createTranslator((): string | undefined => {
    return undefined;
  }, language);
};

const fill: (template: string, values: Record<string, string>) => string = (
  template: string,
  values: Record<string, string>,
): string => {
  return template.replace(/\{\{(\w+)\}\}/g, (whole: string, name: string) => {
    return values[name] ?? whole;
  });
};

describe("the Logs pivot's hint", () => {
  test("with no translator, it is the English it always was", () => {
    expect(formatLogsHint(["serviceIds", "severityTexts"])).toBe(
      "Not carried over: services, severity",
    );
    expect(formatLogsHint(["attributes.http.method", "!severityText"])).toBe(
      "Not carried over: attribute http.method, excluded severity",
    );
    expect(formatLogsHint([])).toBe("");
  });

  test("in German, the sentence and each field read in German", () => {
    expect(
      formatLogsHint(["serviceIds", "severityTexts"], translatorFor("de")),
    ).toBe("Nicht übernommen: Dienste, Schweregrad");
    expect(
      formatLogsHint(
        ["attributes.http.method", "!severityText"],
        translatorFor("de"),
      ),
    ).toBe(
      "Nicht übernommen: Attribut http.method, ausgeschlossen: Schweregrad",
    );
  });

  test("an attribute's key and a field the product has no words for stay as written", () => {
    const hint: string = formatLogsHint(
      ["attributes.http.method", "mystery_field"],
      translatorFor("ru"),
    );

    expect(hint).toBe("Не перенесено: атрибут http.method, mystery_field");
  });

  test("a field named twice, by its scope key and its chip's, is named once", () => {
    expect(
      formatLogsHint(
        ["serviceIds", "serviceId", "primaryEntityId", "severityText"],
        translatorFor("de"),
      ),
    ).toBe("Nicht übernommen: Dienste, Schweregrad");
  });

  test.each(LANGUAGES)(
    "in %s, the whole sentence is the language's, its fields listed with its own separator",
    (language: string) => {
      const translator: Translator = translatorFor(language);
      const hint: string = formatLogsHint(
        [
          "serviceIds",
          "severityTexts",
          "sessionIds",
          "hostId",
          "attributes.k8s.pod.name",
          "!traceId",
        ],
        translator,
      );
      const fields: Array<string> = [
        worded(language, "services"),
        worded(language, "severity"),
        worded(language, "sessions"),
        worded(language, "hosts"),
        fill(worded(language, "attribute {{name}}"), {
          name: "k8s.pod.name",
        }),
        fill(worded(language, "excluded {{field}}"), {
          field: worded(language, "traces"),
        }),
      ];

      expect(hint).toBe(
        fill(worded(language, "Not carried over: {{fields}}"), {
          fields: fields.join(getListSeparator(language)),
        }),
      );
      // Worded in this language: none of it is the English sentence.
      expect(hint).not.toContain("Not carried over");
      expect(hint).not.toMatch(/\bexcluded\b|\battribute\b/);
    },
  );

  test("a language that has not worded the sentence yet gets it whole in English, not half and half", () => {
    expect(
      formatLogsHint(
        ["serviceIds", "severityTexts"],
        unwordedTranslatorFor("fa"),
      ),
    ).toBe("Not carried over: services, severity");
  });
});

describe("the Metrics pivot's hint and the companion tabs' notes", () => {
  test("with no translator, it is the English it always was", () => {
    expect(
      formatMetricsHint([
        COMPANION_SCOPE_NOTES.serviceFilter,
        getAttributeScopeNote("http.route"),
      ]),
    ).toBe('Not carried over: service filter, attribute "http.route".');
  });

  test("in German, every worded note and the attribute's are German, the key as written", () => {
    expect(
      formatMetricsHint(
        [
          COMPANION_SCOPE_NOTES.serviceFilter,
          COMPANION_SCOPE_NOTES.severityFilter,
          getAttributeScopeNote("http.route"),
        ],
        translatorFor("de"),
      ),
    ).toBe(
      "Nicht übernommen: Dienstfilter, Schweregradfilter, Attribut „http.route“.",
    );
  });

  test("the attribute note keeps the English shape the companion tabs build", () => {
    expect(getAttributeScopeNote("nested")).toBe('attribute "nested"');
  });

  test.each(LANGUAGES)(
    "in %s, each companion note reads in the language",
    (language: string) => {
      const translator: Translator = translatorFor(language);
      const notes: Array<string> = Object.values(COMPANION_SCOPE_NOTES);
      const hint: string = formatMetricsHint(notes, translator);

      expect(hint).toBe(
        fill(worded(language, "Not carried over: {{fields}}."), {
          fields: notes
            .map((note: string): string => {
              return worded(language, note);
            })
            .join(getListSeparator(language)),
        }),
      );

      for (const note of notes) {
        // Every note has its own words in every language.
        expect({
          language,
          note,
          worded: worded(language, note) !== note,
        }).toEqual({ language, note, worded: true });
      }
    },
  );
});

const SIGNALS: Array<CompanionSignal> = [
  "logs",
  "spans",
  "exceptions",
  "metrics",
];
const NOUNS: Array<CompanionEventNoun> = ["incident", "alert", "view"];
const WINDOWS: Array<CompanionWindow> = ["snapshot", "zoomed"];

describe("the companion tabs' cards", () => {
  test("a zoomed snapshot is the zoomed window; anything else, the snapshot", () => {
    expect(getCompanionWindow(true)).toBe("zoomed");
    expect(getCompanionWindow(false)).toBe("snapshot");
    expect(getCompanionWindow(undefined)).toBe("snapshot");
  });

  test("every card has a whole sentence of its own for each thing it is about and each window", () => {
    const sentences: Set<string> = new Set();

    for (const signal of SIGNALS) {
      for (const noun of NOUNS) {
        for (const window of WINDOWS) {
          sentences.add(COMPANION_DESCRIPTIONS[signal][noun][window]);
        }
      }
    }

    expect(sentences.size).toBe(SIGNALS.length * NOUNS.length * WINDOWS.length);
  });

  test("in English, the card says what it always said", () => {
    const english: Translator = createTranslator(undefined, "en");

    for (const signal of SIGNALS) {
      for (const noun of NOUNS) {
        for (const window of WINDOWS) {
          expect(
            describeCompanion({
              signal,
              eventNoun: noun,
              window,
              translator: english,
            }),
          ).toEqual({
            description: COMPANION_DESCRIPTIONS[signal][noun][window],
            emptyMessage: COMPANION_EMPTY_MESSAGES[signal][window],
          });
        }
      }
    }
  });

  test.each(LANGUAGES)(
    "in %s, every card's description and empty line are the language's own",
    (language: string) => {
      const translator: Translator = translatorFor(language);
      const english: Array<string> = [];

      for (const signal of SIGNALS) {
        for (const noun of NOUNS) {
          for (const window of WINDOWS) {
            const words: { description: string; emptyMessage: string } =
              describeCompanion({
                signal,
                eventNoun: noun,
                window,
                translator,
              });

            if (
              words.description === COMPANION_DESCRIPTIONS[signal][noun][window]
            ) {
              english.push(words.description);
            }

            if (
              words.emptyMessage === COMPANION_EMPTY_MESSAGES[signal][window]
            ) {
              english.push(words.emptyMessage);
            }
          }
        }
      }

      expect(english).toEqual([]);
    },
  );

  test.each(LANGUAGES)(
    "in %s, the metrics card counts what it shows in the language's own forms",
    (language: string) => {
      const translator: Translator = translatorFor(language);

      for (const count of [1, 2, 5, 21]) {
        const line: string = translator.translatePlural(
          COMPANION_METRICS_SHOWN,
          count,
          { shown: translator.formatNumber(1) },
        );

        expect(line).not.toMatch(/^Showing /);
        expect(line).toContain(translator.formatNumber(count));
      }
    },
  );
});

describe("the session replay rail's notes", () => {
  const anchored: (
    pairs: number,
    uncertaintyMs: number,
  ) => ReplayClockAlignmentState = (
    pairs: number,
    uncertaintyMs: number,
  ): ReplayClockAlignmentState => {
    return { status: "anchored", deltaMs: 0, pairCount: pairs, uncertaintyMs };
  };

  const unanchored: (uncertaintyMs: number) => ReplayClockAlignmentState = (
    uncertaintyMs: number,
  ): ReplayClockAlignmentState => {
    return { status: "unanchored", deltaMs: 0, pairCount: 0, uncertaintyMs };
  };

  test("with no translator, the English it always was", () => {
    expect(
      describeRailCoverage({ loadedChunkCount: 2, totalChunkCount: 5 }),
    ).toBe(
      "Recording rows come from 2 of 5 segments loaded so far; they fill in as footage loads",
    );
    expect(
      describeRailCoverage({ loadedChunkCount: 0, totalChunkCount: 1 }),
    ).toBe(
      "Recording rows come from 0 of 1 segment loaded so far; they fill in as footage loads",
    );
    expect(describeClockAlignment(anchored(3, 0))).toBe(
      "Server times anchored via 3 traces",
    );
    expect(describeClockAlignment(anchored(1, 0))).toBe(
      "Server times anchored via 1 trace",
    );
    expect(describeClockAlignment(unanchored(0))).toBe(
      "Server times unanchored; no trace shared between the recording and the backend yet",
    );
  });

  test("nothing is claimed before the footage or the telemetry is in", () => {
    const german: Translator = translatorFor("de");

    expect(
      describeRailCoverage({
        loadedChunkCount: 5,
        totalChunkCount: 5,
        translator: german,
      }),
    ).toBeNull();
    expect(
      describeRailCoverage({
        loadedChunkCount: 1,
        totalChunkCount: 0,
        translator: german,
      }),
    ).toBeNull();
    expect(
      describeRailCoverage({
        loadedChunkCount: null,
        totalChunkCount: 4,
        translator: german,
      }),
    ).toBeNull();
    expect(
      describeClockAlignment(
        { status: "pending", deltaMs: 0, pairCount: 0, uncertaintyMs: 0 },
        german,
      ),
    ).toBe("");
  });

  test("in German, each note is German, one and many worded apart", () => {
    const german: Translator = translatorFor("de");

    expect(describeClockAlignment(anchored(3, 0), german)).toBe(
      "Serverzeiten über 3 Traces verankert",
    );
    expect(describeClockAlignment(anchored(1, 0), german)).toBe(
      "Serverzeiten über 1 Trace verankert",
    );
    expect(
      describeRailCoverage({
        loadedChunkCount: 2,
        totalChunkCount: 5,
        translator: german,
      }),
    ).toBe(
      fill(worded("de", RAIL_COVERAGE_NOTE.other), {
        loaded: "2",
        count: "5",
      }),
    );
  });

  test.each(LANGUAGES)(
    "in %s, the coverage and clock notes are the language's own",
    (language: string) => {
      const translator: Translator = translatorFor(language);
      const notes: Array<string> = [
        describeRailCoverage({
          loadedChunkCount: 2,
          totalChunkCount: 5,
          translator,
        }) || "",
        describeClockAlignment(anchored(3, 0), translator),
        describeClockAlignment(anchored(4, 1500), translator),
        describeClockAlignment(unanchored(2500), translator),
        describeClockAlignment(unanchored(0), translator),
      ];

      for (const note of notes) {
        expect(note.length).toBeGreaterThan(0);
        expect(note).not.toMatch(/^(Recording rows|Server times)/);
      }

      expect(notes[1]).toContain(translator.formatNumber(3));
      expect(notes[2]).toContain(translator.formatNumber(4));
    },
  );

  test("every rail sentence has its words in every language, its placeholders kept", () => {
    const sentences: Array<string> = [
      RAIL_COVERAGE_NOTE.other,
      CLOCK_ANCHORED_NOTE.other,
      CLOCK_ANCHORED_WITHIN_NOTE.other,
      CLOCK_SKEW_NOTE,
      CLOCK_UNANCHORED_NOTE,
    ];
    const problems: Array<string> = [];

    for (const language of LANGUAGES) {
      for (const sentence of sentences) {
        const value: string = worded(language, sentence);
        const wanted: Array<string> = (
          sentence.match(/\{\{\w+\}\}/g) || []
        ).sort();
        const found: Array<string> = (value.match(/\{\{\w+\}\}/g) || []).sort();

        if (value === sentence) {
          problems.push(`${language}: ${sentence}`);
        }

        if (wanted.join() !== found.join()) {
          problems.push(`${language}: placeholders of ${sentence}`);
        }
      }
    }

    expect(problems).toEqual([]);
  });
});
