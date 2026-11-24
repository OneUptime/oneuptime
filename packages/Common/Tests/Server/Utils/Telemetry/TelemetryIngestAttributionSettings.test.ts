import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * What the telemetry worker knows about a project to attribute its batches
 * (issues #6355, #6386): whether it publishes its usage as metrics, its
 * team and label budgets, and the services each counts - read with one
 * query for every project a minute, and a project's own reads only for a
 * project that has budgets, so a project that uses neither costs two set
 * lookups a batch and no query at all.
 */

jest.mock("../../../../Server/Services/ProjectService", () => {
  return { __esModule: true, default: { findAllBy: jest.fn() } };
});

jest.mock(
  "../../../../Server/Services/TelemetryIngestionTeamLabelBudgetService",
  () => {
    return { __esModule: true, default: { findAllBy: jest.fn() } };
  },
);

jest.mock("../../../../Server/Services/ServiceOwnerTeamService", () => {
  return { __esModule: true, default: { findAllBy: jest.fn() } };
});

jest.mock("../../../../Server/Services/ServiceService", () => {
  return { __esModule: true, default: { findAllBy: jest.fn() } };
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

import TelemetryIngestAttributionSettings, {
  TelemetryIngestAttributionConfig,
} from "../../../../Server/Utils/Telemetry/TelemetryIngestAttributionSettings";
import ProjectService from "../../../../Server/Services/ProjectService";
import ServiceOwnerTeamService from "../../../../Server/Services/ServiceOwnerTeamService";
import ServiceService from "../../../../Server/Services/ServiceService";
import TelemetryIngestionTeamLabelBudgetService from "../../../../Server/Services/TelemetryIngestionTeamLabelBudgetService";
import ProductType from "../../../../Types/MeteredPlan/ProductType";
import ObjectID from "../../../../Types/ObjectID";
import { TelemetryIngestionBudgetScope } from "../../../../Types/Telemetry/TelemetryIngestionBudget";

type MockFn = jest.Mock;

const PROJECT: string = "b2b2b2b2-0000-4000-8000-000000000001";
const OTHER_PROJECT: string = "b2b2b2b2-0000-4000-8000-000000000002";
const TEAM: string = "b2b2b2b2-0000-4000-8000-000000000003";
const LABEL: string = "b2b2b2b2-0000-4000-8000-000000000004";
const CHECKOUT: string = "b2b2b2b2-0000-4000-8000-000000000005";
const CART: string = "b2b2b2b2-0000-4000-8000-000000000006";

const projects: MockFn = ProjectService.findAllBy as unknown as MockFn;
const budgets: MockFn =
  TelemetryIngestionTeamLabelBudgetService.findAllBy as unknown as MockFn;
const owners: MockFn = ServiceOwnerTeamService.findAllBy as unknown as MockFn;
const services: MockFn = ServiceService.findAllBy as unknown as MockFn;

// What one query for every project's budgets answers, or one project's.
const budgetRows: (query: Record<string, unknown>) => Array<unknown> = (
  query: Record<string, unknown>,
): Array<unknown> => {
  const rows: Array<Record<string, unknown>> = [
    {
      projectId: new ObjectID(PROJECT),
      teamId: new ObjectID(TEAM),
      logsDailyIngestionBudgetInGB: 1,
    },
    {
      projectId: new ObjectID(PROJECT),
      labelId: new ObjectID(LABEL),
      tracesDailyIngestionBudgetInGB: 2,
    },
    // A budget with nothing set counts nothing.
    {
      projectId: new ObjectID(PROJECT),
      teamId: new ObjectID("b2b2b2b2-0000-4000-8000-000000000009"),
    },
  ];

  if (!query["projectId"]) {
    return rows;
  }

  return rows.filter((row: Record<string, unknown>) => {
    return String(row["projectId"]) === String(query["projectId"]);
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  TelemetryIngestAttributionSettings.clearCaches();
  projects.mockResolvedValue([{ id: new ObjectID(OTHER_PROJECT) }] as never);
  budgets.mockImplementation((async (data: {
    query: Record<string, unknown>;
  }) => {
    return budgetRows(data.query);
  }) as never);
  owners.mockResolvedValue([
    { serviceId: new ObjectID(CHECKOUT), teamId: new ObjectID(TEAM) },
  ] as never);
  services.mockResolvedValue([
    { id: new ObjectID(CHECKOUT) },
    { id: new ObjectID(CART) },
  ] as never);
});

describe("a project that uses neither", () => {
  test("needs no attribution, at the cost of two set lookups and no query of its own", async () => {
    expect(
      await TelemetryIngestAttributionSettings.getProjectConfig(
        "b2b2b2b2-0000-4000-8000-0000000000ff",
      ),
    ).toBe(null);

    // The sets are read once: one query each, for every project.
    expect(projects).toHaveBeenCalledTimes(1);
    expect(budgets).toHaveBeenCalledTimes(1);
    expect(owners).not.toHaveBeenCalled();
    expect(services).not.toHaveBeenCalled();

    await TelemetryIngestAttributionSettings.getProjectConfig(
      "b2b2b2b2-0000-4000-8000-0000000000fe",
    );

    expect(projects).toHaveBeenCalledTimes(1);
    expect(budgets).toHaveBeenCalledTimes(1);
  });
});

describe("a project that publishes its usage as metrics", () => {
  test("is attributed for its usage alone, with no budget to check", async () => {
    expect(
      await TelemetryIngestAttributionSettings.getProjectConfig(OTHER_PROJECT),
    ).toEqual({
      publishesUsageMetrics: true,
      budgets: [],
      budgetsByServiceId: new Map(),
    });
    expect(projects.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        query: { publishTelemetryUsageMetrics: true },
      }),
    );
  });
});

describe("a project with team and label budgets", () => {
  test("knows each budget, and the services each counts: a team's own, a label's carriers", async () => {
    const config: TelemetryIngestAttributionConfig | null =
      await TelemetryIngestAttributionSettings.getProjectConfig(PROJECT);

    expect(config!.publishesUsageMetrics).toBe(false);
    expect(
      config!.budgets.map((budget: { scope: string; scopeId: string }) => {
        return [budget.scope, budget.scopeId];
      }),
    ).toEqual([
      [TelemetryIngestionBudgetScope.Team, TEAM],
      [TelemetryIngestionBudgetScope.Label, LABEL],
    ]);
    expect(config!.budgets[0]!.dailyBudgetsInGB[ProductType.Logs]).toEqual({
      dailyBudgetInGB: 1,
      rateLimitInMBPerSecond: null,
    });

    // Checkout is the team's and carries the label; cart only the label.
    expect(config!.budgetsByServiceId).toEqual(
      new Map([
        [CHECKOUT, [0, 1]],
        [CART, [1]],
      ]),
    );

    // The team's services in one read, each label's in one.
    expect(owners).toHaveBeenCalledTimes(1);
    expect(services).toHaveBeenCalledTimes(1);
  });

  test("reads the project's own budgets once a minute, not once a batch", async () => {
    await TelemetryIngestAttributionSettings.getProjectConfig(PROJECT);
    await TelemetryIngestAttributionSettings.getProjectConfig(PROJECT);
    await Promise.all([
      TelemetryIngestAttributionSettings.getProjectConfig(PROJECT),
      TelemetryIngestAttributionSettings.getProjectConfig(PROJECT),
    ]);

    // Once for the set of every project, once for the project's own.
    expect(budgets).toHaveBeenCalledTimes(2);
    expect(owners).toHaveBeenCalledTimes(1);
  });

  test("forgets what it knew of a project once its budgets are saved on this server", async () => {
    await TelemetryIngestAttributionSettings.getProjectConfig(PROJECT);

    TelemetryIngestAttributionSettings.forgetProject(PROJECT);
    await TelemetryIngestAttributionSettings.getProjectConfig(PROJECT);

    expect(budgets).toHaveBeenCalledTimes(4);
  });

  test("keeps what it read last when a read fails, rather than a query a batch", async () => {
    owners.mockRejectedValue(new Error("Postgres is down") as never);

    expect(
      await TelemetryIngestAttributionSettings.getProjectConfig(PROJECT),
    ).toBe(null);
    expect(
      await TelemetryIngestAttributionSettings.getProjectConfig(PROJECT),
    ).toBe(null);

    // The failed read is remembered for a few seconds.
    expect(owners).toHaveBeenCalledTimes(1);
  });
});

describe("the sets of every project", () => {
  test("a failed first read is an empty set, never a throw", async () => {
    projects.mockRejectedValue(new Error("Postgres is down") as never);
    budgets.mockRejectedValue(new Error("Postgres is down") as never);

    expect(
      await TelemetryIngestAttributionSettings.getUsageMetricProjects(),
    ).toEqual(new Set());
    expect(
      await TelemetryIngestAttributionSettings.getTeamLabelBudgetProjects(),
    ).toEqual(new Set());
  });
});
