import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  ARRIVAL_ARRIVED,
  ARRIVAL_CHECK_AGAIN,
  ARRIVAL_FAILED,
  ARRIVAL_NOTHING_YET,
  ARRIVAL_PICK_ANOTHER_KEY,
  ARRIVAL_STEP_DESCRIPTION,
  ARRIVAL_STEP_TITLE,
  ARRIVAL_STOPPED,
  ARRIVAL_WAITING,
  RUM_SIGNAL_ARRIVAL_HINT_AFTER_MS,
  RUM_SIGNAL_ARRIVAL_POLL_MS,
  RUM_SIGNAL_ARRIVAL_STOP_AFTER_MS,
  RUM_SIGNAL_ARRIVING_WINDOW_MS,
  RumSignalArrivalFacts,
  RumSignalArrivalState,
  getRumSignalArrivalState,
  hasRumSignalArrived,
  isRumSignalArrivalWatching,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Rum/SetupCheck/RumSignalArrival";
import { RumKindRefusal } from "../../../../App/FeatureSet/Dashboard/src/Components/Rum/SetupCheck/RumIngestRefusals";
import { TelemetryIngestRefusalReason } from "../../../Types/Telemetry/TelemetryIngestRefusal";
import TelemetryIngestSurface from "../../../Types/Telemetry/TelemetryIngestSurface";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";

/*
 * THE LAST STEP OF "SET UP LOGS" AND "SET UP EXCEPTIONS" (issue #6379),
 * read as data: when the first log or exception counts as arrived, what
 * the step says while it waits, when it says what to check, when it stops
 * looking, and that a refusal or a failed look is never taken for "nothing
 * yet". The dialog that does the reads is RumSignalSetupModal.test.tsx.
 */

const NOW: Date = new Date("2026-11-20T12:00:00.000Z");
const MINUTE: number = 60 * 1000;

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

function facts(
  overrides: Partial<RumSignalArrivalFacts> = {},
): RumSignalArrivalFacts {
  return {
    startedAt: ago(MINUTE),
    now: NOW,
    baseline: null,
    latest: null,
    lastLookFailed: false,
    refusal: null,
    ...overrides,
  };
}

function refusal(state: "refused" | "partly-refused"): RumKindRefusal {
  return {
    state,
    refusal: {
      keyId: "key-1",
      keyName: "Storefront browser key",
      keyType: TelemetryIngestionKeyType.Browser,
      pinnedServiceName: null,
      reason: TelemetryIngestRefusalReason.KeyDisabled,
      surface: TelemetryIngestSurface.OtelLogs,
      count: 12,
      firstRefusedAt: ago(10 * MINUTE),
      lastRefusedAt: ago(MINUTE),
    },
  };
}

describe("when the first one counts as arrived", () => {
  test("never before the step looked, and now: arrived", () => {
    expect(
      hasRumSignalArrived({ baseline: null, latest: ago(MINUTE), now: NOW }),
    ).toBe(true);
  });

  test("newer than when the step first looked: arrived, however long ago it first did", () => {
    expect(
      hasRumSignalArrived({
        baseline: ago(2 * 24 * 60 * MINUTE),
        latest: ago(30 * MINUTE),
        now: NOW,
      }),
    ).toBe(true);
  });

  /*
   * Ingest stamps an arrival once per fence window, so a stamp that did
   * not move since the first look is still the signal arriving, while it is
   * recent.
   */
  test("the same stamp as at the first look: arriving while recent, not once old", () => {
    const recent: Date = ago(RUM_SIGNAL_ARRIVING_WINDOW_MS);
    const old: Date = ago(RUM_SIGNAL_ARRIVING_WINDOW_MS + 1);

    expect(
      hasRumSignalArrived({ baseline: recent, latest: recent, now: NOW }),
    ).toBe(true);
    expect(hasRumSignalArrived({ baseline: old, latest: old, now: NOW })).toBe(
      false,
    );
  });

  test("nothing, or a date that is not one: not arrived", () => {
    expect(
      hasRumSignalArrived({ baseline: null, latest: null, now: NOW }),
    ).toBe(false);
    expect(
      hasRumSignalArrived({ baseline: undefined, latest: undefined, now: NOW }),
    ).toBe(false);
    expect(
      hasRumSignalArrived({
        baseline: null,
        latest: new Date("not a date"),
        now: NOW,
      }),
    ).toBe(false);
  });

  test("the windows are the ones the step is built on", () => {
    // Ingest's fence is five minutes: the window holds one stamp at least.
    expect(RUM_SIGNAL_ARRIVING_WINDOW_MS).toBeGreaterThan(5 * MINUTE);
    expect(RUM_SIGNAL_ARRIVAL_POLL_MS).toBe(10 * 1000);
    expect(RUM_SIGNAL_ARRIVAL_HINT_AFTER_MS).toBeLessThan(
      RUM_SIGNAL_ARRIVAL_STOP_AFTER_MS,
    );
  });
});

describe("what the step says", () => {
  const states: Array<
    [string, Partial<RumSignalArrivalFacts>, RumSignalArrivalState]
  > = [
    [
      "before the first answer",
      { latest: undefined, baseline: undefined },
      "checking",
    ],
    ["in its first minutes, with nothing", {}, "waiting"],
    [
      "nothing after a few minutes",
      { startedAt: ago(RUM_SIGNAL_ARRIVAL_HINT_AFTER_MS) },
      "nothing-yet",
    ],
    [
      "nothing for a quarter of an hour",
      { startedAt: ago(RUM_SIGNAL_ARRIVAL_STOP_AFTER_MS) },
      "stopped",
    ],
    ["one arrived", { latest: ago(MINUTE) }, "arrived"],
    [
      "one arrived just as it would stop",
      {
        startedAt: ago(RUM_SIGNAL_ARRIVAL_STOP_AFTER_MS + MINUTE),
        latest: ago(MINUTE),
      },
      "arrived",
    ],
    ["the last look failed", { lastLookFailed: true }, "failed"],
    [
      "the last look failed before the first answer",
      { lastLookFailed: true, latest: undefined, baseline: undefined },
      "failed",
    ],
    ["what carries it is refused", { refusal: refusal("refused") }, "refused"],
    [
      "refused, and the last look failed: the refusal is what speaks",
      { refusal: refusal("refused"), lastLookFailed: true },
      "refused",
    ],
    [
      "partly refused: some arrives, so the step keeps waiting",
      { refusal: refusal("partly-refused") },
      "waiting",
    ],
    [
      "refused for a quarter of an hour: it stops, the refusal beside Check again",
      {
        refusal: refusal("refused"),
        startedAt: ago(RUM_SIGNAL_ARRIVAL_STOP_AFTER_MS),
      },
      "stopped",
    ],
  ];

  test.each(states)(
    "%s",
    (
      _name: string,
      overrides: Partial<RumSignalArrivalFacts>,
      expected: RumSignalArrivalState,
    ) => {
      expect(getRumSignalArrivalState(facts(overrides))).toBe(expected);
    },
  );

  // An open dialog does not look for ever: it stops once arrived or stopped.
  test("keeps looking until one arrives or it stops", () => {
    const watching: Record<RumSignalArrivalState, boolean> = {
      checking: true,
      waiting: true,
      arrived: false,
      "nothing-yet": true,
      refused: true,
      stopped: false,
      failed: true,
    };

    for (const [state, expected] of Object.entries(watching)) {
      expect({
        state,
        watching: isRumSignalArrivalWatching(state as RumSignalArrivalState),
      }).toEqual({ state, watching: expected });
    }
  });
});

describe("its words, in every language the Dashboard is read in", () => {
  const LOCALES: string = path.resolve(
    __dirname,
    "../../../../App/FeatureSet/Dashboard/src/Locales",
  );
  const words: Array<string> = [
    ...Object.values(ARRIVAL_STEP_TITLE),
    ...Object.values(ARRIVAL_STEP_DESCRIPTION),
    ...Object.values(ARRIVAL_WAITING),
    ...Object.values(ARRIVAL_ARRIVED),
    ...Object.values(ARRIVAL_NOTHING_YET),
    ARRIVAL_STOPPED,
    ARRIVAL_FAILED,
    ARRIVAL_CHECK_AGAIN,
    ARRIVAL_PICK_ANOTHER_KEY,
  ];
  const languages: Array<string> = fs
    .readdirSync(LOCALES)
    .filter((name: string): boolean => {
      return name.endsWith(".json") && name !== "en.json";
    })
    .map((name: string): string => {
      return name.replace(/\.json$/, "");
    });

  test("every sentence is a key of the English locale", () => {
    const english: Record<string, unknown> = JSON.parse(
      fs.readFileSync(path.join(LOCALES, "en.json"), "utf8"),
    ) as Record<string, unknown>;

    for (const word of words) {
      expect({ word, isKey: english[word] === word }).toEqual({
        word,
        isKey: true,
      });
    }
  });

  test("each language words every sentence, with its placeholders", () => {
    expect(languages).toHaveLength(17);

    for (const language of languages) {
      const locale: Record<string, unknown> = JSON.parse(
        fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
      ) as Record<string, unknown>;

      for (const word of words) {
        const translated: unknown = locale[word];
        const placeholders: Array<string> = (
          word.match(/\{\{\w+\}\}/g) || []
        ).sort();

        expect({
          language,
          word,
          worded: typeof translated === "string" && translated !== word,
          placeholders: (
            (typeof translated === "string" &&
              translated.match(/\{\{\w+\}\}/g)) ||
            []
          ).sort(),
        }).toEqual({ language, word, worded: true, placeholders });
      }
    }
  });
});
