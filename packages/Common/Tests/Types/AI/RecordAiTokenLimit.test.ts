import {
  getRecordAiTokenLimitMessage,
  getRecordAiTokenLimitRunError,
  isRecordAiTokenLimitPaused,
  readRecordAiTokenLimitStop,
  RECORD_AI_TOKEN_LIMIT_KINDS,
  RECORD_AI_TOKEN_LIMIT_PATTERNS,
  RECORD_AI_TOKEN_LIMIT_WORDS,
  RecordAiTokenLimitKind,
  RecordAiTokenLimitStop,
} from "../../../Types/AI/RecordAiTokenLimit";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";

/*
 * AN INCIDENT'S OR ALERT'S OWN DAILY AI TOKEN LIMIT, IN WORDS THAT FIT IT
 * (#7157).
 *
 * A project set the Daily Incident AI Token Limit to 0. Every automatic
 * investigation then failed with "Daily autonomous AI token budget
 * exhausted (0 of 0 tokens used today). Autonomous AI requests resume
 * tomorrow (UTC)", and the AI card said the project reached its daily AI
 * limit and would start again at midnight. Neither was true: a limit of 0
 * pauses the work until someone raises it, and it is the incident's limit,
 * not the project's. The words now name the limit and where it is, and only
 * a limit today's work used up says midnight.
 */

const KINDS: ReadonlyArray<RecordAiTokenLimitKind> = ["incident", "alert"];

const PAUSED: Record<RecordAiTokenLimitKind, string> = {
  incident:
    "The Daily Incident AI Token Limit is set to 0, which pauses automatic AI work for incidents. Raise it above 0 under Incidents → AI → Settings → More settings, or clear it, then try again.",
  alert:
    "The Daily Alert AI Token Limit is set to 0, which pauses automatic AI work for alerts. Raise it above 0 under Alerts → AI → Settings → More settings, or clear it, then try again.",
};

const USED_UP: Record<RecordAiTokenLimitKind, string> = {
  incident:
    "Automatic AI work for incidents used up today's Daily Incident AI Token Limit. Raise or clear it under Incidents → AI → Settings → More settings, or wait until midnight UTC, when it resets. Then try again.",
  alert:
    "Automatic AI work for alerts used up today's Daily Alert AI Token Limit. Raise or clear it under Alerts → AI → Settings → More settings, or wait until midnight UTC, when it resets. Then try again.",
};

// What a run on the limit failed with before #7157, which runs keep.
function oldRunError(data: {
  used: string;
  limit: string;
  records: "Incidents" | "Alerts";
}): string {
  return `Daily autonomous AI token budget exhausted (${data.used} of ${data.limit} tokens used today). Autonomous AI requests resume tomorrow (UTC) — raise or unset the limit under ${data.records} > AI > Settings.`;
}

describe("whether a limit pauses the work", () => {
  test.each([
    [0, true],
    [-1, true],
    [-1000, true],
    [1, false],
    [200000, false],
  ])("a limit of %s: %s", (limit: number, isPaused: boolean) => {
    expect(isRecordAiTokenLimitPaused(limit)).toBe(isPaused);
  });

  test("no limit, or one that is not a number, never pauses", () => {
    expect(isRecordAiTokenLimitPaused(null)).toBe(false);
    expect(isRecordAiTokenLimitPaused(undefined)).toBe(false);
    expect(isRecordAiTokenLimitPaused(Number.NaN)).toBe(false);
  });
});

describe("the message without numbers (Try again, Investigate now, an AI fix)", () => {
  test.each(KINDS)("%s: a limit of 0 pauses the work", (kind: string) => {
    const record: RecordAiTokenLimitKind = kind as RecordAiTokenLimitKind;

    expect(getRecordAiTokenLimitMessage(record, { limitInTokens: 0 })).toBe(
      PAUSED[record],
    );
  });

  test.each(KINDS)("%s: a limit below 0 pauses it too", (kind: string) => {
    const record: RecordAiTokenLimitKind = kind as RecordAiTokenLimitKind;

    expect(getRecordAiTokenLimitMessage(record, { limitInTokens: -25 })).toBe(
      PAUSED[record],
    );
  });

  test.each(KINDS)(
    "%s: a limit today's work used up resets at midnight",
    (kind: string) => {
      const record: RecordAiTokenLimitKind = kind as RecordAiTokenLimitKind;

      expect(
        getRecordAiTokenLimitMessage(record, { limitInTokens: 5000 }),
      ).toBe(USED_UP[record]);
    },
  );

  test.each(KINDS)(
    "%s: a limit that could not be read back is taken as used up",
    (kind: string) => {
      const record: RecordAiTokenLimitKind = kind as RecordAiTokenLimitKind;

      expect(getRecordAiTokenLimitMessage(record)).toBe(USED_UP[record]);
      expect(getRecordAiTokenLimitMessage(record, null)).toBe(USED_UP[record]);
      expect(
        getRecordAiTokenLimitMessage(record, { limitInTokens: null }),
      ).toBe(USED_UP[record]);
    },
  );
});

describe("the run's error (AIService)", () => {
  test.each(KINDS)("%s: a limit of 0 is the paused message", (kind: string) => {
    const record: RecordAiTokenLimitKind = kind as RecordAiTokenLimitKind;

    expect(
      getRecordAiTokenLimitRunError(record, {
        limitInTokens: 0,
        usedTokensToday: 0,
      }),
    ).toBe(PAUSED[record]);
    expect(
      getRecordAiTokenLimitRunError(record, {
        limitInTokens: -1,
        usedTokensToday: 40,
      }),
    ).toBe(PAUSED[record]);
  });

  test("a used-up limit says how much of it today's work used", () => {
    expect(
      getRecordAiTokenLimitRunError("incident", {
        limitInTokens: 1000,
        usedTokensToday: 1200,
      }),
    ).toBe(
      "Automatic AI work for incidents used 1,200 of its Daily Incident AI Token Limit of 1,000 tokens today. Raise or clear it under Incidents → AI → Settings → More settings, or wait until midnight UTC, when it resets. Then try again.",
    );
    expect(
      getRecordAiTokenLimitRunError("alert", {
        limitInTokens: 200000,
        usedTokensToday: 200000,
      }),
    ).toBe(
      "Automatic AI work for alerts used 200,000 of its Daily Alert AI Token Limit of 200,000 tokens today. Raise or clear it under Alerts → AI → Settings → More settings, or wait until midnight UTC, when it resets. Then try again.",
    );
  });

  test("a count below 0 is written as 0", () => {
    expect(
      getRecordAiTokenLimitRunError("incident", {
        limitInTokens: 10,
        usedTokensToday: -4,
      }),
    ).toContain("used 0 of its Daily Incident AI Token Limit of 10 tokens");
  });
});

describe("what each message says, and what it never says", () => {
  const MESSAGES: Array<{
    kind: RecordAiTokenLimitKind;
    isPaused: boolean;
    text: string;
  }> = KINDS.flatMap((kind: RecordAiTokenLimitKind) => {
    return [
      {
        kind,
        isPaused: true,
        text: getRecordAiTokenLimitMessage(kind, { limitInTokens: 0 }),
      },
      {
        kind,
        isPaused: true,
        text: getRecordAiTokenLimitRunError(kind, {
          limitInTokens: 0,
          usedTokensToday: 0,
        }),
      },
      { kind, isPaused: false, text: getRecordAiTokenLimitMessage(kind) },
      {
        kind,
        isPaused: false,
        text: getRecordAiTokenLimitRunError(kind, {
          limitInTokens: 10,
          usedTokensToday: 11,
        }),
      },
    ];
  });

  test("only a used-up limit says midnight; none says tomorrow", () => {
    for (const message of MESSAGES) {
      expect({
        text: message.text,
        saysMidnight: message.text.includes("midnight UTC"),
        saysTomorrow: message.text.toLowerCase().includes("tomorrow"),
      }).toEqual({
        text: message.text,
        saysMidnight: !message.isPaused,
        saysTomorrow: false,
      });
    }
  });

  test("each names its record's limit, where it is, and never the other record's", () => {
    for (const message of MESSAGES) {
      const words: { limitName: string; location: string } =
        RECORD_AI_TOKEN_LIMIT_WORDS[message.kind];
      const other: RecordAiTokenLimitKind =
        message.kind === "incident" ? "alert" : "incident";

      expect({
        text: message.text,
        namesLimit: message.text.includes(words.limitName),
        namesPlace: message.text.includes(words.location),
        namesOther: new RegExp(other, "i").test(message.text),
      }).toEqual({
        text: message.text,
        namesLimit: true,
        namesPlace: true,
        namesOther: false,
      });
    }
  });

  test("none calls it the project's daily AI limit", () => {
    for (const message of MESSAGES) {
      expect(message.text).not.toMatch(/project/i);
    }
  });

  test("the kinds are the incident and the alert, each with its own words", () => {
    expect(RECORD_AI_TOKEN_LIMIT_KINDS).toEqual(["incident", "alert"]);
    expect(RECORD_AI_TOKEN_LIMIT_WORDS.incident.limitName).toBe(
      "Daily Incident AI Token Limit",
    );
    expect(RECORD_AI_TOKEN_LIMIT_WORDS.alert.limitName).toBe(
      "Daily Alert AI Token Limit",
    );
    expect(RECORD_AI_TOKEN_LIMIT_WORDS.incident.location).toBe(
      "Incidents → AI → Settings → More settings",
    );
    expect(RECORD_AI_TOKEN_LIMIT_WORDS.alert.location).toBe(
      "Alerts → AI → Settings → More settings",
    );
  });
});

describe("reading which limit stopped a run", () => {
  test.each(KINDS)(
    "%s: every error the server writes reads back",
    (kind: string) => {
      const record: RecordAiTokenLimitKind = kind as RecordAiTokenLimitKind;

      for (const [limit, used, isPaused] of [
        [0, 0, true],
        [-3, 0, true],
        [1000, 1000, false],
        [1000, 1500, false],
        [1234567, 1234567, false],
      ] as Array<[number, number, boolean]>) {
        expect(
          readRecordAiTokenLimitStop(
            getRecordAiTokenLimitRunError(record, {
              limitInTokens: limit,
              usedTokensToday: used,
            }),
          ),
        ).toEqual({ kind: record, isPaused });
      }

      expect(
        readRecordAiTokenLimitStop(
          getRecordAiTokenLimitMessage(record, { limitInTokens: 0 }),
        ),
      ).toEqual({ kind: record, isPaused: true });
      expect(
        readRecordAiTokenLimitStop(getRecordAiTokenLimitMessage(record)),
      ).toEqual({ kind: record, isPaused: false });
    },
  );

  test("the errors runs failed with before keep reading as the record's limit", () => {
    expect(
      readRecordAiTokenLimitStop(
        oldRunError({ used: "0", limit: "0", records: "Incidents" }),
      ),
    ).toEqual({ kind: "incident", isPaused: true });
    expect(
      readRecordAiTokenLimitStop(
        oldRunError({ used: "0", limit: "0", records: "Alerts" }),
      ),
    ).toEqual({ kind: "alert", isPaused: true });
    expect(
      readRecordAiTokenLimitStop(
        oldRunError({ used: "0", limit: "-5", records: "Alerts" }),
      ),
    ).toEqual({ kind: "alert", isPaused: true });
    expect(
      readRecordAiTokenLimitStop(
        oldRunError({
          used: "1,000,000",
          limit: "200,000",
          records: "Incidents",
        }),
      ),
    ).toEqual({ kind: "incident", isPaused: false });
    expect(
      readRecordAiTokenLimitStop(
        oldRunError({ used: "500", limit: "500", records: "Alerts" }),
      ),
    ).toEqual({ kind: "alert", isPaused: false });
  });

  test("an old error naming no record, the project's limits, or anything else is no record's limit", () => {
    for (const message of [
      "Daily autonomous AI token budget exhausted (0 of 0 tokens used today). Autonomous AI requests resume tomorrow (UTC) — raise or unset the limit in the AI settings pages.",
      "Daily autonomous AI token budget exhausted for this project.",
      "This project has reached its daily AI token limit.",
      "This project has reached its daily AI spend limit.",
      "No LLM provider configured for this project.",
      "The tool loop crashed",
      "",
    ]) {
      expect({ message, stop: readRecordAiTokenLimitStop(message) }).toEqual({
        message,
        stop: null,
      });
    }

    expect(readRecordAiTokenLimitStop(null)).toBeNull();
    expect(readRecordAiTokenLimitStop(undefined)).toBeNull();
  });

  test("a limit named in any case reads the same", () => {
    expect(
      readRecordAiTokenLimitStop(
        "the daily alert ai token limit is set to 0, which pauses it.",
      ),
    ).toEqual({ kind: "alert", isPaused: true });
  });

  test("the words that decide are at the error's start: a message's tail is not read", () => {
    const stop: RecordAiTokenLimitStop | null = readRecordAiTokenLimitStop(
      `${"x".repeat(3000)} ${PAUSED.incident}`,
    );

    expect(stop).toBeNull();
  });
});

describe("reading takes time in step with the error's length", () => {
  test("each pattern reads 400,000 characters of its worst case at once", () => {
    const worstCases: Array<string> = [
      "Daily Incident AI Token Limit is set to ".repeat(10000),
      "used 1,2,3,4,5,6,7,8,9, of its Daily ".repeat(10000),
      "token budget exhausted (1,000 of 2,000 tokens used ".repeat(8000),
      "under Incidents > AI > Setting".repeat(13000),
      "9,".repeat(200000),
    ];

    for (const text of worstCases) {
      for (const pattern of RECORD_AI_TOKEN_LIMIT_PATTERNS) {
        const timed: FastestRun<boolean> = fastestRun({
          run: (): boolean => {
            return new RegExp(pattern.source, pattern.flags).test(text);
          },
          limitInMs: 2000,
        });

        expect({ pattern: pattern.source, inMs: timed.inMs }).toEqual({
          pattern: pattern.source,
          inMs: expect.any(Number),
        });
        expect(timed.inMs).toBeLessThan(2000);
      }
    }
  });
});
