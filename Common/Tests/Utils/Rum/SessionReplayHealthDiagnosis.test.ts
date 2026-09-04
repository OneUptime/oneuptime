import { describe, expect, it } from "@jest/globals";
import {
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
  RecordingHealthState,
  RecordingHealthStatus,
  SESSION_REPLAY_REFUSAL_REASONS,
  SessionReplayRefusalReason,
  isSessionReplayRefusalReason,
} from "../../../Types/Rum/SessionReplayHealth";
import SessionReplayCaptureTrigger from "../../../Types/Rum/SessionReplayCaptureTrigger";
import SessionReplayConsentMode from "../../../Types/Rum/SessionReplayConsentMode";

/*
 * The diagnosis is the one sentence that tells a customer why nothing
 * recorded. Each state in the priority table gets a case, then the
 * tie-breaks (a higher state must win even when a lower one also holds),
 * then the null rules (unknown is never 0, a chunk proves the recorder
 * loaded).
 */

const NOW: number = Date.UTC(2026, 8, 4, 12, 0, 0);

function iso(offsetMs: number): string {
  return new Date(NOW + offsetMs).toISOString();
}

const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

/* A healthy application: everything on, sampling 100%, a chunk 12s ago. */
function healthy(
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
    projectBytesUsedToday: 10 * 1024 * 1024,
    dailyByteLimit: 1024 * 1024 * 1024,
    applicationBytesUsedThisMonth: 200 * 1024 * 1024,
    monthlyBudgetInGB: 2,
  };

  /*
   * Cast because exactOptionalPropertyTypes reads Partial<T> as "may be
   * undefined", which the required nullable fields are not; every caller
   * passes concrete values.
   */
  return { ...base, ...overrides } as RecordingHealthStatus;
}

function diagnose(
  status: RecordingHealthStatus | null,
): RecordingHealthDiagnosis {
  return diagnoseRecordingHealth(status, NOW);
}

describe("diagnoseRecordingHealth - one case per state, in priority order", () => {
  it("unknown: a null status says the health could not be loaded, and offers no action", () => {
    const result: RecordingHealthDiagnosis = diagnose(null);

    expect(result.state).toBe("unknown");
    expect(result.severity).toBe("info");
    expect(result.title).toBe("Recording health is unknown");
    expect(result.action).toBeUndefined();
  });

  it("disabled-project: names the project switch and links to project settings", () => {
    const result: RecordingHealthDiagnosis = diagnose(
      healthy({
        policy: { ...healthy().policy, isProjectEnabled: false },
      }),
    );

    expect(result.state).toBe("disabled-project");
    expect(result.severity).toBe("error");
    expect(result.title).toBe(
      "Session replay is switched off for this project",
    );
    expect(result.action).toEqual({
      label: "Turn it on",
      target: "project-settings",
    });
  });

  it("disabled-app: names the application and links to its settings", () => {
    const result: RecordingHealthDiagnosis = diagnose(
      healthy({
        policy: { ...healthy().policy, isApplicationEnabled: false },
      }),
    );

    expect(result.state).toBe("disabled-app");
    expect(result.severity).toBe("error");
    expect(result.title).toBe("Session replay is switched off for acme-web");
    expect(result.action?.target).toBe("app-settings");
  });

  it("budget-paused (monthly): quantifies the budget and says when uploads paused", () => {
    const result: RecordingHealthDiagnosis = diagnose(
      healthy({
        budgetExceededAt: iso(-3 * HOUR),
        applicationBytesUsedThisMonth: 3 * 1024 * 1024 * 1024,
        monthlyBudgetInGB: 2,
      }),
    );

    expect(result.state).toBe("budget-paused");
    expect(result.severity).toBe("error");
    expect(result.title).toBe("Uploads paused 3h ago");
    expect(result.detail).toContain("its 2 GB monthly budget");
    expect(result.action).toEqual({
      label: "Raise the budget",
      target: "budget",
    });
  });

  it("budget-paused (monthly): a stamp from a previous month is ignored once this month's usage sits under the budget", () => {
    const result: RecordingHealthDiagnosis = diagnose(
      healthy({
        budgetExceededAt: iso(-20 * DAY),
        applicationBytesUsedThisMonth: 100 * 1024 * 1024,
        monthlyBudgetInGB: 2,
      }),
    );

    expect(result.state).toBe("healthy");
  });

  it("budget-paused (monthly): the stamp is trusted when this month's usage is unknown", () => {
    const result: RecordingHealthDiagnosis = diagnose(
      healthy({
        budgetExceededAt: iso(-1 * HOUR),
        applicationBytesUsedThisMonth: null,
        monthlyBudgetInGB: null,
      }),
    );

    expect(result.state).toBe("budget-paused");
    expect(result.detail).toContain("its monthly budget");
  });

  it("budget-paused (daily): the project's daily limit is spent", () => {
    const result: RecordingHealthDiagnosis = diagnose(
      healthy({
        projectBytesUsedToday: 1024 * 1024 * 1024,
        dailyByteLimit: 1024 * 1024 * 1024,
      }),
    );

    expect(result.state).toBe("budget-paused");
    expect(result.title).toBe("Uploads paused for today");
    expect(result.detail).toContain("1 GB daily budget");
    expect(result.detail).toContain("(1 GB used)");
  });

  it("refusing: counts the top reason, replaces the code with words, and offers the matching action", () => {
    const result: RecordingHealthDiagnosis = diagnose(
      healthy({
        refusalsLast24h: [
          { reason: "not-sampled", count: 7 },
          { reason: "origin-not-allowed", count: 212 },
        ],
      }),
    );

    expect(result.state).toBe("refusing");
    expect(result.severity).toBe("warning");
    expect(result.title).toBe("212 uploads refused in 24h: origin not allowed");
    expect(result.title).not.toContain("origin-not-allowed");
    expect(result.detail).toBe(
      "Requests came from an origin that is not in your allowed origins.",
    );
    expect(result.action).toEqual({
      label: "Edit allowed origins",
      target: "allowed-origins",
    });
  });

  it("refusing: formats large counts with separators", () => {
    const result: RecordingHealthDiagnosis = diagnose(
      healthy({
        refusalsLast24h: [{ reason: "rate-limited", count: 12345 }],
      }),
    );

    expect(result.title).toBe("12,345 uploads refused in 24h: rate limited");
    /* Nothing on a settings page fixes a rate limit; no action offered. */
    expect(result.action).toBeUndefined();
  });

  it("refusing: below the alert threshold a refusal is noise, not the diagnosis", () => {
    const result: RecordingHealthDiagnosis = diagnose(
      healthy({
        refusalsLast24h: [
          {
            reason: "origin-not-allowed",
            count: SESSION_REPLAY_REFUSAL_ALERT_THRESHOLD - 1,
          },
        ],
      }),
    );

    expect(result.state).toBe("healthy");
  });

  it("refusing: has copy and a sensible action for every reason in the closed vocabulary", () => {
    const actionByReason: Record<
      SessionReplayRefusalReason,
      string | undefined
    > = {
      "ingest-disabled": undefined,
      "instance-not-offering-replay": undefined,
      "policy-unavailable": undefined,
      "not-enabled": "app-settings",
      "origin-not-allowed": "allowed-origins",
      "session-chunk-cap": undefined,
      "not-sampled": "app-settings",
      "rate-limited": undefined,
      "rate-counter-unavailable": undefined,
      "budget-exhausted": "budget",
      "budget-counter-unavailable": undefined,
      "app-monthly-budget-exhausted": "budget",
    };

    for (const reason of SESSION_REPLAY_REFUSAL_REASONS) {
      const result: RecordingHealthDiagnosis = diagnose(
        healthy({ refusalsLast24h: [{ reason: reason, count: 50 }] }),
      );

      expect(result.state).toBe("refusing");
      expect(result.title.startsWith("50 uploads refused in 24h: ")).toBe(true);
      /* The kebab-case code never leaks into the title. */
      expect(result.title).not.toContain(reason);
      expect(result.detail.length).toBeGreaterThan(20);
      expect(result.action?.target).toBe(actionByReason[reason]);
    }
  });

  it("never-loaded: both stamps null means the script tag was never reached", () => {
    const result: RecordingHealthDiagnosis = diagnose(
      healthy({ lastConfigFetchAt: null, lastChunkReceivedAt: null }),
    );

    expect(result.state).toBe("never-loaded");
    expect(result.severity).toBe("warning");
    expect(result.title).toBe("The recorder has never loaded for acme-web");
    expect(result.action).toEqual({
      label: "Open the setup guide",
      target: "setup-guide",
    });
  });

  it("loaded-never-uploaded: sample 0% is named as the cause with the sampling action", () => {
    const result: RecordingHealthDiagnosis = diagnose(
      healthy({
        lastConfigFetchAt: iso(-12 * SECOND),
        lastChunkReceivedAt: null,
        policy: { ...healthy().policy, samplePercentage: 0 },
      }),
    );

    expect(result.state).toBe("loaded-never-uploaded");
    expect(result.severity).toBe("warning");
    expect(result.title).toBe(
      "The recorder loaded 12s ago but nothing has been uploaded",
    );
    expect(result.detail).toContain(
      "Your sample percentage is 0%, so no session is recorded",
    );
    expect(result.action).toEqual({
      label: "Set sampling to 100%",
      target: "app-settings",
    });
  });

  it("loaded-never-uploaded: RequireExplicit consent is explained with the consent docs", () => {
    const result: RecordingHealthDiagnosis = diagnose(
      healthy({
        lastConfigFetchAt: iso(-2 * MINUTE),
        lastChunkReceivedAt: null,
        policy: {
          ...healthy().policy,
          consentMode: SessionReplayConsentMode.RequireExplicit,
        },
      }),
    );

    expect(result.state).toBe("loaded-never-uploaded");
    expect(result.detail).toContain(
      "the page has not called OneUptimeReplay.grantConsent()",
    );
    expect(result.action?.target).toBe("docs-consent");
  });

  it("loaded-never-uploaded: the error-only trigger is explained as a quiet day", () => {
    const result: RecordingHealthDiagnosis = diagnose(
      healthy({
        lastConfigFetchAt: iso(-1 * HOUR),
        lastChunkReceivedAt: null,
        policy: {
          ...healthy().policy,
          captureTrigger: SessionReplayCaptureTrigger.OnErrorOrFrustration,
        },
      }),
    );

    expect(result.state).toBe("loaded-never-uploaded");
    expect(result.detail).toContain(
      "Uploads only start when an error or frustration signal fires; a quiet day looks like nothing",
    );
    expect(result.action?.target).toBe("app-settings");
  });

  it("loaded-never-uploaded: sampling 0% wins over consent, and consent wins over the trigger", () => {
    const base: RecordingHealthStatus = healthy({
      lastConfigFetchAt: iso(-1 * MINUTE),
      lastChunkReceivedAt: null,
    });

    const all: RecordingHealthDiagnosis = diagnose({
      ...base,
      policy: {
        ...base.policy,
        samplePercentage: 0,
        consentMode: SessionReplayConsentMode.RequireExplicit,
        captureTrigger: SessionReplayCaptureTrigger.OnErrorOrFrustration,
      },
    });
    expect(all.detail).toContain("sample percentage is 0%");

    const consentAndTrigger: RecordingHealthDiagnosis = diagnose({
      ...base,
      policy: {
        ...base.policy,
        consentMode: SessionReplayConsentMode.RequireExplicit,
        captureTrigger: SessionReplayCaptureTrigger.OnErrorOrFrustration,
      },
    });
    expect(consentAndTrigger.action?.target).toBe("docs-consent");
  });

  it("loaded-never-uploaded: a healthy policy points at the request path (CSP / ad blocker)", () => {
    const result: RecordingHealthDiagnosis = diagnose(
      healthy({
        lastConfigFetchAt: iso(-30 * SECOND),
        lastChunkReceivedAt: null,
      }),
    );

    expect(result.state).toBe("loaded-never-uploaded");
    expect(result.detail).toContain("CSP");
    expect(result.action?.target).toBe("docs-csp");
  });

  it("stale: no chunk for over 6h while the recorder keeps fetching its policy", () => {
    const result: RecordingHealthDiagnosis = diagnose(
      healthy({
        lastConfigFetchAt: iso(-2 * MINUTE),
        lastChunkReceivedAt: iso(-7 * HOUR),
      }),
    );

    expect(result.state).toBe("stale");
    expect(result.severity).toBe("warning");
    expect(result.title).toBe(
      "No chunk for 7h while the recorder keeps loading",
    );
    expect(result.detail).toContain("last fetched its policy 2m ago");
    expect(result.detail).toContain("the last chunk arrived 7h ago");
    expect(result.action).toBeDefined();
  });

  it("stale: exactly at the threshold is still healthy; one ms past it is stale", () => {
    const atThreshold: RecordingHealthDiagnosis = diagnose(
      healthy({
        lastConfigFetchAt: iso(-1 * MINUTE),
        lastChunkReceivedAt: iso(-SESSION_REPLAY_STALE_CHUNK_MS),
      }),
    );
    expect(atThreshold.state).toBe("healthy");

    const pastThreshold: RecordingHealthDiagnosis = diagnose(
      healthy({
        lastConfigFetchAt: iso(-1 * MINUTE),
        lastChunkReceivedAt: iso(-SESSION_REPLAY_STALE_CHUNK_MS - 1),
      }),
    );
    expect(pastThreshold.state).toBe("stale");
  });

  it("healthy-quiet: no chunk for a while and the recorder is not loading either reads as quiet traffic", () => {
    const result: RecordingHealthDiagnosis = diagnose(
      healthy({
        lastConfigFetchAt: iso(-2 * DAY),
        lastChunkReceivedAt: iso(-2 * DAY),
      }),
    );

    expect(result.state).toBe("healthy-quiet");
    expect(result.severity).toBe("info");
    expect(result.title).toBe("No session recorded in the past 2d");
    expect(result.detail).toContain("the recorder last loaded 2d ago");
    expect(result.detail).toContain("sampling 100%");
    expect(result.action).toBeUndefined();
  });

  it("healthy-quiet: with no config stamp at all (older server) it says so instead of guessing", () => {
    const result: RecordingHealthDiagnosis = diagnose(
      healthy({
        lastConfigFetchAt: null,
        lastChunkReceivedAt: iso(-8 * HOUR),
      }),
    );

    expect(result.state).toBe("healthy-quiet");
    expect(result.detail).toContain("when the recorder last loaded is unknown");
  });

  it("healthy: quantifies the last chunk, the sessions and the sampling", () => {
    const result: RecordingHealthDiagnosis = diagnose(healthy());

    expect(result.state).toBe("healthy");
    expect(result.severity).toBe("ok");
    expect(result.title).toBe("Recording healthy");
    expect(result.detail).toBe(
      "Last chunk 12s ago - 143 sessions in 24h (120 playable) - sampling 100%.",
    );
    expect(result.action).toBeUndefined();
  });

  it("healthy: a single session is not pluralised", () => {
    const result: RecordingHealthDiagnosis = diagnose(
      healthy({ sessionsLast24h: 1, playableSessionsLast24h: null }),
    );

    expect(result.detail).toBe(
      "Last chunk 12s ago - 1 session in 24h - sampling 100%.",
    );
  });
});

describe("diagnoseRecordingHealth - tie-breaks", () => {
  it("disabled-project beats disabled-app, budget, refusals and never-loaded together", () => {
    const result: RecordingHealthDiagnosis = diagnose(
      healthy({
        policy: {
          ...healthy().policy,
          isProjectEnabled: false,
          isApplicationEnabled: false,
        },
        budgetExceededAt: iso(-1 * HOUR),
        refusalsLast24h: [{ reason: "origin-not-allowed", count: 500 }],
        lastConfigFetchAt: null,
        lastChunkReceivedAt: null,
      }),
    );

    expect(result.state).toBe("disabled-project");
  });

  it("disabled-app beats a spent budget", () => {
    const result: RecordingHealthDiagnosis = diagnose(
      healthy({
        policy: { ...healthy().policy, isApplicationEnabled: false },
        budgetExceededAt: iso(-1 * HOUR),
      }),
    );

    expect(result.state).toBe("disabled-app");
  });

  it("budget-paused beats refusing, even when the refusals are the budget's own", () => {
    const result: RecordingHealthDiagnosis = diagnose(
      healthy({
        budgetExceededAt: iso(-1 * HOUR),
        applicationBytesUsedThisMonth: 3 * 1024 * 1024 * 1024,
        refusalsLast24h: [
          { reason: "app-monthly-budget-exhausted", count: 900 },
        ],
      }),
    );

    expect(result.state).toBe("budget-paused");
  });

  it("refusing beats never-loaded: refused chunks prove something is posting", () => {
    const result: RecordingHealthDiagnosis = diagnose(
      healthy({
        refusalsLast24h: [{ reason: "origin-not-allowed", count: 20 }],
        lastConfigFetchAt: null,
        lastChunkReceivedAt: null,
      }),
    );

    expect(result.state).toBe("refusing");
  });

  it("refusing beats stale and healthy", () => {
    const result: RecordingHealthDiagnosis = diagnose(
      healthy({
        refusalsLast24h: [{ reason: "not-enabled", count: 6 }],
      }),
    );

    expect(result.state).toBe("refusing");
  });

  it("never-loaded beats loaded-never-uploaded only when the config stamp is null", () => {
    expect(
      diagnose(
        healthy({
          lastConfigFetchAt: iso(-1 * SECOND),
          lastChunkReceivedAt: null,
          policy: { ...healthy().policy, samplePercentage: 0 },
        }),
      ).state,
    ).toBe("loaded-never-uploaded");
  });

  it("stale beats healthy-quiet when the recorder is still loading", () => {
    expect(
      diagnose(
        healthy({
          lastConfigFetchAt: iso(-23 * HOUR),
          lastChunkReceivedAt: iso(-23 * HOUR),
        }),
      ).state,
    ).toBe("stale");

    expect(
      diagnose(
        healthy({
          lastConfigFetchAt: iso(-25 * HOUR),
          lastChunkReceivedAt: iso(-25 * HOUR),
        }),
      ).state,
    ).toBe("healthy-quiet");
  });

  it("is a pure function of (status, now): the same input yields the same diagnosis", () => {
    const status: RecordingHealthStatus = healthy();

    expect(diagnose(status)).toEqual(diagnose(status));
    expect(diagnoseRecordingHealth(status, NOW + DAY).state).toBe(
      "healthy-quiet",
    );
  });

  it("covers every state in the union", () => {
    const seen: Set<RecordingHealthState> = new Set<RecordingHealthState>([
      diagnose(null).state,
      diagnose(
        healthy({ policy: { ...healthy().policy, isProjectEnabled: false } }),
      ).state,
      diagnose(
        healthy({
          policy: { ...healthy().policy, isApplicationEnabled: false },
        }),
      ).state,
      diagnose(healthy({ budgetExceededAt: iso(-1), monthlyBudgetInGB: null }))
        .state,
      diagnose(
        healthy({ refusalsLast24h: [{ reason: "not-sampled", count: 5 }] }),
      ).state,
      diagnose(healthy({ lastConfigFetchAt: null, lastChunkReceivedAt: null }))
        .state,
      diagnose(healthy({ lastChunkReceivedAt: null })).state,
      diagnose(healthy({ lastChunkReceivedAt: iso(-7 * HOUR) })).state,
      diagnose(
        healthy({
          lastConfigFetchAt: iso(-3 * DAY),
          lastChunkReceivedAt: iso(-3 * DAY),
        }),
      ).state,
      diagnose(healthy()).state,
    ]);

    const every: Array<RecordingHealthState> = [
      "disabled-project",
      "disabled-app",
      "budget-paused",
      "refusing",
      "never-loaded",
      "loaded-never-uploaded",
      "stale",
      "healthy-quiet",
      "healthy",
      "unknown",
    ];

    for (const state of every) {
      expect(seen.has(state)).toBe(true);
    }
  });
});

describe("diagnoseRecordingHealth - null rules", () => {
  it("renders unknown counters as 'unknown', never as 0", () => {
    const result: RecordingHealthDiagnosis = diagnose(
      healthy({ sessionsLast24h: null, playableSessionsLast24h: null }),
    );

    expect(result.state).toBe("healthy");
    expect(result.detail).toContain("sessions in 24h: unknown");
    expect(result.detail).not.toContain("0 sessions");
  });

  it("treats a null refusal list (counter store down) as no evidence, not as 0 refusals", () => {
    const result: RecordingHealthDiagnosis = diagnose(
      healthy({ refusalsLast24h: null }),
    );

    expect(result.state).toBe("healthy");
  });

  it("a null lastConfigFetchAt with a non-null lastChunkReceivedAt is never never-loaded", () => {
    const result: RecordingHealthDiagnosis = diagnose(
      healthy({
        lastConfigFetchAt: null,
        lastChunkReceivedAt: iso(-10 * SECOND),
      }),
    );

    expect(result.state).toBe("healthy");
    expect(result.state).not.toBe("never-loaded");
  });

  it("a null daily counter never trips the daily budget", () => {
    const result: RecordingHealthDiagnosis = diagnose(
      healthy({ projectBytesUsedToday: null }),
    );

    expect(result.state).toBe("healthy");
  });

  it("an unparseable timestamp is treated as absent rather than as epoch", () => {
    const result: RecordingHealthDiagnosis = diagnose(
      healthy({ lastConfigFetchAt: "not a date", lastChunkReceivedAt: null }),
    );

    expect(result.state).toBe("never-loaded");
  });
});

describe("parseRecordingHealthStatus", () => {
  /* The exact JSON the /ingest-status handler answers today. */
  const legacyWire: Record<string, unknown> = {
    isProjectAllowed: true,
    isApplicationEnabled: true,
    appIdentifier: "acme-web",
    allowedOrigins: ["https://acme.com"],
    samplePercentage: 100,
    captureTrigger: "Always",
    lastChunkReceivedAt: iso(-12 * SECOND),
    budgetExceededAt: null,
    projectBytesUsedToday: null,
    dailyByteLimit: 1024 * 1024 * 1024,
    applicationBytesUsedThisMonth: 5,
    monthlyBudgetInGB: null,
  };

  it("folds today's top-level policy fields into policy and defaults every additive field to null", () => {
    const status: RecordingHealthStatus | null =
      parseRecordingHealthStatus(legacyWire);

    expect(status).not.toBeNull();
    expect(status?.policy).toEqual({
      isProjectEnabled: true,
      isApplicationEnabled: true,
      captureTrigger: "Always",
      samplePercentage: 100,
      consentMode: "",
      maskingMode: "",
      retentionInDays: null,
    });
    expect(status?.publishedRecorderVersion).toBeNull();
    expect(status?.lastConfigFetchAt).toBeNull();
    expect(status?.lastSessionStartedAt).toBeNull();
    expect(status?.sessionsLast24h).toBeNull();
    expect(status?.playableSessionsLast24h).toBeNull();
    expect(status?.refusalsLast24h).toBeNull();
    expect(status?.projectBytesUsedToday).toBeNull();
    expect(status?.applicationBytesUsedThisMonth).toBe(5);
    expect(status?.monthlyBudgetInGB).toBeNull();

    /* And the legacy shape diagnoses as healthy, not as never-loaded. */
    expect(diagnose(status).state).toBe("healthy");
  });

  it("reads the additive fields and keeps only refusal reasons from the closed vocabulary", () => {
    const status: RecordingHealthStatus | null = parseRecordingHealthStatus({
      ...legacyWire,
      consentMode: "RequireExplicit",
      maskingMode: "MaskAllText",
      retentionInDays: "30",
      publishedRecorderVersion: "2.0.0",
      lastConfigFetchAt: iso(-1 * SECOND),
      lastSessionStartedAt: iso(-1 * MINUTE),
      sessionsLast24h: "12",
      playableSessionsLast24h: 10,
      refusalsLast24h: [
        { reason: "origin-not-allowed", count: "4" },
        { reason: "made-up-reason", count: 99 },
        { reason: "not-sampled" },
        null,
      ],
    });

    expect(status?.policy.consentMode).toBe("RequireExplicit");
    expect(status?.policy.maskingMode).toBe("MaskAllText");
    expect(status?.policy.retentionInDays).toBe(30);
    expect(status?.publishedRecorderVersion).toBe("2.0.0");
    expect(status?.sessionsLast24h).toBe(12);
    expect(status?.playableSessionsLast24h).toBe(10);
    expect(status?.refusalsLast24h).toEqual([
      { reason: "origin-not-allowed", count: 4 },
    ]);
  });

  it("distinguishes an empty refusal list from an unreachable counter", () => {
    expect(
      parseRecordingHealthStatus({ ...legacyWire, refusalsLast24h: [] })
        ?.refusalsLast24h,
    ).toEqual([]);
    expect(
      parseRecordingHealthStatus({ ...legacyWire, refusalsLast24h: null })
        ?.refusalsLast24h,
    ).toBeNull();
  });

  it("returns null for a body that is not an object", () => {
    expect(parseRecordingHealthStatus(null)).toBeNull();
    expect(parseRecordingHealthStatus("nope")).toBeNull();
    expect(parseRecordingHealthStatus([])).toBeNull();
  });
});

describe("copy helpers", () => {
  it("formatRelativeAge quantises to the largest unit and never says 0s ago", () => {
    expect(formatRelativeAge(NOW, NOW)).toBe("just now");
    expect(formatRelativeAge(NOW + 5000, NOW)).toBe("just now");
    expect(formatRelativeAge(NOW - 999, NOW)).toBe("just now");
    expect(formatRelativeAge(NOW - 12 * SECOND, NOW)).toBe("12s ago");
    expect(formatRelativeAge(NOW - 5 * MINUTE - 30 * SECOND, NOW)).toBe(
      "5m ago",
    );
    expect(formatRelativeAge(NOW - 7 * HOUR, NOW)).toBe("7h ago");
    expect(formatRelativeAge(NOW - 3 * DAY, NOW)).toBe("3d ago");
    expect(formatRelativeAge(NaN, NOW)).toBe("unknown");
  });

  it("formatDurationForCopy", () => {
    expect(formatDurationForCopy(45 * SECOND)).toBe("45s");
    expect(formatDurationForCopy(90 * MINUTE)).toBe("1h");
    expect(formatDurationForCopy(2 * DAY)).toBe("2d");
    expect(formatDurationForCopy(-1)).toBe("unknown");
  });

  it("formatCountForCopy separates thousands and renders null as unknown", () => {
    expect(formatCountForCopy(0)).toBe("0");
    expect(formatCountForCopy(999)).toBe("999");
    expect(formatCountForCopy(1000)).toBe("1,000");
    expect(formatCountForCopy(1234567)).toBe("1,234,567");
    expect(formatCountForCopy(null)).toBe("unknown");
  });

  it("formatBytesForCopy", () => {
    expect(formatBytesForCopy(1024 * 1024 * 1024)).toBe("1 GB");
    expect(formatBytesForCopy(2.5 * 1024 * 1024 * 1024)).toBe("2.5 GB");
    expect(formatBytesForCopy(512 * 1024 * 1024)).toBe("512 MB");
    expect(formatBytesForCopy(-1)).toBe("unknown");
  });

  it("parseHealthTimestamp", () => {
    expect(parseHealthTimestamp(iso(0))).toBe(NOW);
    expect(parseHealthTimestamp(null)).toBeNull();
    expect(parseHealthTimestamp("")).toBeNull();
    expect(parseHealthTimestamp("garbage")).toBeNull();
  });

  it("getTopRefusal picks the largest count", () => {
    expect(getTopRefusal(null)).toBeNull();
    expect(getTopRefusal([])).toBeNull();
    expect(
      getTopRefusal([
        { reason: "not-sampled", count: 3 },
        { reason: "rate-limited", count: 9 },
        { reason: "not-enabled", count: 9 },
      ]),
    ).toEqual({ reason: "rate-limited", count: 9 });
  });
});

describe("SessionReplayRefusalReason", () => {
  it("is the ingest gate's closed vocabulary, exactly", () => {
    expect([...SESSION_REPLAY_REFUSAL_REASONS].sort()).toEqual(
      [
        "ingest-disabled",
        "instance-not-offering-replay",
        "policy-unavailable",
        "not-enabled",
        "origin-not-allowed",
        "session-chunk-cap",
        "not-sampled",
        "rate-limited",
        "rate-counter-unavailable",
        "budget-exhausted",
        "budget-counter-unavailable",
        "app-monthly-budget-exhausted",
      ].sort(),
    );
    expect(new Set(SESSION_REPLAY_REFUSAL_REASONS).size).toBe(
      SESSION_REPLAY_REFUSAL_REASONS.length,
    );
  });

  it("the guard accepts members and rejects 'accepted', which is not a refusal", () => {
    expect(isSessionReplayRefusalReason("origin-not-allowed")).toBe(true);
    expect(isSessionReplayRefusalReason("accepted")).toBe(false);
    expect(isSessionReplayRefusalReason(42)).toBe(false);
  });
});
