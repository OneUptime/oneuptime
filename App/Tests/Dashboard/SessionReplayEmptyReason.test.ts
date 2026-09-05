import { beforeAll, describe, expect, jest, test } from "@jest/globals";
import TimeRange from "Common/Types/Time/TimeRange";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import {
  RecordingHealthDiagnosis,
  RecordingHealthStatus,
} from "Common/Types/Rum/SessionReplayHealth";
import { diagnoseRecordingHealth } from "Common/Utils/Rum/SessionReplayHealth";
import {
  EMPTY_ADVANCED_FILTERS,
  SessionReplayAdvancedFilters,
} from "../../FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayListFilters";

/*
 * getEmptyReason: the seven honest answers to "why is the list empty", in
 * strict precedence, plus the copy for the two 400s the search can trip.
 * Pure, but it lives beside the view in SessionReplayEmptyState.tsx, which
 * pulls in Common/UI (which reads `window` on load) - so the module is
 * imported after a browser stub exists, the same way
 * ReplayPlayerUrlState.test.ts does it.
 */

/*
 * Only the pure exports are under test. The view's neighbours (the setup
 * guide, the health card's link builder, the health hook) pull in DOM-only
 * libraries at import time, so they are stubbed here; the rendered view is
 * covered by Common/Tests/UI/Rum/SessionReplayEmptyState.test.tsx.
 */
jest.mock(
  "../../FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplaySetupGuide",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../FeatureSet/Dashboard/src/Components/SessionReplay/RecordingHealthCard",
  () => {
    return {
      __esModule: true,
      getRecordingHealthActionLink: (): {
        to: string;
        openInNewTab: boolean;
      } => {
        return { to: "", openInNewTab: false };
      },
    };
  },
);

jest.mock(
  "../../FeatureSet/Dashboard/src/Components/SessionReplay/useSessionReplayHealth",
  () => {
    return {
      __esModule: true,
      default: (): Record<string, never> => {
        return {};
      },
    };
  },
);

type EmptyStateModule =
  typeof import("../../FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayEmptyState");

let emptyState: EmptyStateModule;

const NOW: number = Date.parse("2026-09-05T10:00:00.000Z");
const MINUTE_MS: number = 60 * 1000;
const HOUR_MS: number = 60 * MINUTE_MS;
const DAY_MS: number = 24 * HOUR_MS;

function iso(ageMs: number): string {
  return new Date(NOW - ageMs).toISOString();
}

function makeStatus(
  overrides?: Partial<RecordingHealthStatus>,
): RecordingHealthStatus {
  return {
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
    lastConfigFetchAt: iso(12 * 1000),
    lastChunkReceivedAt: iso(12 * 1000),
    lastSessionStartedAt: iso(60 * 1000),
    budgetExceededAt: null,
    sessionsLast24h: 143,
    playableSessionsLast24h: 120,
    refusalsLast24h: [],
    projectBytesUsedToday: 10 * 1024 * 1024,
    dailyByteLimit: 1024 * 1024 * 1024,
    applicationBytesUsedThisMonth: null,
    monthlyBudgetInGB: null,
    ...overrides,
  };
}

function health(status: RecordingHealthStatus | null): {
  status: RecordingHealthStatus | null;
  diagnosis: RecordingHealthDiagnosis;
} {
  return { status: status, diagnosis: diagnoseRecordingHealth(status, NOW) };
}

function context(
  overrides?: Partial<Parameters<EmptyStateModule["getEmptyReason"]>[0]>,
): Parameters<EmptyStateModule["getEmptyReason"]>[0] {
  return {
    isLoading: false,
    error: "",
    rowCount: 0,
    page: 1,
    signal: "all",
    advanced: EMPTY_ADVANCED_FILTERS,
    timeRange: { range: TimeRange.PAST_ONE_DAY },
    health: health(makeStatus()),
    nowUnixMs: NOW,
    ...overrides,
  };
}

const FILTERED: SessionReplayAdvancedFilters = {
  ...EMPTY_ADVANCED_FILTERS,
  urlPrefix: "/checkout",
};

beforeAll(async () => {
  (globalThis as Record<string, unknown>)["window"] = {
    location: {
      pathname: "/dashboard/p/rum/a/session-replay",
      search: "",
      hash: "",
    },
    history: {
      state: null,
      replaceState: (): void => {
        // never asserted on
      },
    },
    addEventListener: (): void => {
      // no-op
    },
    removeEventListener: (): void => {
      // no-op
    },
  };
  (globalThis as Record<string, unknown>)["document"] = {
    addEventListener: (): void => {
      // no-op
    },
    removeEventListener: (): void => {
      // no-op
    },
    hidden: false,
  };

  for (const storageName of ["sessionStorage", "localStorage"]) {
    Object.defineProperty(globalThis, storageName, {
      value: {
        getItem: (): null => {
          return null;
        },
        setItem: (): void => {
          // no-op
        },
        removeItem: (): void => {
          // no-op
        },
      },
      configurable: true,
      writable: true,
    });
  }

  emptyState = await import(
    "../../FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayEmptyState"
  );
});

describe("getEmptyReason gates", () => {
  test("a loading, errored or non-empty list has no empty reason", () => {
    expect(emptyState.getEmptyReason(context({ isLoading: true }))).toBeNull();
    expect(emptyState.getEmptyReason(context({ error: "boom" }))).toBeNull();
    expect(emptyState.getEmptyReason(context({ rowCount: 3 }))).toBeNull();
  });

  test("page > 1 is the end of the list and NEVER setup, whatever the health says", () => {
    const reason: ReturnType<EmptyStateModule["getEmptyReason"]> =
      emptyState.getEmptyReason(
        context({
          page: 3,
          health: health(
            makeStatus({ lastConfigFetchAt: null, lastChunkReceivedAt: null }),
          ),
        }),
      );

    expect(reason?.variant).toBe("end-of-list");
    expect(reason?.showSetupGuide).toBe(false);
    expect(reason?.detail).toContain("Page 3");
    expect(reason?.action?.kind).toBe("previous-page");
  });
});

describe("getEmptyReason precedence", () => {
  test("disabled project beats everything, even with filters applied", () => {
    const reason: ReturnType<EmptyStateModule["getEmptyReason"]> =
      emptyState.getEmptyReason(
        context({
          signal: "errors",
          advanced: FILTERED,
          health: health(
            makeStatus({
              policy: { ...makeStatus().policy, isProjectEnabled: false },
              refusalsLast24h: [{ reason: "origin-not-allowed", count: 212 }],
              lastChunkReceivedAt: null,
            }),
          ),
        }),
      );

    expect(reason?.variant).toBe("disabled");
    expect(reason?.title).toContain("switched off for this project");
    expect(reason?.action).toEqual({
      kind: "health",
      label: "Turn it on",
      target: "project-settings",
    });
    expect(reason?.showChips).toBe(false);
  });

  test("budget paused beats refusals", () => {
    const reason: ReturnType<EmptyStateModule["getEmptyReason"]> =
      emptyState.getEmptyReason(
        context({
          health: health(
            makeStatus({
              budgetExceededAt: iso(2 * HOUR_MS),
              monthlyBudgetInGB: 2,
              applicationBytesUsedThisMonth: 3 * 1024 * 1024 * 1024,
              refusalsLast24h: [{ reason: "origin-not-allowed", count: 212 }],
            }),
          ),
        }),
      );

    expect(reason?.variant).toBe("budget");
    expect(reason?.title).toContain("Uploads paused");
    expect(reason?.detail).toContain("2 GB monthly budget");
    expect(reason?.action?.kind).toBe("health");
  });

  test("refusing names and counts the top reason", () => {
    const reason: ReturnType<EmptyStateModule["getEmptyReason"]> =
      emptyState.getEmptyReason(
        context({
          health: health(
            makeStatus({
              refusalsLast24h: [
                { reason: "origin-not-allowed", count: 212 },
                { reason: "not-sampled", count: 3 },
              ],
              lastChunkReceivedAt: null,
            }),
          ),
        }),
      );

    expect(reason?.variant).toBe("refusing");
    expect(reason?.title).toContain("212 uploads refused");
    expect(reason?.title).not.toContain("origin-not-allowed");
    expect(reason?.action?.kind).toBe("health");
  });

  test("never-installed only when BOTH stamps are null, and it embeds the guide", () => {
    const reason: ReturnType<EmptyStateModule["getEmptyReason"]> =
      emptyState.getEmptyReason(
        context({
          health: health(
            makeStatus({ lastConfigFetchAt: null, lastChunkReceivedAt: null }),
          ),
        }),
      );

    expect(reason?.variant).toBe("never-installed");
    expect(reason?.showSetupGuide).toBe(true);
    expect(reason?.title).toBe("Nothing has been recorded here yet");

    /* A null config stamp with a chunk on record is an older server, not a missing install. */
    const olderServer: ReturnType<EmptyStateModule["getEmptyReason"]> =
      emptyState.getEmptyReason(
        context({
          health: health(makeStatus({ lastConfigFetchAt: null })),
        }),
      );

    expect(olderServer?.variant).not.toBe("never-installed");
    expect(olderServer?.showSetupGuide).toBe(false);
  });

  test("installed-not-uploading explains from the policy and offers one action", () => {
    const reason: ReturnType<EmptyStateModule["getEmptyReason"]> =
      emptyState.getEmptyReason(
        context({
          health: health(
            makeStatus({
              lastChunkReceivedAt: null,
              policy: { ...makeStatus().policy, samplePercentage: 0 },
            }),
          ),
        }),
      );

    expect(reason?.variant).toBe("installed-not-uploading");
    expect(reason?.title).toContain("loaded 12s ago");
    expect(reason?.detail).toContain("0%");
    expect(reason?.action?.kind).toBe("health");
    expect(reason?.showSetupGuide).toBe(false);
  });

  test("a quiet window says when the most recent session was and offers a wider range", () => {
    const reason: ReturnType<EmptyStateModule["getEmptyReason"]> =
      emptyState.getEmptyReason(
        context({
          health: health(
            makeStatus({
              lastSessionStartedAt: iso(3 * DAY_MS),
              lastChunkReceivedAt: iso(3 * DAY_MS),
              lastConfigFetchAt: iso(3 * DAY_MS),
            }),
          ),
        }),
      );

    expect(reason?.variant).toBe("no-sessions-in-range");
    expect(reason?.title).toBe("No sessions in the past 24 hours");
    expect(reason?.detail).toContain("The most recent started 3d ago");
    expect(reason?.action).toEqual({
      kind: "set-range",
      label: "Show the past 7 days",
      range: { range: TimeRange.PAST_ONE_WEEK },
    });
  });

  test("the wider range reaches back far enough to contain the last session", () => {
    const reason: ReturnType<EmptyStateModule["getEmptyReason"]> =
      emptyState.getEmptyReason(
        context({
          timeRange: { range: TimeRange.PAST_ONE_WEEK },
          health: health(
            makeStatus({
              lastSessionStartedAt: iso(20 * DAY_MS),
              lastChunkReceivedAt: iso(20 * DAY_MS),
              lastConfigFetchAt: iso(20 * DAY_MS),
            }),
          ),
        }),
      );

    expect(reason?.action).toEqual({
      kind: "set-range",
      label: "Show the past month",
      range: { range: TimeRange.PAST_ONE_MONTH },
    });
  });

  test("a session inside the window with an empty list asks for a reload, never claims 'no sessions'", () => {
    const reason: ReturnType<EmptyStateModule["getEmptyReason"]> =
      emptyState.getEmptyReason(context());

    expect(reason?.variant).toBe("no-sessions-in-range");
    expect(reason?.title).toContain("yet");
    expect(reason?.detail).toContain("reported a session 1m ago");
    expect(reason?.action?.kind).toBe("refresh");
  });

  test("without health the quiet copy is honest about not knowing", () => {
    const reason: ReturnType<EmptyStateModule["getEmptyReason"]> =
      emptyState.getEmptyReason(context({ health: null }));

    expect(reason?.variant).toBe("no-sessions-in-range");
    expect(reason?.detail).toContain("unknown");
    expect(reason?.action?.kind).toBe("set-range");
  });

  test("filters that match nothing come last and carry the chips and a clear action", () => {
    const reason: ReturnType<EmptyStateModule["getEmptyReason"]> =
      emptyState.getEmptyReason(
        context({
          signal: "errors",
          advanced: FILTERED,
          timeRange: { range: TimeRange.PAST_ONE_WEEK },
        }),
      );

    expect(reason?.variant).toBe("filters-match-nothing");
    expect(reason?.title).toBe(
      "No sessions match these filters in the past 7 days",
    );
    expect(reason?.showChips).toBe(true);
    expect(reason?.action).toEqual({
      kind: "clear-filters",
      label: "Clear filters",
    });
  });

  test("a custom range is 'this window'", () => {
    const reason: ReturnType<EmptyStateModule["getEmptyReason"]> =
      emptyState.getEmptyReason(
        context({
          signal: "errors",
          timeRange: {
            range: TimeRange.CUSTOM,
            startAndEndDate: new InBetween<Date>(
              new Date(NOW - HOUR_MS),
              new Date(NOW),
            ),
          },
        }),
      );

    expect(reason?.title).toContain("in this window");
  });
});

describe("describeSessionReplayListError", () => {
  test("the 30-day search cap is its fix, not 'no sessions'", () => {
    const copy: ReturnType<EmptyStateModule["describeSessionReplayListError"]> =
      emptyState.describeSessionReplayListError(
        "Search covers at most 30 days at a time. Narrow the range to search it.",
        400,
      );

    expect(copy.kind).toBe("narrow-range");
    expect(copy.title).toContain("30 days");
    expect(copy.detail).toContain("Narrow the time range");
  });

  test("a timeout says so and names the budget", () => {
    expect(
      emptyState.describeSessionReplayListError("Query timed out", 500).kind,
    ).toBe("timeout");
    expect(emptyState.describeSessionReplayListError("", 504).title).toBe(
      "The search timed out",
    );
    expect(emptyState.describeSessionReplayListError("", 504).detail).toContain(
      "30s budget",
    );
  });

  test("permission and plan answers are named, everything else keeps the server's words", () => {
    expect(
      emptyState.describeSessionReplayListError("Forbidden", 403).kind,
    ).toBe("permission");
    expect(emptyState.describeSessionReplayListError("Upgrade", 402).kind).toBe(
      "plan",
    );

    const other: ReturnType<
      EmptyStateModule["describeSessionReplayListError"]
    > = emptyState.describeSessionReplayListError("ClickHouse is unhappy", 500);

    expect(other.kind).toBe("other");
    expect(other.detail).toBe("ClickHouse is unhappy");
  });
});

describe("range helpers", () => {
  test("describeTimeRange and getTimeRangeWindowMs cover every named range", () => {
    for (const range of Object.values(TimeRange)) {
      if (range === TimeRange.CUSTOM) {
        continue;
      }

      expect(emptyState.describeTimeRange({ range: range })).not.toBe(
        "this window",
      );
      expect(emptyState.getTimeRangeWindowMs({ range: range })).toBeGreaterThan(
        0,
      );
    }

    expect(
      emptyState.getTimeRangeWindowMs({ range: TimeRange.CUSTOM }),
    ).toBeNull();
  });

  test("pickWiderRange never offers the range already shown", () => {
    expect(
      emptyState.pickWiderRange(null, { range: TimeRange.PAST_THREE_MONTHS }),
    ).toBeNull();
    expect(
      emptyState.pickWiderRange(2 * DAY_MS, { range: TimeRange.PAST_ONE_WEEK }),
    ).toEqual({ range: TimeRange.PAST_ONE_MONTH });
    expect(
      emptyState.pickWiderRange(200 * DAY_MS, {
        range: TimeRange.PAST_ONE_DAY,
      }),
    ).toBeNull();
  });
});
