import { describe, expect, test } from "@jest/globals";
import {
  RecordingHealthDiagnosis,
  RecordingHealthStatus,
} from "Common/Types/Rum/SessionReplayHealth";
import {
  SESSION_REPLAY_RECORDER_ACTIVE_WINDOW_MS,
  SESSION_REPLAY_REFUSAL_ALERT_THRESHOLD,
  SESSION_REPLAY_STALE_CHUNK_MS,
  diagnoseRecordingHealth,
} from "Common/Utils/Rum/SessionReplayHealth";
import {
  HealthCounterBreakdown,
  RecordingPipelineStage,
  RecordingPipelineStageKey,
  USAGE_WARNING_PERCENT,
  UsageMeter,
  buildCounterBreakdown,
  buildRecordingPipeline,
  buildUsageMeter,
  describePollInterval,
} from "../../FeatureSet/Dashboard/src/Components/SessionReplay/RecordingHealthModel";

/*
 * The Replay Health page's model: what each pipeline stage says and what
 * colour it is, how refusals and drops are ranked, and what a byte meter
 * reads. Pure, so every branch runs against a fixed clock. The rendered page
 * is covered by Common/Tests/UI/Rum/RecordingHealthDashboard.test.tsx.
 *
 * The rule under test throughout: a value the server did not report is
 * "unknown" and neutral - never zero, never green - and a stage is only
 * amber or red when the status shows something wrong with that stage.
 */

const NOW: number = Date.parse("2026-09-05T10:00:00.000Z");
const SECOND_MS: number = 1000;
const MINUTE_MS: number = 60 * SECOND_MS;
const HOUR_MS: number = 60 * MINUTE_MS;
const DAY_MS: number = 24 * HOUR_MS;
const MB: number = 1024 * 1024;
const GB: number = 1024 * MB;

function iso(ageMs: number): string {
  return new Date(NOW - ageMs).toISOString();
}

function makeStatus(
  overrides?: Partial<RecordingHealthStatus>,
): RecordingHealthStatus {
  const base: RecordingHealthStatus = {
    appIdentifier: "acme-web",
    allowedOrigins: ["https://app.acme.com"],
    policy: {
      isProjectEnabled: true,
      isApplicationEnabled: true,
      captureTrigger: "Always",
      samplePercentage: 100,
      consentMode: "NotRequired",
      maskingMode: "MaskSensitiveInputsOnly",
      retentionInDays: 7,
    },
    publishedRecorderVersion: "1.4.0",
    lastConfigFetchAt: iso(45 * SECOND_MS),
    lastChunkReceivedAt: iso(30 * SECOND_MS),
    lastSessionStartedAt: iso(7 * MINUTE_MS),
    budgetExceededAt: null,
    sessionsLast24h: 143,
    playableSessionsLast24h: 120,
    refusalsLast24h: [],
    dropsLast24h: [],
    projectBytesUsedToday: 10 * MB,
    dailyByteLimit: GB,
    applicationBytesUsedThisMonth: null,
    monthlyBudgetInGB: null,
  };

  return { ...base, ...overrides } as RecordingHealthStatus;
}

function withPolicy(
  overrides: Partial<RecordingHealthStatus["policy"]>,
  statusOverrides?: Partial<RecordingHealthStatus>,
): RecordingHealthStatus {
  const status: RecordingHealthStatus = makeStatus(statusOverrides);

  return { ...status, policy: { ...status.policy, ...overrides } };
}

function pipeline(
  status: RecordingHealthStatus,
): Array<RecordingPipelineStage> {
  const diagnosis: RecordingHealthDiagnosis = diagnoseRecordingHealth(
    status,
    NOW,
  );

  return buildRecordingPipeline(status, diagnosis, NOW);
}

function stage(
  status: RecordingHealthStatus,
  key: RecordingPipelineStageKey,
): RecordingPipelineStage {
  const found: RecordingPipelineStage | undefined = pipeline(status).find(
    (entry: RecordingPipelineStage): boolean => {
      return entry.key === key;
    },
  );

  expect(found).toBeDefined();

  return found as RecordingPipelineStage;
}

describe("buildRecordingPipeline - shape", () => {
  test("is four stages in the order a recording passes through them", () => {
    expect(
      pipeline(makeStatus()).map((entry: RecordingPipelineStage): string => {
        return entry.key;
      }),
    ).toEqual(["recorder", "policy", "uploads", "sessions"]);
  });

  test("a healthy application is green end to end, with ages against the given clock", () => {
    const stages: Array<RecordingPipelineStage> = pipeline(makeStatus());

    expect(
      stages.map((entry: RecordingPipelineStage): string => {
        return entry.tone;
      }),
    ).toEqual(["ok", "ok", "ok", "ok"]);
    expect(stages[0]!.value).toBe("45s ago");
    expect(stages[1]!.value).toBe("100% sampled");
    expect(stages[2]!.value).toBe("30s ago");
    expect(stages[3]!.value).toBe("143");
  });

  test("every stage has a label and a caption, so no cell renders blank", () => {
    for (const entry of pipeline(makeStatus())) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.caption.length).toBeGreaterThan(0);
    }
  });

  test("labels are short enough for a quarter-width cell", () => {
    for (const entry of pipeline(makeStatus())) {
      expect({ label: entry.label, short: entry.label.length <= 18 }).toEqual({
        label: entry.label,
        short: true,
      });
    }
  });
});

describe("buildRecordingPipeline - recorder stage", () => {
  test("a recent policy fetch is ok and says when", () => {
    const recorder: RecordingPipelineStage = stage(makeStatus(), "recorder");

    expect(recorder.tone).toBe("ok");
    expect(recorder.value).toBe("45s ago");
    expect(recorder.caption).toContain("fetched the replay policy");
  });

  test("no fetch and no chunk is 'Never' and amber: the recorder is not installed", () => {
    const recorder: RecordingPipelineStage = stage(
      makeStatus({ lastConfigFetchAt: null, lastChunkReceivedAt: null }),
      "recorder",
    );

    expect(recorder.tone).toBe("warning");
    expect(recorder.value).toBe("Never");
  });

  test("no fetch stamp but a chunk arrived is neutral 'not reported' (an older server), never 'Never'", () => {
    const recorder: RecordingPipelineStage = stage(
      makeStatus({ lastConfigFetchAt: null }),
      "recorder",
    );

    expect(recorder.tone).toBe("neutral");
    expect(recorder.value).toBe("not reported");
    expect(recorder.caption).toContain("a chunk has arrived");
  });

  test("a fetch older than the active window is amber and quantified", () => {
    const recorder: RecordingPipelineStage = stage(
      makeStatus({
        lastConfigFetchAt: iso(
          SESSION_REPLAY_RECORDER_ACTIVE_WINDOW_MS + DAY_MS,
        ),
      }),
      "recorder",
    );

    expect(recorder.tone).toBe("warning");
    expect(recorder.value).toBe("2d ago");
    expect(recorder.caption).toBe("No page has loaded the recorder for 2d.");
  });

  test("a fetch exactly at the edge of the window is still ok", () => {
    expect(
      stage(
        makeStatus({
          lastConfigFetchAt: iso(SESSION_REPLAY_RECORDER_ACTIVE_WINDOW_MS),
        }),
        "recorder",
      ).tone,
    ).toBe("ok");
  });

  test("an unreadable timestamp is neutral 'unknown', never an age", () => {
    const recorder: RecordingPipelineStage = stage(
      makeStatus({ lastConfigFetchAt: "not-a-date" }),
      "recorder",
    );

    expect(recorder.tone).toBe("neutral");
    expect(recorder.value).toBe("unknown");
  });
});

describe("buildRecordingPipeline - policy stage", () => {
  test("the project switch off is red, and wins over the application switch", () => {
    const policy: RecordingPipelineStage = stage(
      withPolicy({ isProjectEnabled: false, isApplicationEnabled: false }),
      "policy",
    );

    expect(policy.tone).toBe("error");
    expect(policy.value).toBe("Off");
    expect(policy.caption).toContain("whole project");
  });

  test("the application switch off is red and names the application", () => {
    const policy: RecordingPipelineStage = stage(
      withPolicy({ isApplicationEnabled: false }),
      "policy",
    );

    expect(policy.tone).toBe("error");
    expect(policy.value).toBe("Off");
    expect(policy.caption).toContain("this application");
  });

  test("a spent daily budget reads 'Paused'", () => {
    const policy: RecordingPipelineStage = stage(
      makeStatus({ projectBytesUsedToday: GB, dailyByteLimit: GB }),
      "policy",
    );

    expect(policy.tone).toBe("error");
    expect(policy.value).toBe("Paused");
  });

  test("a spent monthly budget reads 'Paused'", () => {
    const policy: RecordingPipelineStage = stage(
      makeStatus({
        budgetExceededAt: iso(HOUR_MS),
        applicationBytesUsedThisMonth: 3 * GB,
        monthlyBudgetInGB: 2,
      }),
      "policy",
    );

    expect(policy.value).toBe("Paused");
  });

  test("an old budget stamp from a month that rolled over does not pause it", () => {
    expect(
      stage(
        makeStatus({
          budgetExceededAt: iso(40 * DAY_MS),
          applicationBytesUsedThisMonth: 100 * MB,
          monthlyBudgetInGB: 2,
        }),
        "policy",
      ).tone,
    ).toBe("ok");
  });

  test("0% sampling is red: it records nothing whatever the trigger", () => {
    for (const captureTrigger of ["Always", "OnErrorOrFrustration"]) {
      const policy: RecordingPipelineStage = stage(
        withPolicy({ samplePercentage: 0, captureTrigger }),
        "policy",
      );

      expect({
        captureTrigger,
        tone: policy.tone,
        value: policy.value,
      }).toEqual({ captureTrigger, tone: "error", value: "0% sampled" });
    }
  });

  test("partial sampling is ok and printed as a percentage", () => {
    const policy: RecordingPipelineStage = stage(
      withPolicy({ samplePercentage: 25 }),
      "policy",
    );

    expect(policy.tone).toBe("ok");
    expect(policy.value).toBe("25% sampled");
  });

  test("the caption names the trigger and whether uploads wait for consent", () => {
    expect(stage(makeStatus(), "policy").caption).toBe(
      "Always; no consent prompt required.",
    );
    expect(
      stage(
        withPolicy({
          captureTrigger: "OnErrorOrFrustration",
          consentMode: "RequireExplicit",
        }),
        "policy",
      ).caption,
    ).toBe("On error or frustration; uploads wait for grantConsent().");
  });

  test("an unrecognised trigger never leaks the raw enum into the caption", () => {
    expect(
      stage(withPolicy({ captureTrigger: "SomethingNew" }), "policy").caption,
    ).not.toContain("SomethingNew");
  });
});

describe("buildRecordingPipeline - uploads stage", () => {
  test("refusals at the alert threshold are amber, counted in total and named by their top reason", () => {
    const uploads: RecordingPipelineStage = stage(
      makeStatus({
        refusalsLast24h: [
          { reason: "rate-limited", count: 2 },
          {
            reason: "origin-not-allowed",
            count: SESSION_REPLAY_REFUSAL_ALERT_THRESHOLD,
          },
        ],
      }),
      "uploads",
    );

    expect(uploads.tone).toBe("warning");
    expect(uploads.value).toBe(
      `${SESSION_REPLAY_REFUSAL_ALERT_THRESHOLD + 2} refused`,
    );
    expect(uploads.caption).toBe("In the last 24h, mostly origin not allowed.");
  });

  test("refusals below the threshold do not colour the stage", () => {
    expect(
      stage(
        makeStatus({
          refusalsLast24h: [
            {
              reason: "origin-not-allowed",
              count: SESSION_REPLAY_REFUSAL_ALERT_THRESHOLD - 1,
            },
          ],
        }),
        "uploads",
      ).tone,
    ).toBe("ok");
  });

  test("large refusal totals are formatted with separators", () => {
    expect(
      stage(
        makeStatus({
          refusalsLast24h: [{ reason: "not-sampled", count: 12345 }],
        }),
        "uploads",
      ).value,
    ).toBe("12,345 refused");
  });

  test("loaded but nothing uploaded is amber 'Never'", () => {
    const uploads: RecordingPipelineStage = stage(
      makeStatus({ lastChunkReceivedAt: null }),
      "uploads",
    );

    expect(uploads.tone).toBe("warning");
    expect(uploads.value).toBe("Never");
    expect(uploads.caption).toContain("The recorder loaded");
  });

  test("never loaded is neutral 'Never': the upload is not the stage that is wrong", () => {
    const uploads: RecordingPipelineStage = stage(
      makeStatus({ lastChunkReceivedAt: null, lastConfigFetchAt: null }),
      "uploads",
    );

    expect(uploads.tone).toBe("neutral");
    expect(uploads.caption).toContain("until a page loads the recorder");
  });

  test("a chunk older than the stale threshold is amber and quantified", () => {
    const uploads: RecordingPipelineStage = stage(
      makeStatus({
        lastChunkReceivedAt: iso(SESSION_REPLAY_STALE_CHUNK_MS + HOUR_MS),
      }),
      "uploads",
    );

    expect(uploads.tone).toBe("warning");
    expect(uploads.value).toBe("7h ago");
    expect(uploads.caption).toBe("No chunk has arrived for 7h.");
  });

  test("an unreadable chunk timestamp is neutral 'unknown'", () => {
    const uploads: RecordingPipelineStage = stage(
      makeStatus({ lastChunkReceivedAt: "garbage" }),
      "uploads",
    );

    expect(uploads.tone).toBe("neutral");
    expect(uploads.value).toBe("unknown");
  });

  test("a chunk stamped slightly in the future (clock skew) reads 'just now'", () => {
    expect(
      stage(makeStatus({ lastChunkReceivedAt: iso(-5 * SECOND_MS) }), "uploads")
        .value,
    ).toBe("just now");
  });
});

describe("buildRecordingPipeline - sessions stage", () => {
  test("an unread session counter is neutral 'unknown', never 0", () => {
    const sessions: RecordingPipelineStage = stage(
      makeStatus({ sessionsLast24h: null, playableSessionsLast24h: null }),
      "sessions",
    );

    expect(sessions.tone).toBe("neutral");
    expect(sessions.value).toBe("unknown");
  });

  test("zero sessions is neutral: a quiet day is not a fault on its own", () => {
    const sessions: RecordingPipelineStage = stage(
      makeStatus({ sessionsLast24h: 0, playableSessionsLast24h: 0 }),
      "sessions",
    );

    expect(sessions.tone).toBe("neutral");
    expect(sessions.value).toBe("0");
  });

  test("sessions with no playable footage are amber", () => {
    const sessions: RecordingPipelineStage = stage(
      makeStatus({ sessionsLast24h: 4, playableSessionsLast24h: 0 }),
      "sessions",
    );

    expect(sessions.tone).toBe("warning");
    expect(sessions.value).toBe("4");
    expect(sessions.caption).toContain("playable footage");
  });

  test("the caption counts playable sessions and says when the newest started", () => {
    expect(stage(makeStatus(), "sessions").caption).toBe(
      "120 playable; the newest started 7m ago.",
    );
  });

  test("an unreported playable count says so rather than printing 0", () => {
    const sessions: RecordingPipelineStage = stage(
      makeStatus({ playableSessionsLast24h: null, lastSessionStartedAt: null }),
      "sessions",
    );

    expect(sessions.tone).toBe("ok");
    expect(sessions.caption).toBe("Playable count not reported.");
  });

  test("large counts are formatted with separators", () => {
    expect(
      stage(
        makeStatus({ sessionsLast24h: 1234567, playableSessionsLast24h: 1000 }),
        "sessions",
      ).value,
    ).toBe("1,234,567");
  });
});

describe("buildCounterBreakdown", () => {
  test("null and undefined are unknown, apart from an empty list", () => {
    expect(buildCounterBreakdown(null)).toEqual({ kind: "unknown" });
    expect(buildCounterBreakdown(undefined)).toEqual({ kind: "unknown" });
    expect(buildCounterBreakdown([])).toEqual({ kind: "none" });
  });

  test("entries with no count are dropped, so a list of zeros is 'none'", () => {
    expect(
      buildCounterBreakdown([
        { reason: "rate-limited", count: 0 },
        { reason: "not-sampled", count: Number.NaN },
      ]),
    ).toEqual({ kind: "none" });
  });

  test("ranks largest first, ties by reason, and totals every row", () => {
    const breakdown: HealthCounterBreakdown = buildCounterBreakdown([
      { reason: "rate-limited", count: 3 },
      { reason: "origin-not-allowed", count: 12 },
      { reason: "consent-required", count: 3 },
    ]);

    expect(breakdown.kind).toBe("list");

    if (breakdown.kind !== "list") {
      return;
    }

    expect(breakdown.total).toBe(18);
    expect(
      breakdown.rows.map((row: { reason: string }): string => {
        return row.reason;
      }),
    ).toEqual(["origin-not-allowed", "consent-required", "rate-limited"]);
  });

  test("bars are relative to the largest row, with a visible minimum", () => {
    const breakdown: HealthCounterBreakdown = buildCounterBreakdown([
      { reason: "origin-not-allowed", count: 1000 },
      { reason: "rate-limited", count: 500 },
      { reason: "not-sampled", count: 1 },
    ]);

    if (breakdown.kind !== "list") {
      throw new Error("expected a list");
    }

    expect(
      breakdown.rows.map((row: { sharePercent: number }): number => {
        return row.sharePercent;
      }),
    ).toEqual([100, 50, 2]);
  });

  test("known refusal reasons get human copy; open-vocabulary drop reasons keep their slug", () => {
    const breakdown: HealthCounterBreakdown = buildCounterBreakdown([
      { reason: "origin-not-allowed", count: 2 },
      { reason: "scrub-incomplete", count: 1 },
    ]);

    if (breakdown.kind !== "list") {
      throw new Error("expected a list");
    }

    expect(breakdown.rows[0]!.label).toBe("origin not allowed");
    expect(breakdown.rows[1]!.label).toBeNull();
  });

  test("does not mutate the input it was given", () => {
    const entries: Array<{ reason: string; count: number }> = [
      { reason: "a", count: 1 },
      { reason: "b", count: 9 },
    ];

    buildCounterBreakdown(entries);

    expect(entries[0]!.reason).toBe("a");
  });
});

describe("buildUsageMeter", () => {
  test("an unread counter is unknown, never 0 MB", () => {
    expect(buildUsageMeter(null, GB)).toEqual({ kind: "unknown" });
    expect(buildUsageMeter(Number.NaN, GB)).toEqual({ kind: "unknown" });
  });

  test("no ceiling, a zero ceiling or a negative one is unlimited and still says what was used", () => {
    for (const limit of [null, 0, -1]) {
      expect(buildUsageMeter(3 * MB, limit)).toEqual({
        kind: "unlimited",
        usedCopy: "3 MB",
      });
    }
  });

  test("under the warning line is ok, with human units on both sides", () => {
    const meter: UsageMeter = buildUsageMeter(512 * MB, 2 * GB);

    expect(meter).toEqual({
      kind: "limited",
      usedCopy: "512 MB",
      limitCopy: "2 GB",
      percent: 25,
      tone: "ok",
    });
  });

  test(`at ${USAGE_WARNING_PERCENT}% it turns amber`, () => {
    const meter: UsageMeter = buildUsageMeter(
      (USAGE_WARNING_PERCENT / 100) * GB,
      GB,
    );

    expect(meter.kind === "limited" && meter.tone).toBe("warning");
  });

  test("at or over the ceiling it is red and the bar is clamped to 100", () => {
    const at: UsageMeter = buildUsageMeter(GB, GB);
    const over: UsageMeter = buildUsageMeter(3 * GB, GB);

    expect(at.kind === "limited" && at.tone).toBe("error");
    expect(over.kind === "limited" && over.percent).toBe(100);
    expect(over.kind === "limited" && over.usedCopy).toBe("3 GB");
  });

  test("a tiny amount rounds to 0% rather than claiming a share it does not have", () => {
    const meter: UsageMeter = buildUsageMeter(1, GB);

    expect(meter.kind === "limited" && meter.percent).toBe(0);
  });
});

describe("describePollInterval", () => {
  test("names the cadence the page refreshes at", () => {
    expect(describePollInterval(60 * 1000)).toBe("every minute");
    expect(describePollInterval(10 * 1000)).toBe("every 10s");
    expect(describePollInterval(5 * 60 * 1000)).toBe("every 5m");
  });

  test("a non-positive or non-finite interval is 'manually'", () => {
    expect(describePollInterval(0)).toBe("manually");
    expect(describePollInterval(Number.POSITIVE_INFINITY)).toBe("manually");
  });
});
