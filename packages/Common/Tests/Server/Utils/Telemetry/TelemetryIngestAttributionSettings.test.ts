import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * What the telemetry worker knows about a project to attribute its batches
 * (issues #6355, #6386, #10101): whether it publishes its usage as metrics,
 * its team and label budgets, and the resources each counts - every
 * service, host, cluster and other resource the team owns or that carries
 * the label, by the owner table registry's telemetry-owning kinds, each
 * read pinned to the project. Read with one query for every project a
 * minute, and a project's own reads only for a project that has budgets, so
 * a project that uses neither costs two set lookups a batch and no query at
 * all; and once something was read, no batch waits for a read again.
 */

type MockFn = jest.Mock;

interface FakeService {
  findAllBy: MockFn;
}

const mockServiceOwners: FakeService = { findAllBy: jest.fn() as unknown as MockFn };
const mockServices: FakeService = { findAllBy: jest.fn() as unknown as MockFn };
const mockHostOwners: FakeService = { findAllBy: jest.fn() as unknown as MockFn };
const mockHosts: FakeService = { findAllBy: jest.fn() as unknown as MockFn };
const mockClusterOwners: FakeService = { findAllBy: jest.fn() as unknown as MockFn };
const mockClusters: FakeService = { findAllBy: jest.fn() as unknown as MockFn };
const mockQueueOwners: FakeService = { findAllBy: jest.fn() as unknown as MockFn };
const mockQueues: FakeService = { findAllBy: jest.fn() as unknown as MockFn };

/*
 * The registry, as it holds three kinds telemetry is filed under and one it
 * is not (a queue: its telemetry belongs to the services that use it).
 */
jest.mock(
  "../../../../Server/Types/Database/Permissions/OwnerTableRegistry",
  () => {
    return {
      __esModule: true,
      default: new Map<string, Record<string, unknown>>([
        [
          "Service",
          {
            ownerUserService: {},
            ownerTeamService: mockServiceOwners,
            fkColumn: "serviceId",
            canOwnTelemetry: true,
            modelService: mockServices,
          },
        ],
        [
          "Host",
          {
            ownerUserService: {},
            ownerTeamService: mockHostOwners,
            fkColumn: "hostId",
            canOwnTelemetry: true,
            modelService: mockHosts,
          },
        ],
        [
          "KubernetesCluster",
          {
            ownerUserService: {},
            ownerTeamService: mockClusterOwners,
            fkColumn: "kubernetesClusterId",
            canOwnTelemetry: true,
            modelService: mockClusters,
          },
        ],
        [
          "MessageQueue",
          {
            ownerUserService: {},
            ownerTeamService: mockQueueOwners,
            fkColumn: "messageQueueId",
            modelService: mockQueues,
          },
        ],
      ]),
    };
  },
);

jest.mock("../../../../Server/Services/ProjectService", () => {
  return { __esModule: true, default: { findAllBy: jest.fn() } };
});

jest.mock(
  "../../../../Server/Services/TelemetryIngestionTeamLabelBudgetService",
  () => {
    return { __esModule: true, default: { findAllBy: jest.fn() } };
  },
);

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
  TELEMETRY_INGEST_ATTRIBUTION_SETTINGS_TTL_MS,
} from "../../../../Server/Utils/Telemetry/TelemetryIngestAttributionSettings";
import ProjectService from "../../../../Server/Services/ProjectService";
import TelemetryIngestionTeamLabelBudgetService from "../../../../Server/Services/TelemetryIngestionTeamLabelBudgetService";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import ProductType from "../../../../Types/MeteredPlan/ProductType";
import ObjectID from "../../../../Types/ObjectID";
import { TelemetryIngestionBudgetScope } from "../../../../Types/Telemetry/TelemetryIngestionBudget";

const PROJECT: string = "b2b2b2b2-0000-4000-8000-000000000001";
const OTHER_PROJECT: string = "b2b2b2b2-0000-4000-8000-000000000002";
const TEAM: string = "b2b2b2b2-0000-4000-8000-000000000003";
const LABEL: string = "b2b2b2b2-0000-4000-8000-000000000004";
const CHECKOUT: string = "b2b2b2b2-0000-4000-8000-000000000005";
const CART: string = "b2b2b2b2-0000-4000-8000-000000000006";
const WEB_HOST: string = "b2b2b2b2-0000-4000-8000-000000000007";
const DB_HOST: string = "b2b2b2b2-0000-4000-8000-000000000008";
const PROD_CLUSTER: string = "b2b2b2b2-0000-4000-8000-00000000000a";
const OTHER_LABEL: string = "b2b2b2b2-0000-4000-8000-00000000000b";

const projects: MockFn = ProjectService.findAllBy as unknown as MockFn;
const budgets: MockFn =
  TelemetryIngestionTeamLabelBudgetService.findAllBy as unknown as MockFn;

// The budget rows Postgres holds: every project's, or one project's.
let budgetRowsHeld: Array<Record<string, unknown>> = [];

const budgetRows: (query: Record<string, unknown>) => Array<unknown> = (
  query: Record<string, unknown>,
): Array<unknown> => {
  if (!query["projectId"]) {
    return budgetRowsHeld;
  }

  return budgetRowsHeld.filter((row: Record<string, unknown>) => {
    return String(row["projectId"]) === String(query["projectId"]);
  });
};

const teamAndLabelBudgets: () => Array<Record<string, unknown>> = (): Array<
  Record<string, unknown>
> => {
  return [
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
};

// What a kind's model service answers: rows with their labels.
const carrying: (
  id: string,
  labels: Array<string>,
) => Record<string, unknown> = (
  id: string,
  labels: Array<string>,
): Record<string, unknown> => {
  return {
    _id: id,
    labels: labels.map((label: string) => {
      return { _id: label };
    }),
  };
};

let now: number = Date.parse("2026-11-22T12:00:00Z");

const advance: (ms: number) => void = (ms: number): void => {
  now += ms;
};

// Let every read started so far finish.
const settleReads: () => Promise<void> = async (): Promise<void> => {
  for (let tick: number = 0; tick < 20; tick++) {
    await Promise.resolve();
  }
};

beforeEach(() => {
  jest.clearAllMocks();
  now = Date.parse("2026-11-22T12:00:00Z");
  jest.spyOn(Date, "now").mockImplementation(() => {
    return now;
  });
  TelemetryIngestAttributionSettings.clearCaches();
  budgetRowsHeld = teamAndLabelBudgets();
  projects.mockResolvedValue([{ id: new ObjectID(OTHER_PROJECT) }] as never);
  budgets.mockImplementation((async (data: {
    query: Record<string, unknown>;
  }) => {
    return budgetRows(data.query);
  }) as never);

  mockServiceOwners.findAllBy.mockResolvedValue([
    { serviceId: new ObjectID(CHECKOUT), teamId: new ObjectID(TEAM) },
  ] as never);
  mockServices.findAllBy.mockResolvedValue([
    carrying(CHECKOUT, [LABEL]),
    carrying(CART, [OTHER_LABEL, LABEL]),
  ] as never);
  mockHostOwners.findAllBy.mockResolvedValue([
    { hostId: new ObjectID(WEB_HOST), teamId: new ObjectID(TEAM) },
  ] as never);
  mockHosts.findAllBy.mockResolvedValue([carrying(DB_HOST, [LABEL])] as never);
  mockClusterOwners.findAllBy.mockResolvedValue([
    {
      kubernetesClusterId: new ObjectID(PROD_CLUSTER),
      teamId: new ObjectID(TEAM),
    },
  ] as never);
  mockClusters.findAllBy.mockResolvedValue([
    carrying(PROD_CLUSTER, [LABEL]),
  ] as never);
  mockQueueOwners.findAllBy.mockResolvedValue([] as never);
  mockQueues.findAllBy.mockResolvedValue([] as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const KIND_READS: Array<FakeService> = [
  mockServiceOwners,
  mockServices,
  mockHostOwners,
  mockHosts,
  mockClusterOwners,
  mockClusters,
];

const readsOfKinds: () => number = (): number => {
  return KIND_READS.reduce((sum: number, service: FakeService): number => {
    return sum + service.findAllBy.mock.calls.length;
  }, 0);
};

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
    expect(readsOfKinds()).toBe(0);

    await TelemetryIngestAttributionSettings.getProjectConfig(
      "b2b2b2b2-0000-4000-8000-0000000000fe",
    );

    expect(projects).toHaveBeenCalledTimes(1);
    expect(budgets).toHaveBeenCalledTimes(1);
    expect(
      await TelemetryIngestAttributionSettings.isAttributedProject(
        "b2b2b2b2-0000-4000-8000-0000000000fe",
      ),
    ).toBe(false);
  });
});

describe("a project that publishes its usage as metrics", () => {
  test("is attributed for its usage alone, with no budget to check", async () => {
    expect(
      await TelemetryIngestAttributionSettings.getProjectConfig(OTHER_PROJECT),
    ).toEqual({
      publishesUsageMetrics: true,
      budgets: [],
      budgetsByResourceId: new Map(),
    });
    expect(projects.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        query: { publishTelemetryUsageMetrics: true },
      }),
    );
    expect(
      await TelemetryIngestAttributionSettings.isAttributedProject(
        OTHER_PROJECT,
      ),
    ).toBe(true);
    expect(readsOfKinds()).toBe(0);
  });
});

describe("a project with team and label budgets", () => {
  test("knows each budget, and its own daily budgets", async () => {
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
    expect(
      await TelemetryIngestAttributionSettings.isAttributedProject(PROJECT),
    ).toBe(true);
  });

  test("a team's budget counts every service, host and cluster the team owns, and a label's everything that carries it", async () => {
    const config: TelemetryIngestAttributionConfig | null =
      await TelemetryIngestAttributionSettings.getProjectConfig(PROJECT);

    expect(config!.budgetsByResourceId).toEqual(
      new Map([
        // The team's service, which carries the label too.
        [CHECKOUT, [0, 1]],
        // A service with the label, beside one the budget does not name.
        [CART, [1]],
        // The team's host; a host with the label.
        [WEB_HOST, [0]],
        [DB_HOST, [1]],
        // The team's cluster, which carries the label.
        [PROD_CLUSTER, [0, 1]],
      ]),
    );
  });

  test("asks each kind what the budgets' teams own and what carries their labels, pinned to the project", async () => {
    await TelemetryIngestAttributionSettings.getProjectConfig(PROJECT);

    for (const [owners, column] of [
      [mockServiceOwners, "serviceId"],
      [mockHostOwners, "hostId"],
      [mockClusterOwners, "kubernetesClusterId"],
    ] as Array<[FakeService, string]>) {
      expect(owners.findAllBy).toHaveBeenCalledTimes(1);

      const read: Record<string, unknown> = owners.findAllBy.mock
        .calls[0]![0] as Record<string, unknown>;
      const query: Record<string, unknown> = read["query"] as Record<
        string,
        unknown
      >;

      expect(String(query["projectId"])).toBe(PROJECT);
      // Any of the budgets' teams, in one read.
      const teamIds: Array<unknown> = Object.values(
        (
          query["teamId"] as unknown as {
            _objectLiteralParameters: Record<string, Array<unknown>>;
          }
        )._objectLiteralParameters,
      ).flat();

      expect(query["teamId"]).toEqual(
        expect.objectContaining({
          _type: (
            QueryHelper.any([new ObjectID(TEAM)]) as unknown as {
              _type: string;
            }
          )._type,
        }),
      );
      expect(
        teamIds.map((id: unknown) => {
          return String(id);
        }),
      ).toEqual([TEAM]);
      expect(read["select"]).toEqual({ [column]: true, teamId: true });
      expect(read["props"]).toEqual({ isRoot: true });
    }

    for (const resources of [mockServices, mockHosts, mockClusters]) {
      expect(resources.findAllBy).toHaveBeenCalledTimes(1);

      const read: Record<string, unknown> = resources.findAllBy.mock
        .calls[0]![0] as Record<string, unknown>;
      const query: Record<string, unknown> = read["query"] as Record<
        string,
        unknown
      >;

      expect(String(query["projectId"])).toBe(PROJECT);
      expect(
        (query["labels"] as Array<ObjectID>).map((id: ObjectID) => {
          return id.toString();
        }),
      ).toEqual([LABEL]);
      expect(read["select"]).toEqual({ _id: true, labels: { _id: true } });
    }
  });

  test("never reads a kind of record that owns no telemetry", async () => {
    await TelemetryIngestAttributionSettings.getProjectConfig(PROJECT);

    expect(mockQueueOwners.findAllBy).not.toHaveBeenCalled();
    expect(mockQueues.findAllBy).not.toHaveBeenCalled();
  });

  test("reads no owners without a team's budget, and no labels without a label's", async () => {
    budgetRowsHeld = [teamAndLabelBudgets()[0]!];

    await TelemetryIngestAttributionSettings.getProjectConfig(PROJECT);

    expect(mockHostOwners.findAllBy).toHaveBeenCalledTimes(1);
    expect(mockHosts.findAllBy).not.toHaveBeenCalled();

    TelemetryIngestAttributionSettings.clearCaches();
    jest.clearAllMocks();
    budgetRowsHeld = [teamAndLabelBudgets()[1]!];

    await TelemetryIngestAttributionSettings.getProjectConfig(PROJECT);

    expect(mockHostOwners.findAllBy).not.toHaveBeenCalled();
    expect(mockHosts.findAllBy).toHaveBeenCalledTimes(1);
  });

  test("finds a resource, a team and a label whatever the case of their ids", async () => {
    budgetRowsHeld = [
      {
        projectId: new ObjectID(PROJECT),
        teamId: new ObjectID(TEAM.toUpperCase()),
        logsDailyIngestionBudgetInGB: 1,
      },
    ];
    mockHostOwners.findAllBy.mockResolvedValue([
      {
        hostId: new ObjectID(WEB_HOST.toUpperCase()),
        teamId: new ObjectID(TEAM),
      },
    ] as never);

    const config: TelemetryIngestAttributionConfig | null =
      await TelemetryIngestAttributionSettings.getProjectConfig(PROJECT);

    expect(config!.budgetsByResourceId.get(WEB_HOST)).toEqual([0]);
  });

  test("counts nothing a row of no budget's team or label names", async () => {
    // Rows of a team or a label the budgets do not name, or with no id at all.
    mockHostOwners.findAllBy.mockResolvedValue([
      { hostId: new ObjectID(WEB_HOST), teamId: new ObjectID(OTHER_PROJECT) },
      { hostId: undefined, teamId: new ObjectID(TEAM) },
    ] as never);
    mockHosts.findAllBy.mockResolvedValue([
      carrying(DB_HOST, [OTHER_LABEL]),
      { _id: undefined, labels: [{ _id: LABEL }] },
      { _id: WEB_HOST },
    ] as never);
    mockServiceOwners.findAllBy.mockResolvedValue([] as never);
    mockServices.findAllBy.mockResolvedValue([] as never);
    mockClusterOwners.findAllBy.mockResolvedValue([] as never);
    mockClusters.findAllBy.mockResolvedValue([] as never);

    const config: TelemetryIngestAttributionConfig | null =
      await TelemetryIngestAttributionSettings.getProjectConfig(PROJECT);

    expect(config!.budgetsByResourceId).toEqual(new Map());
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
    // Each kind once: its owners and its labels.
    expect(readsOfKinds()).toBe(6);
  });

  test("forgets what it knew of a project once its budgets are saved on this server", async () => {
    await TelemetryIngestAttributionSettings.getProjectConfig(PROJECT);

    TelemetryIngestAttributionSettings.forgetProject(PROJECT);
    await TelemetryIngestAttributionSettings.getProjectConfig(PROJECT);

    expect(budgets).toHaveBeenCalledTimes(4);
  });

  test("a first read that fails is no budgets for a few seconds, rather than a query a batch", async () => {
    mockHostOwners.findAllBy.mockRejectedValue(
      new Error("Postgres is down") as never,
    );

    expect(
      await TelemetryIngestAttributionSettings.getProjectConfig(PROJECT),
    ).toBe(null);
    expect(
      await TelemetryIngestAttributionSettings.getProjectConfig(PROJECT),
    ).toBe(null);

    // The failed read is remembered for a few seconds.
    expect(mockHostOwners.findAllBy).toHaveBeenCalledTimes(1);
  });
});

describe("once a project was read, no batch waits for its next read", () => {
  test("what was read last is served while the next read runs", async () => {
    const first: TelemetryIngestAttributionConfig | null =
      await TelemetryIngestAttributionSettings.getProjectConfig(PROJECT);

    expect(first!.budgetsByResourceId.has(WEB_HOST)).toBe(true);

    // A minute on, the team owns another host; the read of it is slow.
    advance(TELEMETRY_INGEST_ATTRIBUTION_SETTINGS_TTL_MS + 1);

    let release: () => void = (): void => {
      return undefined;
    };
    mockHostOwners.findAllBy.mockImplementation((async () => {
      await new Promise<void>((resolve: () => void) => {
        release = resolve;
      });
      return [
        { hostId: new ObjectID(WEB_HOST), teamId: new ObjectID(TEAM) },
        { hostId: new ObjectID(DB_HOST), teamId: new ObjectID(TEAM) },
      ];
    }) as never);

    // The batch is answered at once, with what was read last.
    const during: TelemetryIngestAttributionConfig | null =
      await TelemetryIngestAttributionSettings.getProjectConfig(PROJECT);

    expect(during).toEqual(first);
    expect(during!.budgetsByResourceId.get(DB_HOST)).toEqual([1]);

    /*
     * One read again however many batches ask meanwhile: of the set of
     * every project, and of the project's own.
     */
    await TelemetryIngestAttributionSettings.getProjectConfig(PROJECT);
    await settleReads();
    expect(budgets).toHaveBeenCalledTimes(4);
    expect(mockHostOwners.findAllBy).toHaveBeenCalledTimes(2);

    release();
    await settleReads();

    const after: TelemetryIngestAttributionConfig | null =
      await TelemetryIngestAttributionSettings.getProjectConfig(PROJECT);

    expect(after!.budgetsByResourceId.get(DB_HOST)).toEqual([0, 1]);
  });

  test("a read that fails keeps what was read last, and is tried again a few seconds later", async () => {
    const first: TelemetryIngestAttributionConfig | null =
      await TelemetryIngestAttributionSettings.getProjectConfig(PROJECT);

    advance(TELEMETRY_INGEST_ATTRIBUTION_SETTINGS_TTL_MS + 1);
    mockHostOwners.findAllBy.mockRejectedValue(
      new Error("Postgres is down") as never,
    );

    await TelemetryIngestAttributionSettings.getProjectConfig(PROJECT);
    await settleReads();

    // The budgets still count, as they were read.
    expect(
      await TelemetryIngestAttributionSettings.getProjectConfig(PROJECT),
    ).toEqual(first);
    expect(mockHostOwners.findAllBy).toHaveBeenCalledTimes(2);

    // Not again for a few seconds; then again.
    await TelemetryIngestAttributionSettings.getProjectConfig(PROJECT);
    await settleReads();
    expect(mockHostOwners.findAllBy).toHaveBeenCalledTimes(2);

    advance(10_001);
    await TelemetryIngestAttributionSettings.getProjectConfig(PROJECT);
    await settleReads();
    expect(mockHostOwners.findAllBy).toHaveBeenCalledTimes(3);
  });

  test("a budget saved on this server applies to the next batch, and a read that started before the save stores nothing", async () => {
    await TelemetryIngestAttributionSettings.getProjectConfig(PROJECT);

    // A read again starts, and is slow; it reads the budgets before the save.
    advance(TELEMETRY_INGEST_ATTRIBUTION_SETTINGS_TTL_MS + 1);

    let release: () => void = (): void => {
      return undefined;
    };
    budgets.mockImplementation((async (data: {
      query: Record<string, unknown>;
    }) => {
      const rows: Array<unknown> = budgetRows(data.query);

      if (data.query["projectId"]) {
        await new Promise<void>((resolve: () => void) => {
          release = resolve;
        });
      }

      return rows;
    }) as never);

    await TelemetryIngestAttributionSettings.getProjectConfig(PROJECT);
    await settleReads();

    // The team's budget is deleted, and the save tells this server.
    budgetRowsHeld = [teamAndLabelBudgets()[1]!];
    budgets.mockImplementation((async (data: {
      query: Record<string, unknown>;
    }) => {
      return budgetRows(data.query);
    }) as never);
    TelemetryIngestAttributionSettings.forgetProject(PROJECT);

    const afterSave: TelemetryIngestAttributionConfig | null =
      await TelemetryIngestAttributionSettings.getProjectConfig(PROJECT);

    expect(
      afterSave!.budgets.map((budget: { scope: string }) => {
        return budget.scope;
      }),
    ).toEqual([TelemetryIngestionBudgetScope.Label]);

    // The read from before the save ends, and is not stored.
    release();
    await settleReads();

    const later: TelemetryIngestAttributionConfig | null =
      await TelemetryIngestAttributionSettings.getProjectConfig(PROJECT);

    expect(
      later!.budgets.map((budget: { scope: string }) => {
        return budget.scope;
      }),
    ).toEqual([TelemetryIngestionBudgetScope.Label]);
  });

  test("a read after a save that fails keeps what was read before it", async () => {
    const first: TelemetryIngestAttributionConfig | null =
      await TelemetryIngestAttributionSettings.getProjectConfig(PROJECT);

    TelemetryIngestAttributionSettings.forgetProject(PROJECT);
    mockHostOwners.findAllBy.mockRejectedValue(
      new Error("Postgres is down") as never,
    );

    expect(
      await TelemetryIngestAttributionSettings.getProjectConfig(PROJECT),
    ).toEqual(first);
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

  test("are served as read last while the next read runs, and kept when it fails", async () => {
    expect(
      await TelemetryIngestAttributionSettings.getUsageMetricProjects(),
    ).toEqual(new Set([OTHER_PROJECT]));

    advance(TELEMETRY_INGEST_ATTRIBUTION_SETTINGS_TTL_MS + 1);
    projects.mockRejectedValue(new Error("Postgres is down") as never);

    expect(
      await TelemetryIngestAttributionSettings.getUsageMetricProjects(),
    ).toEqual(new Set([OTHER_PROJECT]));
    await settleReads();
    expect(projects).toHaveBeenCalledTimes(2);

    // Kept, even once forgotten by a save on this server.
    TelemetryIngestAttributionSettings.forgetProject(OTHER_PROJECT);
    expect(
      await TelemetryIngestAttributionSettings.getUsageMetricProjects(),
    ).toEqual(new Set([OTHER_PROJECT]));
  });
});
