import { describe, expect, test } from "@jest/globals";
import { RequestFailedPhase } from "../../../Types/Probe/RequestFailedDetails";
import { createTranslator, Translator } from "../../../Types/Translator";
import {
  getProbeFailureCauseText,
  getRequestFailedPhaseText,
  PROBE_TIMEOUT_FAILURE_CAUSE,
  readProbeTimeoutFailureCause,
  REQUEST_FAILED_PHASE_WORDS,
  writeProbeTimeoutFailureCause,
} from "../../../Utils/Monitor/ProbeFailureReading";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * WHY A PROBE'S CHECK FAILED, READ IN THE READER'S LANGUAGE (#7422, #7424).
 *
 * The probe stores its failure in English - criteria, root causes and logs
 * compare it - and the monitor summaries read OneUptime's own words back:
 *
 *   - the timeout sentence every retrying monitor type writes, "Request was
 *     tried 3 times and it timed out.", written from one template
 *     (writeProbeTimeoutFailureCause) exactly as the probe always wrote it,
 *     read back only on an exact match (readProbeTimeoutFailureCause) and
 *     drawn with each language's plural forms and digits;
 *   - the phase a request broke in (Failed Phase), each a key.
 */

const TIMEOUT_KEY: string = PROBE_TIMEOUT_FAILURE_CAUSE.other;
const TIMEOUT_ONE_KEY: string = `${TIMEOUT_KEY}_one`;

// The sentence as the probe wrote it before it was a template.
const writtenByHand: (count: number | undefined) => string = (
  count: number | undefined,
): string => {
  return "Request was tried " + count + " times and it timed out.";
};

const PERSIAN_DIGITS: RegExp = /[\u{06F0}-\u{06F9}]/u;
const LATIN_DIGITS: RegExp = /[0-9]/;
const LATIN_LETTERS: RegExp = /[A-Za-z]/;

describe("the probe's timeout sentence, as the probe stores it", () => {
  test.each([0, 1, 2, 3, 5, 10, 25, 1000, 123456789])(
    "%i tries: word for word the English the probe always wrote",
    (count: number) => {
      expect(writeProbeTimeoutFailureCause(count)).toBe(writtenByHand(count));
    },
  );

  test("the count the probe never left unset is written as the old code wrote it", () => {
    // The probe's counts are typed number | undefined; it always sets one.
    expect(writeProbeTimeoutFailureCause(undefined)).toBe(
      writtenByHand(undefined),
    );
  });

  test("the literal English criteria and logs compare", () => {
    expect(writeProbeTimeoutFailureCause(3)).toBe(
      "Request was tried 3 times and it timed out.",
    );
    // One try still stores the general form, as it always did.
    expect(writeProbeTimeoutFailureCause(1)).toBe(
      "Request was tried 1 times and it timed out.",
    );
  });

  test("its template: the general sentence is the key, and one try reads once", () => {
    expect(PROBE_TIMEOUT_FAILURE_CAUSE).toEqual({
      one: "Request was tried once and it timed out.",
      other: "Request was tried {{count}} times and it timed out.",
    });
  });
});

describe("the probe's timeout sentence, read back", () => {
  test.each([0, 1, 2, 3, 7, 10, 99, 1000, 123456789])(
    "%i tries: read back to its count",
    (count: number) => {
      expect(
        readProbeTimeoutFailureCause(writeProbeTimeoutFailureCause(count)),
      ).toBe(count);
    },
  );

  test("space round it is left out", () => {
    expect(
      readProbeTimeoutFailureCause(`  ${writeProbeTimeoutFailureCause(4)}\n\t`),
    ).toBe(4);
  });

  test.each([
    ["no full stop", "Request was tried 3 times and it timed out"],
    ["lower case", "request was tried 3 times and it timed out."],
    ["another verb", "Request was retried 3 times and it timed out."],
    ["a word for the count", "Request was tried three times and it timed out."],
    ["no count", "Request was tried  times and it timed out."],
    ["an unset count", "Request was tried undefined times and it timed out."],
    ["a negative count", "Request was tried -3 times and it timed out."],
    ["a decimal count", "Request was tried 1.5 times and it timed out."],
    ["a grouped count", "Request was tried 3,000 times and it timed out."],
    ["Persian digits", "Request was tried ۳ times and it timed out."],
    ["Arabic-Indic digits", "Request was tried ٣ times and it timed out."],
    [
      "a count longer than any",
      "Request was tried 1234567890 times and it timed out.",
    ],
    [
      "a space inside the count",
      "Request was tried 1 2 times and it timed out.",
    ],
    [
      "the sentence after another message",
      "Request failed with AggregateError (all connection attempts failed). Request was tried 3 times and it timed out.",
    ],
    [
      "the sentence before another message",
      "Request was tried 3 times and it timed out. (probe eu-west)",
    ],
    ["the sentence twice", `${writtenByHand(3)} ${writtenByHand(3)}`],
    ["only its start", "Request was tried "],
    ["only its end", " times and it timed out."],
    ["the start and end alone", "Request was tried  times and it timed out."],
    ["another timeout", "Request timed out after 10000 ms"],
    ["the network's words", "connect ECONNREFUSED 203.0.113.7:443"],
    ["nothing", ""],
  ])("%s: left as written", (_name: string, cause: string) => {
    expect(readProbeTimeoutFailureCause(cause)).toBeNull();
  });

  test("no cause at all reads nothing", () => {
    expect(readProbeTimeoutFailureCause(undefined)).toBeNull();
    expect(readProbeTimeoutFailureCause(null)).toBeNull();
  });

  test.each([
    ["a long run of the sentence's start", "Request was tried ".repeat(25_000)],
    ["a long run of digits", `Request was tried ${"9".repeat(400_000)}`],
    [
      "a long count between the start and the end",
      `Request was tried ${"9".repeat(400_000)} times and it timed out.`,
    ],
    [
      "a long run of the sentence's end",
      " times and it timed out.".repeat(17_000),
    ],
  ])(
    "%s (400,000 characters) is read in time that grows with its length",
    (_name: string, cause: string) => {
      const read: FastestRun<number | null> = fastestRun({
        run: (): number | null => {
          return readProbeTimeoutFailureCause(cause);
        },
        limitInMs: 2000,
      });

      expect(read.result).toBeNull();
      expect(read.inMs).toBeLessThan(2000);
    },
  );
});

describe("a failure cause, as a summary draws it", () => {
  test("in English: the sentence as stored, and once for one try", () => {
    const english: Translator = dashboardTranslator("en");

    expect(
      getProbeFailureCauseText({
        translator: english,
        failureCause: writeProbeTimeoutFailureCause(3),
      }),
    ).toBe("Request was tried 3 times and it timed out.");
    expect(
      getProbeFailureCauseText({
        translator: english,
        failureCause: writeProbeTimeoutFailureCause(1),
      }),
    ).toBe("Request was tried once and it timed out.");
    expect(
      getProbeFailureCauseText({
        translator: english,
        failureCause: writeProbeTimeoutFailureCause(1200),
      }),
    ).toBe("Request was tried 1,200 times and it timed out.");
  });

  test("with no translation set up: the English, filled", () => {
    expect(
      getProbeFailureCauseText({
        translator: createTranslator(undefined),
        failureCause: writeProbeTimeoutFailureCause(2),
      }),
    ).toBe("Request was tried 2 times and it timed out.");
  });

  test("in German: the German sentence and its one form", () => {
    const german: Translator = dashboardTranslator("de");
    const words: Record<string, string> = readDashboardLocale("de");

    expect(
      getProbeFailureCauseText({
        translator: german,
        failureCause: writeProbeTimeoutFailureCause(3),
      }),
    ).toBe(words[TIMEOUT_KEY]!.replace("{{count}}", "3"));
    expect(
      getProbeFailureCauseText({
        translator: german,
        failureCause: writeProbeTimeoutFailureCause(3),
      }),
    ).toBe(
      "Die Anfrage wurde 3-mal versucht und hat das Zeitlimit überschritten.",
    );
    expect(
      getProbeFailureCauseText({
        translator: german,
        failureCause: writeProbeTimeoutFailureCause(1),
      }),
    ).toBe(words[TIMEOUT_ONE_KEY]);
    // German groups a thousand with a dot.
    expect(
      getProbeFailureCauseText({
        translator: german,
        failureCause: writeProbeTimeoutFailureCause(1200),
      }),
    ).toContain("1.200-mal");
  });

  test("in Persian: the count in Persian digits, and no Latin letter or digit", () => {
    const text: string = withoutIsolateMarks(
      getProbeFailureCauseText({
        translator: dashboardTranslator("fa"),
        failureCause: writeProbeTimeoutFailureCause(3),
      }),
    );

    expect(text).toContain("\u{06F3}");
    expect(text).toMatch(PERSIAN_DIGITS);
    expect(text).not.toMatch(LATIN_DIGITS);
    expect(text).not.toMatch(LATIN_LETTERS);
  });

  test("in Persian, one try: the one form, with no digit", () => {
    const text: string = getProbeFailureCauseText({
      translator: dashboardTranslator("fa"),
      failureCause: writeProbeTimeoutFailureCause(1),
    });

    expect(text).toBe(readDashboardLocale("fa")[TIMEOUT_ONE_KEY]);
    expect(text).not.toMatch(PERSIAN_DIGITS);
  });

  test("in Arabic: the count as Arabic writes it in OneUptime, Latin digits", () => {
    const text: string = getProbeFailureCauseText({
      translator: dashboardTranslator("ar"),
      failureCause: writeProbeTimeoutFailureCause(3),
    });

    expect(text).toBe(
      readDashboardLocale("ar")[TIMEOUT_KEY]!.replace("{{count}}", "3"),
    );
    expect(text).not.toMatch(LATIN_LETTERS);
  });

  test("in Russian, 21 tries reads the general form, never the one form", () => {
    const text: string = getProbeFailureCauseText({
      translator: dashboardTranslator("ru"),
      failureCause: writeProbeTimeoutFailureCause(21),
    });

    expect(text).toBe(
      readDashboardLocale("ru")[TIMEOUT_KEY]!.replace("{{count}}", "21"),
    );
  });

  test.each([
    "connect ECONNREFUSED 203.0.113.7:443",
    "Request timed out after 10000 ms",
    "Request was tried 3 times and it timed out",
    "Request failed with AggregateError (all connection attempts failed). Request was tried 3 times and it timed out.",
  ])(
    "any other cause stays as written, in every language: %s",
    (cause: string) => {
      for (const language of ["en", ...DASHBOARD_LANGUAGES]) {
        expect(
          getProbeFailureCauseText({
            translator: dashboardTranslator(language),
            failureCause: ` ${cause} `,
          }),
        ).toBe(cause);
      }
    },
  );

  test("no cause draws nothing", () => {
    expect(
      getProbeFailureCauseText({
        translator: dashboardTranslator("de"),
        failureCause: undefined,
      }),
    ).toBe("");
  });

  test("negative control: a language that left the sentence in English draws the English", () => {
    const words: Record<string, string> = {
      ...readDashboardLocale("de"),
      [TIMEOUT_KEY]: TIMEOUT_KEY,
      [TIMEOUT_ONE_KEY]: PROBE_TIMEOUT_FAILURE_CAUSE.one,
    };
    const untranslated: Translator = createTranslator(
      (text: string): string | undefined => {
        return words[text];
      },
      "de",
    );

    expect(
      getProbeFailureCauseText({
        translator: untranslated,
        failureCause: writeProbeTimeoutFailureCause(3),
      }),
    ).toBe("Request was tried 3 times and it timed out.");
  });
});

describe("the phase a request broke in", () => {
  const PHASES: Array<RequestFailedPhase> = Object.values(RequestFailedPhase);

  test("every phase the probe names has its words, the stored English", () => {
    expect(Object.keys(REQUEST_FAILED_PHASE_WORDS).sort()).toEqual(
      [...PHASES].sort(),
    );

    for (const phase of PHASES) {
      expect(REQUEST_FAILED_PHASE_WORDS[phase]).toBe(phase);
    }
  });

  test.each(Object.values(RequestFailedPhase))(
    "%s: in English as stored",
    (phase: RequestFailedPhase) => {
      expect(
        getRequestFailedPhaseText({
          translator: dashboardTranslator("en"),
          failedPhase: phase,
        }),
      ).toBe(phase);
    },
  );

  test.each(["de", "fa", "ar", "ja"])(
    "every phase in %s is the language's own word",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const phase of PHASES) {
        const text: string = getRequestFailedPhaseText({
          translator: dashboardTranslator(language),
          failedPhase: phase,
        });

        expect(text).toBe(words[phase]);
        expect(text).not.toBe(phase);
      }
    },
  );

  test("in German, literally", () => {
    const german: Translator = dashboardTranslator("de");

    expect(
      getRequestFailedPhaseText({
        translator: german,
        failedPhase: RequestFailedPhase.DNSResolution,
      }),
    ).toBe("DNS-Auflösung");
    expect(
      getRequestFailedPhaseText({
        translator: german,
        failedPhase: RequestFailedPhase.TCPConnection,
      }),
    ).toBe("TCP-Verbindung");
    expect(
      getRequestFailedPhaseText({
        translator: german,
        failedPhase: RequestFailedPhase.Unknown,
      }),
    ).toBe("Unbekannt");
  });

  test("a phase with space round it is still read", () => {
    expect(
      getRequestFailedPhaseText({
        translator: dashboardTranslator("de"),
        failedPhase: ` ${RequestFailedPhase.TLSHandshake} `,
      }),
    ).toBe(readDashboardLocale("de")[RequestFailedPhase.TLSHandshake]);
  });

  test("a phase no probe writes today stays as written", () => {
    for (const value of ["QUIC Handshake", "dns resolution", "Proxy"]) {
      expect(
        getRequestFailedPhaseText({
          translator: dashboardTranslator("de"),
          failedPhase: value,
        }),
      ).toBe(value);
    }
  });

  test("an object key is not a phase", () => {
    for (const value of ["constructor", "toString", "__proto__"]) {
      expect(
        getRequestFailedPhaseText({
          translator: dashboardTranslator("de"),
          failedPhase: value,
        }),
      ).toBe(value);
    }
  });

  test("no phase draws nothing", () => {
    expect(
      getRequestFailedPhaseText({
        translator: dashboardTranslator("de"),
        failedPhase: undefined,
      }),
    ).toBe("");
    expect(
      getRequestFailedPhaseText({
        translator: dashboardTranslator("de"),
        failedPhase: "  ",
      }),
    ).toBe("");
  });
});

describe("every Dashboard language words these failures", () => {
  const KEYS: Array<string> = [
    ...Object.values(REQUEST_FAILED_PHASE_WORDS),
    TIMEOUT_KEY,
    TIMEOUT_ONE_KEY,
    "Failed Phase",
  ];

  // The keys a language's words leave as the English, or empty.
  const unworded: (words: Record<string, string>) => Array<string> = (
    words: Record<string, string>,
  ): Array<string> => {
    const english: Record<string, string> = readDashboardLocale("en");

    return KEYS.filter((key: string): boolean => {
      const value: string | undefined = words[key];

      return !value || !value.trim() || value === english[key];
    });
  };

  test("English holds each key under its own words", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    for (const key of KEYS) {
      expect(english[key]).toBeDefined();
    }

    expect(english[TIMEOUT_KEY]).toBe(TIMEOUT_KEY);
    expect(english[TIMEOUT_ONE_KEY]).toBe(PROBE_TIMEOUT_FAILURE_CAUSE.one);
    // The label a time-sounding "Failed At" gave way to.
    expect(english["Failed At"]).toBeUndefined();
  });

  test.each([...DASHBOARD_LANGUAGES])(
    "%s words each phase, Failed Phase, the timeout sentence and its one form",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);

      expect(unworded(words)).toEqual([]);

      for (const key of KEYS) {
        expect({
          key: key,
          worded: isWordedInDashboardLocale(key, language),
        }).toEqual({ key: key, worded: true });
      }

      // The general sentence keeps its count.
      expect(placeholdersOf(words[TIMEOUT_KEY] || "")).toEqual(["{{count}}"]);
    },
  );

  test("the one form names no count, as the English one form does not", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      // Japanese, Korean and Chinese never read a one form.
      if (["ja", "ko", "zh-CN", "zh-TW"].includes(language)) {
        continue;
      }

      expect({
        language: language,
        placeholders: placeholdersOf(
          readDashboardLocale(language)[TIMEOUT_ONE_KEY] || "",
        ),
      }).toEqual({ language: language, placeholders: [] });
    }
  });

  test("negative control: a language missing one phase word, or the sentence, is caught", () => {
    const german: Record<string, string> = readDashboardLocale("de");

    expect(unworded({ ...german, "DNS Resolution": "DNS Resolution" })).toEqual(
      ["DNS Resolution"],
    );
    expect(unworded({ ...german, [TIMEOUT_KEY]: TIMEOUT_KEY })).toEqual([
      TIMEOUT_KEY,
    ]);
    expect(unworded({ ...german, "Failed Phase": "" })).toEqual([
      "Failed Phase",
    ]);
  });
});
