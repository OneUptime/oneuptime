import { describe, expect, test } from "@jest/globals";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import { TelemetryIngestionBudgetScope } from "Common/Types/Telemetry/TelemetryIngestionBudget";
import { formatTelemetryIngestionBudgetBytes } from "Common/UI/Components/TelemetryIngestionBudget/TelemetryIngestionBudgetWords";
import {
  Translator,
  createTranslator,
} from "Common/UI/Utils/TranslateTemplate";
import {
  RefusedTelemetry,
  RefusedTelemetryKind,
  RefusedTelemetrySignal,
  writeRefusedTelemetryRecord,
} from "Common/Utils/SecurityEvent/RefusedTelemetry";
import {
  LOGS_BUDGET_USED_UP_BETWEEN,
  LOGS_BUDGET_USED_UP_SINCE,
  LOGS_KEY_BUDGET_USED_UP_SINCE,
  LOGS_KEY_RATE_LIMITED_BETWEEN,
  LOGS_LABEL_BUDGET_USED_UP_SINCE,
  LOGS_RATE_LIMITED_SINCE,
  LOGS_TEAM_BUDGET_USED_UP_BETWEEN,
  MISSING_TELEMETRY_SUMMARY,
  MISSING_TELEMETRY_TITLE,
  SOURCES_TELEMETRY_REFUSED,
  TRACES_BUDGET_USED_UP_SINCE,
  TRACES_KEY_BUDGET_USED_UP_BETWEEN,
  TRACES_LABEL_BUDGET_USED_UP_BETWEEN,
  TRACES_RATE_LIMITED_BETWEEN,
  TRACES_SOURCE,
  TRACES_TEAM_BUDGET_USED_UP_SINCE,
  YOUR_LOGS_SOURCE,
} from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/RefusedTelemetry/RefusedTelemetryCopy";
import {
  RefusedTelemetryLine,
  describeRefusedTelemetry,
  describeRefusedTelemetryList,
  getRefusedTelemetryAmount,
  getRefusedTelemetrySentence,
  getRefusedTelemetryWhileCaseOpen,
  isPeriodRefused,
  readSourceRefusedTelemetry,
} from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/RefusedTelemetry/RefusedTelemetryModel";
import {
  SecurityHeadline,
  SecurityHeadlineAction,
  SecurityHeadlineKind,
  SecurityOverviewQueue,
  SecurityStageView,
  SecurityStatusTone,
  getRecentSecurityRefusedTelemetry,
  getSecurityHeadline,
  getSecurityStageViews,
} from "../../FeatureSet/Dashboard/src/Components/SecurityOverview/SecurityOverviewStatusModel";
import {
  SecurityPipelineStageKey,
  SecuritySetupStatus,
  parseSecuritySetupStatus,
} from "../../FeatureSet/Dashboard/src/Components/SecurityOverview/SecuritySetupModel";

/*
 * WHAT A BUDGET OR A RATE REFUSED, AS THE DASHBOARD SAYS IT (#10431),
 * decided without a renderer.
 *
 * A project at its logs budget during an attack: the Overview's band says
 * part of its telemetry was not scanned instead of "All quiet", its Sources
 * cell is amber instead of a green tick, and each line says whose budget or
 * rate refused what, when, and how much was not stored - never "healthy"
 * over what Security Events could not see.
 */

const NOW: Date = new Date("2026-11-20T15:00:00.000Z");
const PROJECT_ID: string = "0192f1a0-0000-7000-8000-0000000p1431";

const english: Translator = createTranslator(undefined, "en");

const refusal: (data: Partial<RefusedTelemetry>) => RefusedTelemetry = (
  data: Partial<RefusedTelemetry>,
): RefusedTelemetry => {
  return {
    signal: ProductType.Logs,
    kind: RefusedTelemetryKind.BudgetUsedUp,
    scope: TelemetryIngestionBudgetScope.Project,
    scopeId: PROJECT_ID,
    scopeName: "",
    from: "2026-11-20T14:02:00.000Z",
    to: null,
    refusedBytes: 3 * 1024 * 1024 * 1024,
    refusedRequests: 18204,
    ...data,
  };
};

const at: (iso: string) => string = (iso: string): string => {
  return OneUptimeDate.getDateAsLocalFormattedString(new Date(iso));
};

function status(
  overrides: Partial<SecuritySetupStatus> = {},
): SecuritySetupStatus {
  return {
    connections: 0,
    logsSourceEnabled: true,
    telemetrySourcesEnabled: 1,
    eventsLast24Hours: 1234,
    lastEventAt: new Date("2026-11-20T14:01:00.000Z"),
    enabledRules: 20,
    recommendedRules: 20,
    recommendedRulesOn: 20,
    threatIntelFeeds: 0,
    openCases: 0,
    enabledPlaybooks: 1,
    destinations: 0,
    ...overrides,
  };
}

const QUIET: SecurityOverviewQueue = {
  openCases: 0,
  criticalOpenCases: 0,
  highOpenCases: 0,
  myOpenCases: 0,
  unassignedOpenCases: 0,
  runsWaitingForApproval: 0,
};

describe("which sentence a stretch is said in", () => {
  const cases: Array<[Partial<RefusedTelemetry>, string]> = [
    [{}, LOGS_BUDGET_USED_UP_SINCE],
    [{ to: "2026-11-21T00:00:00.000Z" }, LOGS_BUDGET_USED_UP_BETWEEN],
    [{ signal: ProductType.Traces }, TRACES_BUDGET_USED_UP_SINCE],
    [
      { scope: TelemetryIngestionBudgetScope.IngestionKey },
      LOGS_KEY_BUDGET_USED_UP_SINCE,
    ],
    [
      {
        signal: ProductType.Traces,
        scope: TelemetryIngestionBudgetScope.IngestionKey,
        to: "2026-11-21T00:00:00.000Z",
      },
      TRACES_KEY_BUDGET_USED_UP_BETWEEN,
    ],
    [
      {
        scope: TelemetryIngestionBudgetScope.Team,
        to: "2026-11-21T00:00:00.000Z",
      },
      LOGS_TEAM_BUDGET_USED_UP_BETWEEN,
    ],
    [
      { signal: ProductType.Traces, scope: TelemetryIngestionBudgetScope.Team },
      TRACES_TEAM_BUDGET_USED_UP_SINCE,
    ],
    [
      { scope: TelemetryIngestionBudgetScope.Label },
      LOGS_LABEL_BUDGET_USED_UP_SINCE,
    ],
    [
      {
        signal: ProductType.Traces,
        scope: TelemetryIngestionBudgetScope.Label,
        to: "2026-11-21T00:00:00.000Z",
      },
      TRACES_LABEL_BUDGET_USED_UP_BETWEEN,
    ],
    [{ kind: RefusedTelemetryKind.RateLimited }, LOGS_RATE_LIMITED_SINCE],
    [
      {
        signal: ProductType.Traces,
        kind: RefusedTelemetryKind.RateLimited,
        to: "2026-11-20T14:20:00.000Z",
      },
      TRACES_RATE_LIMITED_BETWEEN,
    ],
    [
      {
        kind: RefusedTelemetryKind.RateLimited,
        scope: TelemetryIngestionBudgetScope.IngestionKey,
        to: "2026-11-20T14:20:00.000Z",
      },
      LOGS_KEY_RATE_LIMITED_BETWEEN,
    ],
    // A team has no rate: said as the project's, should one ever come.
    [
      {
        kind: RefusedTelemetryKind.RateLimited,
        scope: TelemetryIngestionBudgetScope.Team,
      },
      LOGS_RATE_LIMITED_SINCE,
    ],
  ];

  test.each(cases)(
    "%j is said as %s",
    (data: Partial<RefusedTelemetry>, sentence: string) => {
      expect(getRefusedTelemetrySentence(refusal(data))).toBe(sentence);
    },
  );
});

describe("a line in words", () => {
  test("the project's budget, used up during an attack and still refusing", () => {
    const line: RefusedTelemetryLine = describeRefusedTelemetry({
      refusal: refusal({}),
      translator: english,
    });

    expect(line).toEqual({
      id: `${ProductType.Logs}:${RefusedTelemetryKind.BudgetUsedUp}:project:${PROJECT_ID}:2026-11-20T14:02:00.000Z`,
      signal: ProductType.Logs,
      sourceTitle: YOUR_LOGS_SOURCE,
      sentence: `Your daily logs budget was used up at ${at("2026-11-20T14:02:00.000Z")}. Logs since then were refused and not scanned.`,
      amount: `${formatTelemetryIngestionBudgetBytes(3 * 1024 * 1024 * 1024, english)} in 18,204 requests was not stored.`,
      isOngoing: true,
    });
  });

  test("a key's, once it ended, named as it was saved", () => {
    const line: RefusedTelemetryLine = describeRefusedTelemetry({
      refusal: refusal({
        signal: ProductType.Traces,
        scope: TelemetryIngestionBudgetScope.IngestionKey,
        scopeName: "Edge collector",
        to: "2026-11-21T00:00:00.000Z",
        refusedRequests: 1,
        refusedBytes: 512,
      }),
      translator: english,
    });

    expect(line.sourceTitle).toBe(TRACES_SOURCE);
    expect(line.isOngoing).toBe(false);
    expect(line.sentence).toBe(
      `The ingestion key Edge collector used up its own daily traces budget from ${at("2026-11-20T14:02:00.000Z")} to ${at("2026-11-21T00:00:00.000Z")}. Traces sent with it in that time were refused and not scanned.`,
    );
    expect(line.amount).toBe(
      `${formatTelemetryIngestionBudgetBytes(512, english)} in 1 request was not stored.`,
    );
  });

  test("a key with no name is the unnamed key; a team with none, its id", () => {
    expect(
      describeRefusedTelemetry({
        refusal: refusal({ scope: TelemetryIngestionBudgetScope.IngestionKey }),
        translator: english,
      }).sentence,
    ).toContain("The ingestion key Unnamed Key ");
    expect(
      describeRefusedTelemetry({
        refusal: refusal({
          scope: TelemetryIngestionBudgetScope.Team,
          scopeId: "team-id",
        }),
        translator: english,
      }).sentence,
    ).toContain("The team team-id ");
  });

  test("how much: a size when the gate sized it, the requests when it did not, what a rate throttled, nothing when nothing was counted", () => {
    expect(
      getRefusedTelemetryAmount({
        refusal: refusal({ refusedBytes: 0, refusedRequests: 4 }),
        translator: english,
      }),
    ).toBe("4 requests were not stored.");
    expect(
      getRefusedTelemetryAmount({
        refusal: refusal({
          kind: RefusedTelemetryKind.RateLimited,
          refusedBytes: 0,
          refusedRequests: 1,
        }),
        translator: english,
      }),
    ).toBe("1 request was throttled.");
    expect(
      getRefusedTelemetryAmount({
        refusal: refusal({ refusedBytes: 0, refusedRequests: 0 }),
        translator: english,
      }),
    ).toBe("");
  });

  test("several are read what goes on first, then the latest", () => {
    const lines: Array<RefusedTelemetryLine> = describeRefusedTelemetryList({
      refusals: [
        refusal({
          signal: ProductType.Traces,
          from: "2026-11-19T10:00:00.000Z",
          to: "2026-11-19T11:00:00.000Z",
        }),
        refusal({
          from: "2026-11-20T09:00:00.000Z",
          to: "2026-11-20T10:00:00.000Z",
        }),
        refusal({}),
      ],
      translator: english,
    });

    expect(
      lines.map(
        (line: RefusedTelemetryLine): [RefusedTelemetrySignal, boolean] => {
          return [line.signal, line.isOngoing];
        },
      ),
    ).toEqual([
      [ProductType.Logs, true],
      [ProductType.Logs, false],
      [ProductType.Traces, false],
    ]);
  });
});

describe("a source's and a period's", () => {
  const kept: JSONObject = {
    eventsFound: 3,
    ...writeRefusedTelemetryRecord({
      observation: null,
      refusals: [
        refusal({
          from: "2026-11-18T10:00:00.000Z",
          to: "2026-11-18T11:00:00.000Z",
        }),
        refusal({}),
      ],
    }),
  };

  test("a source's last scan result holds what it kept", () => {
    expect(readSourceRefusedTelemetry({ lastScanResult: kept })).toHaveLength(
      2,
    );
    expect(readSourceRefusedTelemetry({ lastScanResult: undefined })).toEqual(
      [],
    );
  });

  test("a period - a hunt's run, a case - finds what overlaps it, a stretch going on running until now", () => {
    expect(
      readSourceRefusedTelemetry({
        lastScanResult: kept,
        between: {
          from: new Date("2026-11-20T14:30:00.000Z"),
          to: new Date("2026-11-20T14:35:00.000Z"),
          now: NOW,
        },
      }),
    ).toEqual([refusal({})]);

    const refusals: Array<RefusedTelemetry> = readSourceRefusedTelemetry({
      lastScanResult: kept,
    });

    expect(
      isPeriodRefused({
        refusals,
        from: new Date("2026-11-18T10:30:00.000Z"),
        to: new Date("2026-11-18T10:32:00.000Z"),
        now: NOW,
      }),
    ).toBe(true);
    expect(
      isPeriodRefused({
        refusals,
        from: new Date("2026-11-19T10:30:00.000Z"),
        to: new Date("2026-11-19T10:32:00.000Z"),
        now: NOW,
      }),
    ).toBe(false);
    // A run that had no window refused nothing.
    expect(isPeriodRefused({ refusals, from: null, to: null, now: NOW })).toBe(
      false,
    );
  });
});

describe("a case open while telemetry was refused", () => {
  const refusals: Array<RefusedTelemetry> = [
    refusal({
      from: "2026-11-18T10:00:00.000Z",
      to: "2026-11-18T11:00:00.000Z",
    }),
    refusal({}),
  ];

  test("an open case: what was refused from its first detection until now", () => {
    expect(
      getRefusedTelemetryWhileCaseOpen({
        refusals,
        firstDetectedAt: new Date("2026-11-20T13:30:00.000Z"),
        createdAt: new Date("2026-11-20T13:31:00.000Z"),
        closedAt: null,
        now: NOW,
      }),
    ).toEqual([refusal({})]);
  });

  test("a closed case: only what was refused before it closed", () => {
    expect(
      getRefusedTelemetryWhileCaseOpen({
        refusals,
        firstDetectedAt: "2026-11-18T09:00:00.000Z",
        closedAt: "2026-11-18T12:00:00.000Z",
        now: NOW,
      }),
    ).toEqual([refusals[0]]);
    expect(
      getRefusedTelemetryWhileCaseOpen({
        refusals,
        firstDetectedAt: "2026-11-19T09:00:00.000Z",
        closedAt: "2026-11-19T12:00:00.000Z",
        now: NOW,
      }),
    ).toEqual([]);
  });

  test("a case with no detection yet counts from when it was opened, and one with neither date says nothing", () => {
    expect(
      getRefusedTelemetryWhileCaseOpen({
        refusals,
        createdAt: "2026-11-20T14:30:00.000Z",
        now: NOW,
      }),
    ).toEqual([refusal({})]);
    expect(getRefusedTelemetryWhileCaseOpen({ refusals, now: NOW })).toEqual(
      [],
    );
  });
});

describe("the Overview at its logs budget during an attack: never healthy", () => {
  test("the band says part of the telemetry was not scanned, never all quiet", () => {
    const quiet: SecurityHeadline = getSecurityHeadline({
      queue: QUIET,
      status: status(),
      now: NOW,
    });

    expect(quiet.kind).toBe(SecurityHeadlineKind.Quiet);

    const headline: SecurityHeadline = getSecurityHeadline({
      queue: QUIET,
      status: status({ refusedTelemetry: [refusal({})] }),
      now: NOW,
    });

    expect(headline).toEqual({
      kind: SecurityHeadlineKind.MissingTelemetry,
      tone: SecurityStatusTone.Warning,
      icon: IconProp.SignalSlash,
      title: MISSING_TELEMETRY_TITLE,
      summary: { text: MISSING_TELEMETRY_SUMMARY },
      items: [],
      action: SecurityHeadlineAction.None,
    });
  });

  test("what waits for a person still comes first, and a project nothing watches still says so", () => {
    expect(
      getSecurityHeadline({
        queue: { ...QUIET, openCases: 1, unassignedOpenCases: 1 },
        status: status({ refusedTelemetry: [refusal({})] }),
        now: NOW,
      }).kind,
    ).toBe(SecurityHeadlineKind.NeedsAttention);
    expect(
      getSecurityHeadline({
        queue: QUIET,
        status: status({ enabledRules: 0, refusedTelemetry: [refusal({})] }),
        now: NOW,
      }).kind,
    ).toBe(SecurityHeadlineKind.NotSetUp);
  });

  test("a stretch that ended within the day still keeps the band from all quiet; one before that does not", () => {
    expect(
      getSecurityHeadline({
        queue: QUIET,
        status: status({
          refusedTelemetry: [
            refusal({
              from: "2026-11-19T20:00:00.000Z",
              to: "2026-11-20T00:00:00.000Z",
            }),
          ],
        }),
        now: NOW,
      }).kind,
    ).toBe(SecurityHeadlineKind.MissingTelemetry);
    expect(
      getSecurityHeadline({
        queue: QUIET,
        status: status({
          refusedTelemetry: [
            refusal({
              from: "2026-11-18T10:00:00.000Z",
              to: "2026-11-18T11:00:00.000Z",
            }),
          ],
        }),
        now: NOW,
      }).kind,
    ).toBe(SecurityHeadlineKind.Quiet);
  });

  test("the Sources cell is amber, never a green tick, however much else arrived", () => {
    const sourcesOf: (value: SecuritySetupStatus) => SecurityStageView = (
      value: SecuritySetupStatus,
    ): SecurityStageView => {
      return getSecurityStageViews({
        status: value,
        queue: QUIET,
        now: NOW,
      }).find((stage: SecurityStageView): boolean => {
        return stage.key === SecurityPipelineStageKey.Sources;
      })!;
    };

    expect(sourcesOf(status()).statusTone).toBe(SecurityStatusTone.Success);

    const refused: SecurityStageView = sourcesOf(
      status({ refusedTelemetry: [refusal({})] }),
    );

    expect(refused.status).toEqual({ text: SOURCES_TELEMETRY_REFUSED });
    expect(refused.statusIcon).toBe(IconProp.SignalSlash);
    expect(refused.statusTone).toBe(SecurityStatusTone.Warning);
    expect(refused.figureTone).toBe(SecurityStatusTone.Warning);
  });

  test("the card's foot says the day's, what goes on first", () => {
    expect(
      getRecentSecurityRefusedTelemetry(
        status({
          refusedTelemetry: [
            refusal({
              from: "2026-11-01T10:00:00.000Z",
              to: "2026-11-01T11:00:00.000Z",
            }),
            refusal({}),
          ],
        }),
        NOW,
      ),
    ).toEqual([refusal({})]);
    expect(getRecentSecurityRefusedTelemetry(null, NOW)).toEqual([]);
  });

  test("the setup status reads it off the network, and leaves it out when none", () => {
    const read: SecuritySetupStatus = parseSecuritySetupStatus({
      logsSourceEnabled: true,
      refusedTelemetry: [
        refusal({}) as unknown as JSONObject,
        { signal: "Metrics", kind: "budget-used-up" },
      ],
    });

    expect(read.refusedTelemetry).toEqual([refusal({})]);
    expect(
      Object.keys(parseSecuritySetupStatus({ refusedTelemetry: [] })),
    ).not.toContain("refusedTelemetry");
  });
});
