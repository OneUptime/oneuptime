import { describe, expect, test } from "@jest/globals";
import {
  SESSION_REPLAY_RECORDER_ACTIVE_WINDOW_MS,
  SESSION_REPLAY_REFUSAL_ALERT_THRESHOLD,
  SESSION_REPLAY_STALE_CHUNK_MS,
  diagnoseRecordingHealth,
  formatBytesForCopy,
  formatCountForCopy,
  formatDurationForCopy,
  formatRelativeAge,
  getTopRefusal,
  parseHealthTimestamp,
  parseRecordingHealthStatus,
} from "../../../Utils/Rum/SessionReplayHealth";
import {
  RecordingHealthDiagnosis,
  RecordingHealthStatus,
  SESSION_REPLAY_REFUSAL_REASONS,
  SessionReplayRefusalCount,
  SessionReplayRefusalReason,
} from "../../../Types/Rum/SessionReplayHealth";
import SessionReplayCaptureTrigger from "../../../Types/Rum/SessionReplayCaptureTrigger";
import SessionReplayConsentMode from "../../../Types/Rum/SessionReplayConsentMode";

/*
 * Boundary and invalid-input coverage for the recording-health helpers.
 * SessionReplayHealthDiagnosis.test.ts walks the priority table one state
 * at a time; this suite pins the edges between those states and the parse
 * of hostile or partial wire bodies.
 */

const NOW: number = Date.UTC(2026, 8, 13, 12, 0, 0);
const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;
const MB: number = 1024 * 1024;
const GB: number = 1024 * MB;

function iso(offsetMs: number): string {
  return new Date(NOW + offsetMs).toISOString();
}

function status(
  overrides?: Partial<RecordingHealthStatus>,
): RecordingHealthStatus {
  const base: RecordingHealthStatus = {
    appIdentifier: "acme-web",
    allowedOrigins: ["https://acme.com"],
    policy: {
      isProjectEnabled: true,
      isApplicationEnabled: true,
      captureTrigger: SessionReplayCaptureTrigger.Always,
      samplePercentage: 100,
      consentMode: SessionReplayConsentMode.NotRequired,
      maskingMode: "MaskSensitiveInputsOnly",
      retentionInDays: 7,
    },
    publishedRecorderVersion: "1.2.3",
    lastConfigFetchAt: iso(-5 * SECOND),
    lastChunkReceivedAt: iso(-12 * SECOND),
    lastSessionStartedAt: iso(-2 * MINUTE),
    budgetExceededAt: null,
    sessionsLast24h: 143,
    playableSessionsLast24h: 120,
    refusalsLast24h: [],
    projectBytesUsedToday: 10 * MB,
    dailyByteLimit: GB,
    applicationBytesUsedThisMonth: 200 * MB,
    monthlyBudgetInGB: 2,
  };

  return { ...base, ...overrides } as RecordingHealthStatus;
}

function withPolicy(
  policy: Partial<RecordingHealthStatus["policy"]>,
  overrides?: Partial<RecordingHealthStatus>,
): RecordingHealthStatus {
  const base: RecordingHealthStatus = status(overrides);

  return {
    ...base,
    policy: { ...base.policy, ...policy },
  } as RecordingHealthStatus;
}

function diagnose(
  value: RecordingHealthStatus | null,
  now: number = NOW,
): RecordingHealthDiagnosis {
  return diagnoseRecordingHealth(value, now);
}

describe("exported thresholds", () => {
  test("have the documented values", () => {
    expect(SESSION_REPLAY_REFUSAL_ALERT_THRESHOLD).toBe(5);
    expect(SESSION_REPLAY_STALE_CHUNK_MS).toBe(6 * HOUR);
    expect(SESSION_REPLAY_RECORDER_ACTIVE_WINDOW_MS).toBe(DAY);
  });

  test("a recorder can be stale before it stops counting as active", () => {
    expect(SESSION_REPLAY_STALE_CHUNK_MS).toBeLessThan(
      SESSION_REPLAY_RECORDER_ACTIVE_WINDOW_MS,
    );
  });
});

describe("formatRelativeAge", () => {
  test.each([
    [0, "just now"],
    [999, "just now"],
    [SECOND, "1s ago"],
    [MINUTE - 1, "59s ago"],
    [MINUTE, "1m ago"],
    [HOUR - 1, "59m ago"],
    [HOUR, "1h ago"],
    [DAY - 1, "23h ago"],
    [DAY, "1d ago"],
    [400 * DAY, "400d ago"],
  ])("an age of %p ms reads %p", (ageMs: number, expected: string) => {
    expect(formatRelativeAge(NOW - ageMs, NOW)).toBe(expected);
  });

  test("any future timestamp (clock skew) reads just now, however far ahead", () => {
    expect(formatRelativeAge(NOW + 1, NOW)).toBe("just now");
    expect(formatRelativeAge(NOW + 30 * DAY, NOW)).toBe("just now");
  });

  test.each([
    [NaN, NOW],
    [NOW, NaN],
    [Infinity, NOW],
    [-Infinity, NOW],
    [NOW, Infinity],
  ])(
    "non-finite input (%p, %p) reads unknown, never 0s ago",
    (from: number, now: number) => {
      expect(formatRelativeAge(from, now)).toBe("unknown");
    },
  );
});

describe("formatDurationForCopy", () => {
  test.each([
    [0, "0s"],
    [999, "0s"],
    [SECOND, "1s"],
    [MINUTE - 1, "59s"],
    [MINUTE, "1m"],
    [HOUR - 1, "59m"],
    [HOUR, "1h"],
    [6 * HOUR + 59 * MINUTE, "6h"],
    [DAY - 1, "23h"],
    [DAY, "1d"],
    [45 * DAY, "45d"],
  ])("%p ms reads %p", (durationMs: number, expected: string) => {
    expect(formatDurationForCopy(durationMs)).toBe(expected);
  });

  test.each([-1, -DAY, NaN, Infinity, -Infinity])(
    "%p reads unknown",
    (durationMs: number) => {
      expect(formatDurationForCopy(durationMs)).toBe("unknown");
    },
  );
});

describe("formatCountForCopy", () => {
  test.each([
    [1, "1"],
    [12, "12"],
    [123, "123"],
    [1234, "1,234"],
    [12345, "12,345"],
    [100000, "100,000"],
    [999999, "999,999"],
    [1000000, "1,000,000"],
    [9876543210, "9,876,543,210"],
  ])("%p reads %p", (count: number, expected: string) => {
    expect(formatCountForCopy(count)).toBe(expected);
  });

  test("floors fractions rather than rounding up", () => {
    expect(formatCountForCopy(1.9)).toBe("1");
    expect(formatCountForCopy(1999.999)).toBe("1,999");
  });

  test("clamps negatives to 0", () => {
    expect(formatCountForCopy(-5)).toBe("0");
    expect(formatCountForCopy(-0.5)).toBe("0");
  });

  test.each([null, NaN, Infinity, -Infinity])(
    "%p reads unknown",
    (count: number | null) => {
      expect(formatCountForCopy(count)).toBe("unknown");
    },
  );
});

describe("formatBytesForCopy", () => {
  test.each([
    [0, "0 MB"],
    [MB / 2, "1 MB"],
    [MB / 2 - 1, "0 MB"],
    [1023 * MB, "1023 MB"],
    [GB, "1 GB"],
    [10 * GB, "10 GB"],
    [1.5 * GB, "1.5 GB"],
    [1.75 * GB, "1.8 GB"],
  ])("%p bytes reads %p", (bytes: number, expected: string) => {
    expect(formatBytesForCopy(bytes)).toBe(expected);
  });

  test("switches to GB exactly at one gibibyte", () => {
    expect(formatBytesForCopy(GB - 1)).toBe("1024 MB");
    expect(formatBytesForCopy(GB)).toBe("1 GB");
  });

  test.each([-1, NaN, Infinity, -Infinity])(
    "%p reads unknown",
    (bytes: number) => {
      expect(formatBytesForCopy(bytes)).toBe("unknown");
    },
  );
});

describe("parseHealthTimestamp", () => {
  test("parses ISO strings with a zone offset", () => {
    expect(parseHealthTimestamp("2026-09-13T14:00:00+02:00")).toBe(NOW);
    expect(parseHealthTimestamp("2026-09-13T12:00:00.000Z")).toBe(NOW);
  });

  test("a date-only ISO string is midnight UTC", () => {
    expect(parseHealthTimestamp("2026-09-13")).toBe(Date.UTC(2026, 8, 13));
  });

  test("the epoch itself is a real timestamp, not absent", () => {
    expect(parseHealthTimestamp("1970-01-01T00:00:00.000Z")).toBe(0);
  });

  test.each(["", "not a date", "2026-13-45T99:99:99Z"])(
    "%p is null",
    (value: string) => {
      expect(parseHealthTimestamp(value)).toBeNull();
    },
  );

  test("a non-string that slipped past the type is null", () => {
    expect(parseHealthTimestamp(NOW as unknown as string)).toBeNull();
    expect(parseHealthTimestamp(undefined as unknown as string)).toBeNull();
  });
});

describe("getTopRefusal", () => {
  test("a single entry is the top one, even with a zero count", () => {
    const only: SessionReplayRefusalCount = {
      reason: "rate-limited",
      count: 0,
    };

    expect(getTopRefusal([only])).toBe(only);
  });

  test("ties keep the first entry seen", () => {
    expect(
      getTopRefusal([
        { reason: "not-enabled", count: 7 },
        { reason: "rate-limited", count: 7 },
      ]),
    ).toEqual({ reason: "not-enabled", count: 7 });
  });

  test("finds the maximum wherever it sits", () => {
    expect(
      getTopRefusal([
        { reason: "not-sampled", count: 1 },
        { reason: "rate-limited", count: 2 },
        { reason: "consent-required", count: 50 },
      ]),
    ).toEqual({ reason: "consent-required", count: 50 });
  });

  test("returns the entry object itself rather than a copy", () => {
    const refusals: Array<SessionReplayRefusalCount> = [
      { reason: "not-sampled", count: 1 },
      { reason: "rate-limited", count: 2 },
    ];

    expect(getTopRefusal(refusals)).toBe(refusals[1]);
  });
});

describe("parseRecordingHealthStatus - invalid and partial bodies", () => {
  test.each([undefined, 0, 42, true, false, "{}", [], [{ a: 1 }]])(
    "%p is not a status",
    (raw: unknown) => {
      expect(parseRecordingHealthStatus(raw)).toBeNull();
    },
  );

  test("an empty object parses to a fully defaulted, switched-off status", () => {
    const parsed: RecordingHealthStatus | null = parseRecordingHealthStatus({});

    expect(parsed).toEqual({
      appIdentifier: "",
      allowedOrigins: [],
      policy: {
        isProjectEnabled: false,
        isApplicationEnabled: false,
        captureTrigger: "",
        samplePercentage: 0,
        consentMode: "",
        maskingMode: "",
        retentionInDays: null,
      },
      publishedRecorderVersion: null,
      lastConfigFetchAt: null,
      lastChunkReceivedAt: null,
      lastSessionStartedAt: null,
      budgetExceededAt: null,
      sessionsLast24h: null,
      playableSessionsLast24h: null,
      refusalsLast24h: null,
      dropsLast24h: null,
      recorderCapabilities: null,
      projectBytesUsedToday: null,
      dailyByteLimit: 0,
      applicationBytesUsedThisMonth: null,
      monthlyBudgetInGB: null,
    });
    expect(diagnose(parsed).state).toBe("disabled-project");
  });

  test("booleans accept true, 1 and '1' only", () => {
    const read: (value: unknown) => boolean = (value: unknown): boolean => {
      return parseRecordingHealthStatus({ isProjectAllowed: value })!.policy
        .isProjectEnabled;
    };

    expect(read(true)).toBe(true);
    expect(read(1)).toBe(true);
    expect(read("1")).toBe(true);
    expect(read("true")).toBe(false);
    expect(read(2)).toBe(false);
    expect(read("yes")).toBe(false);
    expect(read(null)).toBe(false);
  });

  test("a non-numeric sample percentage or daily limit reads as 0", () => {
    const parsed: RecordingHealthStatus = parseRecordingHealthStatus({
      samplePercentage: "lots",
      dailyByteLimit: null,
    })!;

    expect(parsed.policy.samplePercentage).toBe(0);
    expect(parsed.dailyByteLimit).toBe(0);
  });

  test("numeric strings are read as numbers", () => {
    const parsed: RecordingHealthStatus = parseRecordingHealthStatus({
      samplePercentage: "25",
      dailyByteLimit: "1073741824",
      projectBytesUsedToday: "512",
      monthlyBudgetInGB: "3",
    })!;

    expect(parsed.policy.samplePercentage).toBe(25);
    expect(parsed.dailyByteLimit).toBe(GB);
    expect(parsed.projectBytesUsedToday).toBe(512);
    expect(parsed.monthlyBudgetInGB).toBe(3);
  });

  test("a counter measured as 0 stays 0; only absent, null, '' or garbage is null", () => {
    const parsed: RecordingHealthStatus = parseRecordingHealthStatus({
      sessionsLast24h: 0,
      playableSessionsLast24h: "",
      projectBytesUsedToday: "NaN",
      applicationBytesUsedThisMonth: null,
      retentionInDays: 0,
    })!;

    expect(parsed.sessionsLast24h).toBe(0);
    expect(parsed.playableSessionsLast24h).toBeNull();
    expect(parsed.projectBytesUsedToday).toBeNull();
    expect(parsed.applicationBytesUsedThisMonth).toBeNull();
    expect(parsed.policy.retentionInDays).toBe(0);
  });

  test("nullable strings: empty and non-string values are null", () => {
    const parsed: RecordingHealthStatus = parseRecordingHealthStatus({
      publishedRecorderVersion: "",
      lastConfigFetchAt: 1234,
      lastChunkReceivedAt: { at: "now" },
      budgetExceededAt: false,
      lastSessionStartedAt: iso(0),
    })!;

    expect(parsed.publishedRecorderVersion).toBeNull();
    expect(parsed.lastConfigFetchAt).toBeNull();
    expect(parsed.lastChunkReceivedAt).toBeNull();
    expect(parsed.budgetExceededAt).toBeNull();
    expect(parsed.lastSessionStartedAt).toBe(iso(0));
  });

  test("allowed origins and capabilities are stringified; a non-array origin list is empty", () => {
    expect(
      parseRecordingHealthStatus({
        allowedOrigins: ["https://a.com", 7, true],
        recorderCapabilities: ["clicks", 3],
      }),
    ).toMatchObject({
      allowedOrigins: ["https://a.com", "7", "true"],
      recorderCapabilities: ["clicks", "3"],
    });

    expect(
      parseRecordingHealthStatus({
        allowedOrigins: "https://a.com",
        recorderCapabilities: "clicks",
      }),
    ).toMatchObject({ allowedOrigins: [], recorderCapabilities: null });
  });

  test("a refusal list that is not an array is unknown, not empty", () => {
    expect(
      parseRecordingHealthStatus({ refusalsLast24h: { "not-sampled": 3 } })!
        .refusalsLast24h,
    ).toBeNull();
    expect(
      parseRecordingHealthStatus({ refusalsLast24h: "[]" })!.refusalsLast24h,
    ).toBeNull();
  });

  test("refusal entries without a usable count or with a malformed shape are dropped; a 0 count is kept", () => {
    const parsed: RecordingHealthStatus = parseRecordingHealthStatus({
      refusalsLast24h: [
        { reason: "not-sampled", count: 0 },
        { reason: "rate-limited", count: "abc" },
        { reason: "rate-limited", count: null },
        { reason: "rate-limited", count: "" },
        { reason: "ORIGIN-NOT-ALLOWED", count: 9 },
        { count: 9 },
        "origin-not-allowed",
        42,
        ["origin-not-allowed", 9],
        { reason: "consent-required", count: "12" },
      ],
    })!;

    expect(parsed.refusalsLast24h).toEqual([
      { reason: "not-sampled", count: 0 },
      { reason: "consent-required", count: 12 },
    ]);
  });

  test("every reason in the closed vocabulary survives the parse", () => {
    const parsed: RecordingHealthStatus = parseRecordingHealthStatus({
      refusalsLast24h: SESSION_REPLAY_REFUSAL_REASONS.map(
        (reason: SessionReplayRefusalReason, index: number) => {
          return { reason: reason, count: index };
        },
      ),
    })!;

    expect(
      parsed.refusalsLast24h!.map((entry: SessionReplayRefusalCount) => {
        return entry.reason;
      }),
    ).toEqual([...SESSION_REPLAY_REFUSAL_REASONS]);
  });

  test("drops keep unknown reasons but skip blank or non-string reasons and missing counts", () => {
    const parsed: RecordingHealthStatus = parseRecordingHealthStatus({
      dropsLast24h: [
        { reason: "scrub-incomplete", count: 12 },
        { reason: "brand-new-reason", count: "3" },
        { reason: "", count: 4 },
        { reason: 5, count: 4 },
        { reason: "over-cap" },
        null,
      ],
    })!;

    expect(parsed.dropsLast24h).toEqual([
      { reason: "scrub-incomplete", count: 12 },
      { reason: "brand-new-reason", count: 3 },
    ]);
  });

  test("does not mutate the raw body", () => {
    const raw: Record<string, unknown> = {
      isProjectAllowed: 1,
      refusalsLast24h: [{ reason: "not-sampled", count: "3" }],
    };
    const snapshot: string = JSON.stringify(raw);

    parseRecordingHealthStatus(raw);

    expect(JSON.stringify(raw)).toBe(snapshot);
  });
});

describe("diagnoseRecordingHealth - budget boundaries", () => {
  test("daily: usage exactly at the limit is paused; one byte under is not", () => {
    expect(
      diagnose(status({ projectBytesUsedToday: GB, dailyByteLimit: GB })).state,
    ).toBe("budget-paused");
    expect(
      diagnose(status({ projectBytesUsedToday: GB - 1, dailyByteLimit: GB }))
        .state,
    ).toBe("healthy");
  });

  test("daily: a zero limit means no limit, whatever the usage", () => {
    expect(
      diagnose(status({ projectBytesUsedToday: 50 * GB, dailyByteLimit: 0 }))
        .state,
    ).toBe("healthy");
  });

  test("daily: quantifies both the limit and the usage", () => {
    const diagnosis: RecordingHealthDiagnosis = diagnose(
      status({ projectBytesUsedToday: 2.5 * GB, dailyByteLimit: 2 * GB }),
    );

    expect(diagnosis).toEqual({
      state: "budget-paused",
      severity: "error",
      title: "Uploads paused for today",
      detail:
        "This project used its 2 GB daily budget for session replay (2.5 GB used). Uploads resume tomorrow.",
      action: { label: "Review the budget", target: "budget" },
    });
  });

  test("monthly: usage exactly at the budget still counts as paused; one byte under clears the stamp", () => {
    expect(
      diagnose(
        status({
          budgetExceededAt: iso(-HOUR),
          monthlyBudgetInGB: 2,
          applicationBytesUsedThisMonth: 2 * GB,
        }),
      ).state,
    ).toBe("budget-paused");
    expect(
      diagnose(
        status({
          budgetExceededAt: iso(-HOUR),
          monthlyBudgetInGB: 2,
          applicationBytesUsedThisMonth: 2 * GB - 1,
        }),
      ).state,
    ).toBe("healthy");
  });

  test("monthly: a zero budget cannot clear the stamp", () => {
    expect(
      diagnose(
        status({
          budgetExceededAt: iso(-HOUR),
          monthlyBudgetInGB: 0,
          applicationBytesUsedThisMonth: 0,
        }),
      ).state,
    ).toBe("budget-paused");
  });

  test("monthly: an unknown budget says 'its monthly budget' without a number", () => {
    const diagnosis: RecordingHealthDiagnosis = diagnose(
      status({ budgetExceededAt: iso(-3 * HOUR), monthlyBudgetInGB: null }),
    );

    expect(diagnosis.title).toBe("Uploads paused 3h ago");
    expect(diagnosis.detail).toBe(
      "This application used its monthly budget. Uploads resume next month, or as soon as the budget is raised.",
    );
  });

  test("monthly: an unparseable stamp still pauses, but the title claims no age", () => {
    const diagnosis: RecordingHealthDiagnosis = diagnose(
      status({
        budgetExceededAt: "yesterday-ish",
        applicationBytesUsedThisMonth: null,
      }),
    );

    expect(diagnosis.state).toBe("budget-paused");
    expect(diagnosis.title).toBe("Uploads paused");
  });

  test("monthly wins over daily when both are spent", () => {
    const diagnosis: RecordingHealthDiagnosis = diagnose(
      status({
        budgetExceededAt: iso(-DAY),
        applicationBytesUsedThisMonth: null,
        projectBytesUsedToday: GB,
        dailyByteLimit: GB,
      }),
    );

    expect(diagnosis.action?.label).toBe("Raise the budget");
    expect(diagnosis.title).toBe("Uploads paused 1d ago");
  });
});

describe("diagnoseRecordingHealth - refusal boundaries", () => {
  test("exactly the threshold is refusing; one below is not", () => {
    expect(
      diagnose(
        status({
          refusalsLast24h: [
            {
              reason: "rate-limited",
              count: SESSION_REPLAY_REFUSAL_ALERT_THRESHOLD,
            },
          ],
        }),
      ).state,
    ).toBe("refusing");
    expect(
      diagnose(
        status({
          refusalsLast24h: [
            {
              reason: "rate-limited",
              count: SESSION_REPLAY_REFUSAL_ALERT_THRESHOLD - 1,
            },
          ],
        }),
      ).state,
    ).toBe("healthy");
  });

  test("the threshold applies to the top reason, not to the sum of all reasons", () => {
    expect(
      diagnose(
        status({
          refusalsLast24h: [
            { reason: "rate-limited", count: 4 },
            { reason: "not-sampled", count: 4 },
            { reason: "origin-not-allowed", count: 4 },
          ],
        }),
      ).state,
    ).toBe("healthy");
  });

  test("a reason with no fix in the product carries no action key at all", () => {
    const diagnosis: RecordingHealthDiagnosis = diagnose(
      status({ refusalsLast24h: [{ reason: "rate-limited", count: 1200 }] }),
    );

    expect(diagnosis.title).toBe("1,200 uploads refused in 24h: rate limited");
    expect(diagnosis.severity).toBe("warning");
    expect(Object.prototype.hasOwnProperty.call(diagnosis, "action")).toBe(
      false,
    );
  });

  test("no refusal title ever shows the bare kebab-case reason code", () => {
    for (const reason of SESSION_REPLAY_REFUSAL_REASONS) {
      const diagnosis: RecordingHealthDiagnosis = diagnose(
        status({ refusalsLast24h: [{ reason: reason, count: 10 }] }),
      );

      expect(diagnosis.state).toBe("refusing");
      expect(diagnosis.title).not.toContain(reason);
      expect(diagnosis.detail.length).toBeGreaterThan(0);
    }
  });

  test("a parsed wire body with an origin problem diagnoses end to end", () => {
    const parsed: RecordingHealthStatus | null = parseRecordingHealthStatus({
      isProjectAllowed: true,
      isApplicationEnabled: true,
      appIdentifier: "acme-web",
      samplePercentage: 100,
      dailyByteLimit: GB,
      lastConfigFetchAt: iso(-MINUTE),
      refusalsLast24h: [
        { reason: "origin-not-allowed", count: "340" },
        { reason: "not-sampled", count: 2 },
      ],
    });

    expect(diagnose(parsed)).toEqual({
      state: "refusing",
      severity: "warning",
      title: "340 uploads refused in 24h: origin not allowed",
      detail:
        "Requests came from an origin that is not in your allowed origins.",
      action: { label: "Edit allowed origins", target: "allowed-origins" },
    });
  });
});

describe("diagnoseRecordingHealth - loading and staleness boundaries", () => {
  test("disabled-app omits the 'for' suffix when the identifier is unknown", () => {
    expect(
      diagnose(
        withPolicy({ isApplicationEnabled: false }, { appIdentifier: "" }),
      ).title,
    ).toBe("Session replay is switched off");
  });

  test("never-loaded omits the 'for' suffix when the identifier is unknown", () => {
    expect(
      diagnose(
        status({
          appIdentifier: "",
          lastConfigFetchAt: null,
          lastChunkReceivedAt: null,
        }),
      ).title,
    ).toBe("The recorder has never loaded");
  });

  test("two unparseable stamps are never-loaded, not a crash", () => {
    expect(
      diagnose(
        status({ lastConfigFetchAt: "nope", lastChunkReceivedAt: "nope" }),
      ).state,
    ).toBe("never-loaded");
  });

  test("a negative sample percentage is treated like 0%", () => {
    const diagnosis: RecordingHealthDiagnosis = diagnose(
      withPolicy(
        { samplePercentage: -10 },
        { lastChunkReceivedAt: null, lastConfigFetchAt: iso(-MINUTE) },
      ),
    );

    expect(diagnosis.state).toBe("loaded-never-uploaded");
    expect(diagnosis.action).toEqual({
      label: "Set sampling to 100%",
      target: "app-settings",
    });
  });

  test("a config fetch stamped in the future still reads as just now", () => {
    expect(
      diagnose(
        status({
          lastChunkReceivedAt: null,
          lastConfigFetchAt: iso(5 * MINUTE),
        }),
      ).title,
    ).toBe("The recorder loaded just now but nothing has been uploaded");
  });

  test("the active window is inclusive: a policy fetch exactly 24h ago still means stale", () => {
    const base: Partial<RecordingHealthStatus> = {
      lastChunkReceivedAt: iso(-2 * DAY),
    };

    expect(
      diagnose(
        status({
          ...base,
          lastConfigFetchAt: iso(-SESSION_REPLAY_RECORDER_ACTIVE_WINDOW_MS),
        }),
      ).state,
    ).toBe("stale");
    expect(
      diagnose(
        status({
          ...base,
          lastConfigFetchAt: iso(-SESSION_REPLAY_RECORDER_ACTIVE_WINDOW_MS - 1),
        }),
      ).state,
    ).toBe("healthy-quiet");
  });

  test("stale carries the policy-specific explanation and action", () => {
    const diagnosis: RecordingHealthDiagnosis = diagnose(
      withPolicy(
        { consentMode: SessionReplayConsentMode.RequireExplicit },
        {
          lastChunkReceivedAt: iso(-7 * HOUR),
          lastConfigFetchAt: iso(-2 * MINUTE),
        },
      ),
    );

    expect(diagnosis.state).toBe("stale");
    expect(diagnosis.title).toBe(
      "No chunk for 7h while the recorder keeps loading",
    );
    expect(diagnosis.detail).toContain(
      "The recorder last fetched its policy 2m ago, but the last chunk arrived 7h ago.",
    );
    expect(diagnosis.detail).toContain("Waiting for consent");
    expect(diagnosis.action).toEqual({
      label: "How consent works",
      target: "docs-consent",
    });
  });

  test("an older server (no config stamp) with a recent chunk is simply healthy", () => {
    expect(
      diagnose(
        status({
          lastConfigFetchAt: null,
          lastChunkReceivedAt: iso(-SESSION_REPLAY_STALE_CHUNK_MS),
        }),
      ).state,
    ).toBe("healthy");
  });

  test("a chunk stamped in the future (clock skew) is healthy and 'just now'", () => {
    const diagnosis: RecordingHealthDiagnosis = diagnose(
      status({ lastChunkReceivedAt: iso(30 * SECOND) }),
    );

    expect(diagnosis.state).toBe("healthy");
    expect(diagnosis.detail.startsWith("Last chunk just now - ")).toBe(true);
  });
});

describe("diagnoseRecordingHealth - healthy copy", () => {
  test("unknown session counter says so rather than printing 0", () => {
    expect(
      diagnose(status({ sessionsLast24h: null, playableSessionsLast24h: 5 }))
        .detail,
    ).toBe("Last chunk 12s ago - sessions in 24h: unknown - sampling 100%.");
  });

  test("an unknown playable counter drops the parenthetical", () => {
    expect(
      diagnose(status({ sessionsLast24h: 2500, playableSessionsLast24h: null }))
        .detail,
    ).toBe("Last chunk 12s ago - 2,500 sessions in 24h - sampling 100%.");
  });

  test("zero sessions is plural and a measured 0 playable is shown", () => {
    expect(
      diagnose(
        withPolicy(
          { samplePercentage: 25 },
          { sessionsLast24h: 0, playableSessionsLast24h: 0 },
        ),
      ).detail,
    ).toBe(
      "Last chunk 12s ago - 0 sessions in 24h (0 playable) - sampling 25%.",
    );
  });

  test("healthy offers no action", () => {
    const diagnosis: RecordingHealthDiagnosis = diagnose(status());

    expect(diagnosis.severity).toBe("ok");
    expect(diagnosis.action).toBeUndefined();
  });
});

describe("diagnoseRecordingHealth - purity", () => {
  test("does not mutate the status it is given", () => {
    const input: RecordingHealthStatus = status({
      refusalsLast24h: [
        { reason: "not-sampled", count: 1 },
        { reason: "origin-not-allowed", count: 9 },
      ],
      budgetExceededAt: iso(-HOUR),
      applicationBytesUsedThisMonth: 0,
    });
    const snapshot: string = JSON.stringify(input);

    diagnose(input);

    expect(JSON.stringify(input)).toBe(snapshot);
  });

  test("returns an equal diagnosis for repeated calls with the same input", () => {
    const input: RecordingHealthStatus = status({
      refusalsLast24h: [{ reason: "not-enabled", count: 10 }],
    });

    expect(diagnose(input)).toEqual(diagnose(input));
  });
});
