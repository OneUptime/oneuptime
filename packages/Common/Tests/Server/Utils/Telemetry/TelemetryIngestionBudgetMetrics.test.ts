import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The ingestion budget sweep (issue #5917): the oneuptime.telemetry.budget.*
 * gauges it posts for every scope that counted anything today, the owners'
 * once-a-day warning and used-up emails, and how it stops.
 *
 * Every store is mocked at its module boundary: the counters' script is
 * tested against a real Valkey on its own.
 */

jest.mock(
  "../../../../Server/Utils/Telemetry/TelemetryIngestionBudgetCounter",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../Server/Utils/Telemetry/TelemetryIngestionBudgetCounter",
    ) as Record<string, unknown>;

    return {
      __esModule: true,
      ...actual,
      default: {
        listActiveMembers: jest.fn(),
        readDayCounters: jest.fn(),
        claimNotice: jest.fn(),
      },
    };
  },
);

jest.mock(
  "../../../../Server/Utils/Telemetry/TelemetryIngestionBudgetSettings",
  () => {
    return {
      __esModule: true,
      default: {
        getInstanceSettings: jest.fn(),
        getProjectOverrides: jest.fn(),
      },
    };
  },
);

jest.mock("../../../../Server/Services/TelemetryIngestionKeyService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});
jest.mock("../../../../Server/Services/MetricService", () => {
  return { __esModule: true, default: { insertJsonRows: jest.fn() } };
});
jest.mock("../../../../Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: { findOneById: jest.fn(), sendEmailToProjectOwners: jest.fn() },
  };
});
jest.mock("../../../../Server/Services/GlobalConfigService", () => {
  return { __esModule: true, default: { findOneById: jest.fn() } };
});
jest.mock("../../../../Server/Utils/Telemetry/Telemetry", () => {
  return {
    __esModule: true,
    default: {
      indexMetricNameServiceNameMap: jest.fn(),
      getAttributeKeys: (
        attributes: Record<string, unknown>,
      ): Array<string> => {
        return Object.keys(attributes);
      },
    },
  };
});
jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

import TelemetryIngestionBudgetMetrics, {
  TelemetryIngestionBudgetSweepScope,
  TelemetryIngestionBudgetSweepSummary,
} from "../../../../Server/Utils/Telemetry/TelemetryIngestionBudgetMetrics";
import TelemetryIngestionBudgetCounter, {
  TelemetryIngestionBudgetActiveMember,
  TelemetryIngestionBudgetDayCounters,
  TelemetryIngestionBudgetNoticeKind,
} from "../../../../Server/Utils/Telemetry/TelemetryIngestionBudgetCounter";
import TelemetryIngestionBudgetSettings from "../../../../Server/Utils/Telemetry/TelemetryIngestionBudgetSettings";
import TelemetryIngestionKeyService from "../../../../Server/Services/TelemetryIngestionKeyService";
import MetricService from "../../../../Server/Services/MetricService";
import ProjectService from "../../../../Server/Services/ProjectService";
import GlobalConfigService from "../../../../Server/Services/GlobalConfigService";
import TelemetryUtil from "../../../../Server/Utils/Telemetry/Telemetry";
import { JSONObject } from "../../../../Types/JSON";
import ProductType from "../../../../Types/MeteredPlan/ProductType";
import ObjectID from "../../../../Types/ObjectID";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import TelemetryIngestionBudgetMetricType from "../../../../Types/Telemetry/TelemetryIngestionBudgetMetricType";
import {
  getEmptyTelemetryIngestionBudgetStoredSettings,
  TELEMETRY_INGESTION_BUDGET_BYTES_PER_GB,
  TelemetryIngestionBudgetLimitSource,
  TelemetryIngestionBudgetScope,
  TelemetryIngestionBudgetStoredSettings,
} from "../../../../Types/Telemetry/TelemetryIngestionBudget";

type MockFn = jest.Mock;

const GB: number = TELEMETRY_INGESTION_BUDGET_BYTES_PER_GB;
const PROJECT_ID: string = "11111111-1111-4111-8111-1111111111a1";
const KEY_ID: string = "11111111-1111-4111-8111-1111111111a2";
const NOW: Date = new Date("2026-11-09T12:00:00Z");

const counters: (
  overrides?: Partial<TelemetryIngestionBudgetDayCounters>,
) => TelemetryIngestionBudgetDayCounters = (
  overrides?: Partial<TelemetryIngestionBudgetDayCounters>,
): TelemetryIngestionBudgetDayCounters => {
  return {
    usedBytes: 0,
    droppedBytes: 0,
    droppedRequests: 0,
    throttledRequests: 0,
    warningCrossedAt: null,
    exhaustedAt: null,
    warningNoticeSentAt: null,
    exhaustedNoticeSentAt: null,
    ...(overrides || {}),
  };
};

const projectMember: TelemetryIngestionBudgetActiveMember = {
  projectId: PROJECT_ID,
  scope: TelemetryIngestionBudgetScope.Project,
  scopeId: PROJECT_ID,
  signalSlug: "logs",
};

const keyMember: TelemetryIngestionBudgetActiveMember = {
  projectId: PROJECT_ID,
  scope: TelemetryIngestionBudgetScope.IngestionKey,
  scopeId: KEY_ID,
  signalSlug: "logs",
};

const projectScope: TelemetryIngestionBudgetSweepScope = {
  member: projectMember,
  signal: ProductType.Logs,
  limits: {
    dailyBudget: {
      bytes: 10 * GB,
      source: TelemetryIngestionBudgetLimitSource.Instance,
    },
    rateLimit: { bytes: null, source: null },
  },
  ingestionKeyName: null,
};

const logsBudget: (daily: number) => TelemetryIngestionBudgetStoredSettings = (
  daily: number,
): TelemetryIngestionBudgetStoredSettings => {
  const stored: TelemetryIngestionBudgetStoredSettings =
    getEmptyTelemetryIngestionBudgetStoredSettings();
  stored[ProductType.Logs] = {
    dailyBudgetInGB: daily,
    rateLimitInMBPerSecond: null,
  };
  return stored;
};

beforeEach(() => {
  jest.clearAllMocks();
  (
    TelemetryIngestionBudgetSettings.getInstanceSettings as unknown as MockFn
  ).mockResolvedValue({
    budgets: logsBudget(10),
    warningPercent: 80,
    resetTime: "00:00",
    timezone: "UTC",
  } as never);
  (
    TelemetryIngestionBudgetSettings.getProjectOverrides as unknown as MockFn
  ).mockResolvedValue(null as never);
  (TelemetryIngestionKeyService.findBy as unknown as MockFn).mockResolvedValue([
    {
      id: new ObjectID(KEY_ID),
      name: "collector-prod",
      logsDailyIngestionBudgetInGB: 1,
    },
  ] as never);
  (
    TelemetryIngestionBudgetCounter.listActiveMembers as unknown as MockFn
  ).mockResolvedValue([projectMember, keyMember] as never);
  (
    TelemetryIngestionBudgetCounter.readDayCounters as unknown as MockFn
  ).mockResolvedValue([
    counters({ usedBytes: 9 * GB, warningCrossedAt: NOW }),
    counters({ usedBytes: GB, droppedBytes: 500, exhaustedAt: NOW }),
  ] as never);
  (
    TelemetryIngestionBudgetCounter.claimNotice as unknown as MockFn
  ).mockResolvedValue(true as never);
  (GlobalConfigService.findOneById as unknown as MockFn).mockResolvedValue({
    monitorMetricRetentionInDays: 14,
  } as never);
  (ProjectService.findOneById as unknown as MockFn).mockResolvedValue({
    name: "Acme <Production>",
  } as never);
  (MetricService.insertJsonRows as unknown as MockFn).mockResolvedValue(
    undefined as never,
  );
  (
    TelemetryUtil.indexMetricNameServiceNameMap as unknown as MockFn
  ).mockResolvedValue(undefined as never);
  (
    ProjectService.sendEmailToProjectOwners as unknown as MockFn
  ).mockResolvedValue(undefined as never);
});

describe("buildScopeRows", () => {
  test("posts the day's bytes and percent for a scope with a daily budget, keyed to the project", () => {
    const rows: Array<JSONObject> =
      TelemetryIngestionBudgetMetrics.buildScopeRows({
        scope: projectScope,
        counters: counters({ usedBytes: 9 * GB }),
        ingestionDate: NOW,
        retentionDate: NOW,
      });

    expect(
      rows.map((row: JSONObject) => {
        return [row["name"], row["value"]];
      }),
    ).toEqual([
      [TelemetryIngestionBudgetMetricType.UsedBytes, 9 * GB],
      [TelemetryIngestionBudgetMetricType.UsedPercent, 90],
    ]);
    expect(rows[0]!["primaryEntityId"]).toBe(PROJECT_ID);
    expect(rows[0]!["primaryEntityType"]).toBe(ServiceType.Unknown);
    expect(rows[0]!["projectId"]).toBe(PROJECT_ID);
    expect(rows[0]!["attributes"]).toEqual({
      projectId: PROJECT_ID,
      signal: "logs",
      scope: "project",
    });
  });

  test("posts the dropped bytes and throttled requests only while above zero", () => {
    const rows: Array<JSONObject> =
      TelemetryIngestionBudgetMetrics.buildScopeRows({
        scope: projectScope,
        counters: counters({
          usedBytes: 10 * GB,
          droppedBytes: 7,
          throttledRequests: 3,
        }),
        ingestionDate: NOW,
        retentionDate: NOW,
      });

    expect(
      rows.map((row: JSONObject) => {
        return row["name"];
      }),
    ).toEqual([
      TelemetryIngestionBudgetMetricType.UsedBytes,
      TelemetryIngestionBudgetMetricType.UsedPercent,
      TelemetryIngestionBudgetMetricType.DroppedBytes,
      TelemetryIngestionBudgetMetricType.ThrottledRequests,
    ]);
  });

  test("posts no percent without a daily budget, and nothing at all for a zero", () => {
    const noBudget: TelemetryIngestionBudgetSweepScope = {
      ...projectScope,
      limits: {
        dailyBudget: { bytes: null, source: null },
        rateLimit: {
          bytes: 1024,
          source: TelemetryIngestionBudgetLimitSource.Instance,
        },
      },
    };

    expect(
      TelemetryIngestionBudgetMetrics.buildScopeRows({
        scope: noBudget,
        counters: counters({ usedBytes: 50 }),
        ingestionDate: NOW,
        retentionDate: NOW,
      }).map((row: JSONObject) => {
        return row["name"];
      }),
    ).toEqual([TelemetryIngestionBudgetMetricType.UsedBytes]);

    expect(
      TelemetryIngestionBudgetMetrics.buildScopeRows({
        scope: projectScope,
        counters: counters(),
        ingestionDate: NOW,
        retentionDate: NOW,
      }),
    ).toEqual([]);
  });

  test("names the key on a key's rows", () => {
    const rows: Array<JSONObject> =
      TelemetryIngestionBudgetMetrics.buildScopeRows({
        scope: {
          ...projectScope,
          member: keyMember,
          ingestionKeyName: "collector-prod",
        },
        counters: counters({ usedBytes: 5 }),
        ingestionDate: NOW,
        retentionDate: NOW,
      });

    expect(rows[0]!["attributes"]).toEqual({
      projectId: PROJECT_ID,
      signal: "logs",
      scope: "ingestion-key",
      ingestionKeyId: KEY_ID,
      ingestionKeyName: "collector-prod",
    });
  });
});

describe("getNotice", () => {
  test("tells the owners a project's budget is past its warning, and until when it lasts", () => {
    const notice: { subject: string; html: string } | null =
      TelemetryIngestionBudgetMetrics.getNotice({
        kind: TelemetryIngestionBudgetNoticeKind.Warning,
        projectId: PROJECT_ID,
        projectName: "Acme",
        scope: projectScope,
        counters: counters({ usedBytes: 8.5 * GB }),
        warningPercent: 80,
        resetsAt: new Date("2026-11-10T00:00:00Z"),
      });

    expect(notice!.subject).toBe("Logs ingestion budget 85% used in Acme");
    expect(notice!.html).toContain(
      "Acme has used 85% of its daily logs ingestion budget of 10 GB (the warning is at 80%).",
    );
    expect(notice!.html).toContain("2026-11-10 00:00 UTC");
    expect(notice!.html).toContain("Only the instance admin can change");
  });

  test("tells the owners a key's budget is used up, and who may change it", () => {
    const notice: { subject: string; html: string } | null =
      TelemetryIngestionBudgetMetrics.getNotice({
        kind: TelemetryIngestionBudgetNoticeKind.Exhausted,
        projectId: PROJECT_ID,
        projectName: "Acme",
        scope: {
          ...projectScope,
          member: keyMember,
          ingestionKeyName: "collector-prod",
        },
        counters: counters({ usedBytes: 10 * GB }),
        warningPercent: 80,
        resetsAt: new Date("2026-11-10T00:00:00Z"),
      });

    expect(notice!.subject).toBe(
      'Logs ingestion budget used up for ingestion key "collector-prod" in Acme',
    );
    expect(notice!.html).toContain("sent with this key");
    expect(notice!.html).toContain("Anyone who can edit the ingestion key");
  });

  test("escapes what people named the project and the key", () => {
    const notice: { subject: string; html: string } | null =
      TelemetryIngestionBudgetMetrics.getNotice({
        kind: TelemetryIngestionBudgetNoticeKind.Exhausted,
        projectId: PROJECT_ID,
        projectName: "<script>x</script>",
        scope: projectScope,
        counters: counters({ usedBytes: 10 * GB }),
        warningPercent: 80,
        resetsAt: NOW,
      });

    expect(notice!.html).not.toContain("<script>");
    expect(notice!.html).toContain("&lt;script&gt;");
  });

  test("has nothing to say about a scope without a daily budget", () => {
    expect(
      TelemetryIngestionBudgetMetrics.getNotice({
        kind: TelemetryIngestionBudgetNoticeKind.Warning,
        projectId: PROJECT_ID,
        projectName: "Acme",
        scope: {
          ...projectScope,
          limits: {
            dailyBudget: { bytes: null, source: null },
            rateLimit: { bytes: null, source: null },
          },
        },
        counters: counters(),
        warningPercent: 80,
        resetsAt: NOW,
      }),
    ).toBe(null);
  });
});

describe("publishAll", () => {
  test("posts every active scope's rows in one insert, and registers the names", async () => {
    const summary: TelemetryIngestionBudgetSweepSummary =
      await TelemetryIngestionBudgetMetrics.publishAll({ now: NOW });

    expect(summary.stopReason).toBe("done");
    expect(summary.dayId).toBe("20261109T0000Z");
    expect(summary.scopesScanned).toBe(2);
    expect(MetricService.insertJsonRows).toHaveBeenCalledTimes(1);

    const rows: Array<JSONObject> = (
      MetricService.insertJsonRows as unknown as MockFn
    ).mock.calls[0]![0] as Array<JSONObject>;

    // Project: bytes and 90%. Key (1 GB of its own): bytes, 100% and dropped.
    expect(rows).toHaveLength(5);
    expect(summary.rowsWritten).toBe(5);
    expect(
      rows
        .filter((row: JSONObject) => {
          return row["name"] === TelemetryIngestionBudgetMetricType.UsedPercent;
        })
        .map((row: JSONObject) => {
          return row["value"];
        }),
    ).toEqual([90, 100]);
    expect(TelemetryUtil.indexMetricNameServiceNameMap).toHaveBeenCalledTimes(
      1,
    );
  });

  test("keeps the rows as long as monitor metrics", async () => {
    await TelemetryIngestionBudgetMetrics.publishAll({ now: NOW });

    const rows: Array<JSONObject> = (
      MetricService.insertJsonRows as unknown as MockFn
    ).mock.calls[0]![0] as Array<JSONObject>;

    expect(String(rows[0]!["retentionDate"])).toContain("2026-11-23");
  });

  test("emails the owners once for the warning and once for the key's used-up budget", async () => {
    const summary: TelemetryIngestionBudgetSweepSummary =
      await TelemetryIngestionBudgetMetrics.publishAll({ now: NOW });

    expect(summary.noticesSent).toBe(2);
    expect(ProjectService.sendEmailToProjectOwners).toHaveBeenCalledTimes(2);

    const subjects: Array<string> = (
      ProjectService.sendEmailToProjectOwners as unknown as MockFn
    ).mock.calls.map((call: Array<unknown>) => {
      return call[1] as string;
    });

    expect(subjects).toEqual([
      "Logs ingestion budget 90% used in Acme <Production>",
      'Logs ingestion budget used up for ingestion key "collector-prod" in Acme <Production>',
    ]);
    // One project lookup, however many notices it gets.
    expect(ProjectService.findOneById).toHaveBeenCalledTimes(1);
  });

  test("sends only the used-up email for a budget that crossed both since the last sweep", async () => {
    (
      TelemetryIngestionBudgetCounter.listActiveMembers as unknown as MockFn
    ).mockResolvedValue([projectMember] as never);
    (
      TelemetryIngestionBudgetCounter.readDayCounters as unknown as MockFn
    ).mockResolvedValue([
      counters({ usedBytes: 10 * GB, warningCrossedAt: NOW, exhaustedAt: NOW }),
    ] as never);

    await TelemetryIngestionBudgetMetrics.publishAll({ now: NOW });

    expect(ProjectService.sendEmailToProjectOwners).toHaveBeenCalledTimes(1);
    expect(
      (ProjectService.sendEmailToProjectOwners as unknown as MockFn).mock
        .calls[0]![1],
    ).toContain("used up");

    const kinds: Array<TelemetryIngestionBudgetNoticeKind> = (
      TelemetryIngestionBudgetCounter.claimNotice as unknown as MockFn
    ).mock.calls.map((call: Array<unknown>) => {
      return (call[0] as { kind: TelemetryIngestionBudgetNoticeKind }).kind;
    });

    // Both claimed, so the warning is never sent later.
    expect(kinds).toEqual([
      TelemetryIngestionBudgetNoticeKind.Exhausted,
      TelemetryIngestionBudgetNoticeKind.Warning,
    ]);
  });

  test("sends nothing another server already claimed, or already sent", async () => {
    (
      TelemetryIngestionBudgetCounter.claimNotice as unknown as MockFn
    ).mockResolvedValue(false as never);

    await TelemetryIngestionBudgetMetrics.publishAll({ now: NOW });
    expect(ProjectService.sendEmailToProjectOwners).not.toHaveBeenCalled();

    (
      TelemetryIngestionBudgetCounter.readDayCounters as unknown as MockFn
    ).mockResolvedValue([
      counters({
        usedBytes: 9 * GB,
        warningCrossedAt: NOW,
        warningNoticeSentAt: NOW,
      }),
      counters({ usedBytes: GB, exhaustedAt: NOW, exhaustedNoticeSentAt: NOW }),
    ] as never);
    (
      TelemetryIngestionBudgetCounter.claimNotice as unknown as MockFn
    ).mockClear();

    await TelemetryIngestionBudgetMetrics.publishAll({ now: NOW });
    expect(TelemetryIngestionBudgetCounter.claimNotice).not.toHaveBeenCalled();
  });

  test("skips a key deleted since it counted", async () => {
    (
      TelemetryIngestionKeyService.findBy as unknown as MockFn
    ).mockResolvedValue([] as never);
    (
      TelemetryIngestionBudgetCounter.readDayCounters as unknown as MockFn
    ).mockResolvedValue([counters({ usedBytes: GB })] as never);

    const summary: TelemetryIngestionBudgetSweepSummary =
      await TelemetryIngestionBudgetMetrics.publishAll({ now: NOW });

    expect(summary.rowsWritten).toBe(2);
    expect(
      (TelemetryIngestionBudgetCounter.readDayCounters as unknown as MockFn)
        .mock.calls[0]![0],
    ).toHaveLength(1);
  });

  test("stops without posting anything when the counters cannot be read", async () => {
    (
      TelemetryIngestionBudgetCounter.listActiveMembers as unknown as MockFn
    ).mockResolvedValue(null as never);

    expect(
      (await TelemetryIngestionBudgetMetrics.publishAll({ now: NOW }))
        .stopReason,
    ).toBe("counters-unavailable");

    (
      TelemetryIngestionBudgetCounter.listActiveMembers as unknown as MockFn
    ).mockResolvedValue([projectMember] as never);
    (
      TelemetryIngestionBudgetCounter.readDayCounters as unknown as MockFn
    ).mockResolvedValue(null as never);

    expect(
      (await TelemetryIngestionBudgetMetrics.publishAll({ now: NOW }))
        .stopReason,
    ).toBe("counters-unavailable");
    expect(MetricService.insertJsonRows).not.toHaveBeenCalled();
  });

  test("stops at its deadline, and when it lost its lock", async () => {
    expect(
      (
        await TelemetryIngestionBudgetMetrics.publishAll({
          now: NOW,
          deadline: new Date(0),
        })
      ).stopReason,
    ).toBe("deadline");
    expect(
      (
        await TelemetryIngestionBudgetMetrics.publishAll({
          now: NOW,
          shouldContinue: () => {
            return false;
          },
        })
      ).stopReason,
    ).toBe("lock-lost");
    expect(MetricService.insertJsonRows).not.toHaveBeenCalled();
  });

  test("keeps going past a page whose insert fails", async () => {
    (MetricService.insertJsonRows as unknown as MockFn).mockRejectedValue(
      new Error("ClickHouse is down") as never,
    );

    const summary: TelemetryIngestionBudgetSweepSummary =
      await TelemetryIngestionBudgetMetrics.publishAll({ now: NOW });

    expect(summary.pagesFailed).toBe(1);
    expect(summary.stopReason).toBe("done");
  });
});
