import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";
import { FindOperator } from "typeorm";
import CommonAPI from "../../../../Server/API/CommonAPI";
import DataObservabilityAPI from "../../../../Server/API/DataObservabilityAPI";
import AlertService from "../../../../Server/Services/AlertService";
import ChangeEventService from "../../../../Server/Services/ChangeEventService";
import DataAlertService from "../../../../Server/Services/DataAlertService";
import DataAssetFeedService from "../../../../Server/Services/DataAssetFeedService";
import DataAssetLineageService from "../../../../Server/Services/DataAssetLineageService";
import DataAssetOwnerTeamService from "../../../../Server/Services/DataAssetOwnerTeamService";
import DataAssetOwnerUserService from "../../../../Server/Services/DataAssetOwnerUserService";
import DataAssetService from "../../../../Server/Services/DataAssetService";
import DataAssetUsageService from "../../../../Server/Services/DataAssetUsageService";
import DataPipelineRunService from "../../../../Server/Services/DataPipelineRunService";
import DataPipelineService from "../../../../Server/Services/DataPipelineService";
import DataTableDashboards, {
  TableDashboard,
} from "../../../../Server/Utils/DataObservability/Bi/DataTableDashboards";
import DataAlertExplanationReader from "../../../../Server/Utils/DataObservability/DataAlertExplanation";
import DataObservabilityReadScope, {
  DataObservabilityScope,
} from "../../../../Server/Utils/DataObservability/DataObservabilityReadScope";
import DataTableErrors from "../../../../Server/Utils/DataObservability/DataTableErrors";
import DataTableLineageReader, {
  DataLineageReadable,
} from "../../../../Server/Utils/DataObservability/DataTableLineage";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../../../../Server/Utils/Express";
import Response from "../../../../Server/Utils/Response";
import Alert from "../../../../Models/DatabaseModels/Alert";
import DataAlert from "../../../../Models/DatabaseModels/DataAlert";
import DataAsset from "../../../../Models/DatabaseModels/DataAsset";
import DataAssetLineage from "../../../../Models/DatabaseModels/DataAssetLineage";
import DataAssetOwnerTeam from "../../../../Models/DatabaseModels/DataAssetOwnerTeam";
import DataAssetOwnerUser from "../../../../Models/DatabaseModels/DataAssetOwnerUser";
import DataAssetUsage from "../../../../Models/DatabaseModels/DataAssetUsage";
import DataPipeline from "../../../../Models/DatabaseModels/DataPipeline";
import DataPipelineRun from "../../../../Models/DatabaseModels/DataPipelineRun";
import Team from "../../../../Models/DatabaseModels/Team";
import User from "../../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  DataAlertCauseKind,
  DataAlertExplanation,
  DataAlertLikelyCause,
} from "../../../../Types/DataObservability/DataAlertFeedback";
import { DataAssetAccessKind } from "../../../../Types/DataObservability/DataAssetUsage";
import { DATA_OBSERVABILITY_API_ROUTES } from "../../../../Types/DataObservability/DataObservabilityApiTypes";
import { JSONObject } from "../../../../Types/JSON";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import UserType from "../../../../Types/UserType";

/*
 * A DATA ALERT'S CARD EXPLAINS IT WITH ONLY WHAT ITS READER MAY READ
 * (#9562).
 *
 * The card says why the alert most likely happened - a failed run of a
 * pipeline that writes the table, among other facts - and what it reaches:
 * the tables down its lineage, the dashboards, the services reading them
 * and the people who own them. Its Lineage card, beside it, draws only the
 * tables and pipelines its reader may read since #9560; the explanation
 * read every one as OneUptime, so a role limited to what its members own
 * was told HR's tables, pipeline and owners there. It reads them by its
 * reader's grants now, by the rule every lineage view keeps:
 *
 *   - a pipeline they may not read is no cause, nor one whose only rows
 *     into the table come from a table they may not read;
 *   - the walk down the lineage goes through the tables they may read
 *     alone, and counts only those as feeding from one;
 *   - services and owners are those of the tables they may read;
 *   - an alert on a table or pipeline they may not read is explained by
 *     its cause upstream alone, as its Lineage card draws nothing.
 *
 * A reader whose grants narrow nothing, and OneUptime's own read, are told
 * every one, as before.
 *
 *   staging.orders -[orders_etl]-> public.orders <-[hr_extract]- hr.salaries
 *   payroll_sync writes public.orders from outside
 *   public.orders -> marts.revenue -> marts.kpis
 *   public.orders -> hr.headcount -> marts.exec   (exec only through HR's)
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const ALERT_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-000000000001");
const CAUSE_ALERT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-000000000002",
);
const MEMBER: ObjectID = new ObjectID("55555555-5555-4555-8555-000000000001");

function id(kind: number, index: number): string {
  return `${kind.toString().padStart(8, "0")}-0000-4000-8000-${index
    .toString()
    .padStart(12, "0")}`;
}

const ORDERS: string = id(1, 0);
const STAGING: string = id(1, 1);
const REVENUE: string = id(1, 2);
const KPIS: string = id(1, 3);
const EXEC: string = id(1, 4);
const SALARIES: string = id(1, 10);
const HEADCOUNT: string = id(1, 11);
const ORDERS_ETL: string = id(2, 1);
const HR_EXTRACT: string = id(2, 8);
const PAYROLL_SYNC: string = id(2, 9);

const TABLE_NAMES: Record<string, string> = {
  [ORDERS]: "public.orders",
  [STAGING]: "staging.orders",
  [REVENUE]: "marts.revenue",
  [KPIS]: "marts.kpis",
  [EXEC]: "marts.exec",
  [SALARIES]: "hr.salaries",
  [HEADCOUNT]: "hr.headcount",
};
const JOB_NAMES: Record<string, string> = {
  [ORDERS_ETL]: "orders_etl",
  [HR_EXTRACT]: "hr_extract",
  [PAYROLL_SYNC]: "payroll_sync",
};

// The rows into public.orders naming a pipeline.
const WRITES: Array<{ upstream: string | null; pipeline: string }> = [
  { upstream: STAGING, pipeline: ORDERS_ETL },
  { upstream: null, pipeline: PAYROLL_SYNC },
  { upstream: SALARIES, pipeline: HR_EXTRACT },
];
const BUILT_FROM: Record<string, Array<string>> = {
  [ORDERS]: [REVENUE, HEADCOUNT],
  [REVENUE]: [KPIS],
  [HEADCOUNT]: [EXEC],
};
// The services reading each table, and the teams owning it.
const READERS: Record<string, string> = {
  [REVENUE]: "billing-api",
  [HEADCOUNT]: "hr-portal",
};
const OWNING_TEAMS: Record<string, string> = {
  [REVENUE]: "Revenue Team",
  [HEADCOUNT]: "HR Team",
};
const OWNING_USERS: Record<string, string> = {
  [EXEC]: "Executive Assistant",
};

const HR_NAMES: Array<string> = [
  "hr.salaries",
  "hr.headcount",
  "marts.exec",
  "payroll_sync",
  "hr_extract",
  "permission denied for table salaries",
  "hr-portal",
  "HR Team",
  "Executive Assistant",
];

const READER: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: MEMBER,
  userType: UserType.User,
  userTenantAccessPermission: {
    [PROJECT_ID.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT_ID,
      permissions: [
        {
          _type: "UserPermission",
          permission: Permission.ReadDataAsset,
          labelIds: [],
          isBlockPermission: false,
        },
      ],
    },
  },
};

// A role limited to what its members own: every table and pipeline but HR's.
const OWNED_SCOPE: DataObservabilityScope = {
  ...DataObservabilityReadScope.wholeProject(PROJECT_ID),
  isWholeProject: false,
};

let readableOf: ReturnType<typeof jest.spyOn>;
let dashboardsFind: ReturnType<typeof jest.spyOn>;
let lineageReads: Array<Record<string, unknown>>;

function hrSetApart(): DataLineageReadable {
  return {
    readableTableIds: async (ids: Array<string>): Promise<Set<string>> => {
      return new Set(
        ids.filter((each: string): boolean => {
          return each !== SALARIES && each !== HEADCOUNT;
        }),
      );
    },
    readablePipelineIds: async (ids: Array<string>): Promise<Set<string>> => {
      return new Set(
        ids.filter((each: string): boolean => {
          return each !== PAYROLL_SYNC;
        }),
      );
    },
  };
}

// The ids a QueryHelper.any condition, or a plain id, names.
function idsIn(condition: unknown): Array<string> {
  if (condition instanceof FindOperator) {
    return Object.values(
      (condition.objectLiteralParameters as Record<string, unknown>) || {},
    ).flatMap((value: unknown): Array<string> => {
      return Array.isArray(value) ? value.map(String) : [String(value)];
    });
  }

  return condition === undefined || condition === null
    ? []
    : [String(condition)];
}

function stubAlert(about: {
  table?: string;
  pipeline?: string;
  isCaused?: boolean;
}): void {
  const row: DataAlert = new DataAlert();

  if (about.table) {
    row.dataAssetId = new ObjectID(about.table);
  }

  if (about.pipeline) {
    row.dataPipelineId = new ObjectID(about.pipeline);
  }

  if (about.isCaused) {
    row.causeAlertId = CAUSE_ALERT_ID;
  }

  jest.spyOn(DataAlertService, "findOneBy").mockResolvedValue(row as never);
}

function stubProject(): void {
  lineageReads = [];

  jest.spyOn(AlertService, "findOneBy").mockImplementation((async (findBy: {
    query: { _id: ObjectID };
  }): Promise<Alert> => {
    const alert: Alert = new Alert();
    alert._id = findBy.query._id.toString();
    alert.createdAt = new Date("2026-11-04T09:00:00.000Z");
    alert.title = "warehouse load failed";
    alert.alertNumberWithPrefix = "ALT-3";
    alert.isPrivate = false;
    return alert;
  }) as never);

  jest
    .spyOn(DataAssetLineageService, "findBy")
    .mockImplementation((async (findBy: {
      query: Record<string, unknown>;
    }): Promise<Array<DataAssetLineage>> => {
      lineageReads.push(findBy.query);

      if (findBy.query["dataPipelineId"] !== undefined) {
        return WRITES.map(
          (write: {
            upstream: string | null;
            pipeline: string;
          }): DataAssetLineage => {
            const row: DataAssetLineage = new DataAssetLineage();

            if (write.upstream) {
              row.upstreamDataAssetId = new ObjectID(write.upstream);
            }

            row.downstreamDataAssetId = new ObjectID(ORDERS);
            row.dataPipelineId = new ObjectID(write.pipeline);

            return row;
          },
        );
      }

      return idsIn(findBy.query["upstreamDataAssetId"]).flatMap(
        (upstream: string): Array<DataAssetLineage> => {
          return (BUILT_FROM[upstream] || []).map(
            (downstream: string): DataAssetLineage => {
              const row: DataAssetLineage = new DataAssetLineage();
              row.upstreamDataAssetId = new ObjectID(upstream);
              row.downstreamDataAssetId = new ObjectID(downstream);
              return row;
            },
          );
        },
      );
    }) as never);

  // Every pipeline failed its last run, HR's with the name of a table set apart in its error.
  jest
    .spyOn(DataPipelineRunService, "findBy")
    .mockImplementation((async (findBy: {
      query: { dataPipelineId: ObjectID };
    }): Promise<Array<DataPipelineRun>> => {
      const run: DataPipelineRun = new DataPipelineRun();
      run.state = "FAIL";
      run.startedAt = new Date("2026-11-04T08:00:00.000Z");
      run.errorMessage =
        findBy.query.dataPipelineId.toString() === ORDERS_ETL
          ? "connection reset"
          : "permission denied for table salaries";
      return [run];
    }) as never);
  jest
    .spyOn(DataPipelineService, "findOneById")
    .mockImplementation((async (findBy: {
      id: ObjectID;
    }): Promise<DataPipeline> => {
      const pipeline: DataPipeline = new DataPipeline();
      pipeline.jobName = JOB_NAMES[findBy.id.toString()]!;
      return pipeline;
    }) as never);

  jest
    .spyOn(DataAssetUsageService, "findBy")
    .mockImplementation((async (findBy: {
      query: { accessKind: DataAssetAccessKind; dataAssetId: unknown };
    }): Promise<Array<DataAssetUsage>> => {
      if (findBy.query.accessKind !== DataAssetAccessKind.Read) {
        return [];
      }

      return idsIn(findBy.query.dataAssetId)
        .filter((table: string): boolean => {
          return Boolean(READERS[table]);
        })
        .map((table: string): DataAssetUsage => {
          const usage: DataAssetUsage = new DataAssetUsage();
          usage.serviceName = READERS[table]!;
          return usage;
        });
    }) as never);
  jest.spyOn(DataTableErrors, "read").mockResolvedValue({
    services: [],
    exceptions: [],
    logs: [],
  } as never);
  jest.spyOn(ChangeEventService, "findBy").mockResolvedValue([] as never);
  jest.spyOn(DataAssetFeedService, "findBy").mockResolvedValue([] as never);
  jest.spyOn(DataAssetService, "findOneById").mockResolvedValue(null as never);
  jest.spyOn(DataAssetService, "findBy").mockImplementation((async (findBy: {
    query: { _id: unknown };
  }): Promise<Array<DataAsset>> => {
    return idsIn(findBy.query._id).map((table: string): DataAsset => {
      const asset: DataAsset = new DataAsset();
      asset._id = table;
      asset.assetKey = TABLE_NAMES[table]!;
      return asset;
    });
  }) as never);
  jest
    .spyOn(DataAssetOwnerTeamService, "findBy")
    .mockImplementation((async (findBy: {
      query: { dataAssetId: unknown };
    }): Promise<Array<DataAssetOwnerTeam>> => {
      return idsIn(findBy.query.dataAssetId)
        .filter((table: string): boolean => {
          return Boolean(OWNING_TEAMS[table]);
        })
        .map((table: string): DataAssetOwnerTeam => {
          const owner: DataAssetOwnerTeam = new DataAssetOwnerTeam();
          const team: Team = new Team();
          team.name = OWNING_TEAMS[table]!;
          owner.team = team;
          return owner;
        });
    }) as never);
  jest
    .spyOn(DataAssetOwnerUserService, "findBy")
    .mockImplementation((async (findBy: {
      query: { dataAssetId: unknown };
    }): Promise<Array<DataAssetOwnerUser>> => {
      return idsIn(findBy.query.dataAssetId)
        .filter((table: string): boolean => {
          return Boolean(OWNING_USERS[table]);
        })
        .map((table: string): DataAssetOwnerUser => {
          const owner: DataAssetOwnerUser = new DataAssetOwnerUser();
          const user: User = new User();
          user.name = new Name(OWNING_USERS[table]!);
          owner.user = user;
          return owner;
        });
    }) as never);

  // The dashboards: what the walk to them may read decides, as DataTableAnswerReadScope holds.
  dashboardsFind = jest
    .spyOn(DataTableDashboards, "find")
    .mockImplementation((async (data: {
      readable?: DataLineageReadable | null;
    }): Promise<Array<TableDashboard>> => {
      const readable: Set<string> = data.readable
        ? await data.readable.readableTableIds([REVENUE, HEADCOUNT])
        : new Set([REVENUE, HEADCOUNT]);

      return [REVENUE, HEADCOUNT]
        .filter((table: string): boolean => {
          return readable.has(table);
        })
        .map((table: string): TableDashboard => {
          return {
            dataDashboardId: id(3, table === REVENUE ? 1 : 2),
            name: table === REVENUE ? "Revenue" : "HR Headcount",
            url: null,
            tool: "Looker",
            folder: null,
            owner: null,
            via: { dataAssetId: table, table: TABLE_NAMES[table]! },
          };
        });
    }) as never);

  // The caller's grants: limited to what they own, every table and pipeline but HR's.
  jest.spyOn(DataObservabilityReadScope, "get").mockImplementation((async (
    _projectId: ObjectID,
    props: DatabaseCommonInteractionProps | null | undefined,
  ) => {
    return props === READER
      ? OWNED_SCOPE
      : DataObservabilityReadScope.wholeProject(PROJECT_ID);
  }) as never);
  readableOf = jest
    .spyOn(DataTableLineageReader, "getReadable")
    .mockImplementation(((): DataLineageReadable => {
      return hrSetApart();
    }) as never);
}

beforeEach(() => {
  jest.restoreAllMocks();
  stubProject();
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function explain(
  reader?: DatabaseCommonInteractionProps,
): Promise<DataAlertExplanation> {
  const explanation: DataAlertExplanation | null =
    await DataAlertExplanationReader.read({
      projectId: PROJECT_ID,
      alertId: ALERT_ID,
      ...(reader ? { reader } : {}),
    });

  expect(explanation).not.toBeNull();

  return explanation!;
}

function causeTitles(explanation: DataAlertExplanation): Array<string> {
  return explanation.causes.map((cause: DataAlertLikelyCause): string => {
    return `${cause.kind}: ${cause.title}${cause.detail ? ` (${cause.detail})` : ""}`;
  });
}

describe("a data alert's card, for a role limited to what its members own", () => {
  test("no pipeline set apart is a cause, nor one whose only rows come from a table set apart", async () => {
    stubAlert({ table: ORDERS });

    const causes: Array<DataAlertLikelyCause> = (await explain(READER)).causes;

    expect(
      causes.filter((cause: DataAlertLikelyCause): boolean => {
        return cause.kind === DataAlertCauseKind.FailedRun;
      }),
    ).toHaveLength(1);
    expect(JSON.stringify(causes)).toContain("orders_etl");
    expect(JSON.stringify(causes)).toContain("connection reset");
  });

  test("what it reaches: the tables down its lineage they may read, each counted by those alone", async () => {
    stubAlert({ table: ORDERS });

    const explanation: DataAlertExplanation = await explain(READER);

    expect(explanation.impact.tables).toEqual([
      { name: "marts.revenue", dependents: 1 },
      { name: "marts.kpis", dependents: 0 },
    ]);
    expect(explanation.impact.dashboards).toEqual(["Revenue"]);
    expect(explanation.impact.services).toEqual(["billing-api"]);
    expect(explanation.impact.people).toEqual(["Revenue Team"]);
  });

  test("nothing of HR's anywhere in what the card is sent", async () => {
    stubAlert({ table: ORDERS });

    const json: string = JSON.stringify(await explain(READER));

    for (const name of HR_NAMES) {
      expect(json).not.toContain(name);
    }

    for (const each of [SALARIES, HEADCOUNT, EXEC, PAYROLL_SYNC, HR_EXTRACT]) {
      expect(json).not.toContain(each);
    }
  });

  test("its dashboards are asked through the same scope", async () => {
    stubAlert({ table: ORDERS });

    await explain(READER);

    const readable: DataLineageReadable | null = (
      dashboardsFind.mock.calls[0]![0] as {
        readable: DataLineageReadable | null;
      }
    ).readable;

    expect(readable).not.toBeNull();
    expect(await readable!.readableTableIds([REVENUE, HEADCOUNT])).toEqual(
      new Set([REVENUE]),
    );
    expect(readableOf).toHaveBeenCalledWith(OWNED_SCOPE);
  });

  test("an alert on a table they may not read is explained by its cause upstream alone", async () => {
    stubAlert({ table: HEADCOUNT, isCaused: true });

    const explanation: DataAlertExplanation = await explain(READER);

    expect(causeTitles(explanation)).toEqual([
      `${DataAlertCauseKind.UpstreamAlert}: ALT-3 warehouse load failed`,
    ]);
    expect(explanation.impact).toEqual({
      tables: [],
      dashboards: [],
      services: [],
      people: [],
    });
    // Nothing read around the table.
    expect(lineageReads).toEqual([]);
    expect(dashboardsFind).not.toHaveBeenCalled();
  });

  test("an alert on a pipeline they may not read: none of its runs is told", async () => {
    stubAlert({ pipeline: PAYROLL_SYNC });

    const explanation: DataAlertExplanation = await explain(READER);

    expect(explanation.causes).toEqual([]);
    expect(JSON.stringify(explanation)).not.toContain("payroll_sync");
  });

  test("an alert on their own pipeline still tells its failed run", async () => {
    stubAlert({ pipeline: ORDERS_ETL });

    expect(causeTitles(await explain(READER))).toEqual([
      expect.stringContaining("orders_etl"),
    ]);
  });
});

describe("a data alert's card, for a reader whose grants narrow nothing", () => {
  test("OneUptime's own read, and a reader the scope narrows nothing for, are told every table and pipeline, as before", async () => {
    stubAlert({ table: ORDERS });

    for (const explanation of [
      await explain(),
      await explain({ ...READER, userId: new ObjectID(id(5, 9)) }),
    ]) {
      expect(
        explanation.causes.filter((cause: DataAlertLikelyCause): boolean => {
          return cause.kind === DataAlertCauseKind.FailedRun;
        }),
      ).toHaveLength(3);
      expect(explanation.impact.tables).toEqual([
        { name: "hr.headcount", dependents: 1 },
        { name: "marts.revenue", dependents: 1 },
        { name: "marts.exec", dependents: 0 },
        { name: "marts.kpis", dependents: 0 },
      ]);
      expect(explanation.impact.services).toEqual(["billing-api", "hr-portal"]);
      expect(new Set(explanation.impact.people)).toEqual(
        new Set(["Revenue Team", "HR Team", "Executive Assistant"]),
      );
    }

    expect(readableOf).not.toHaveBeenCalled();
  });
});

describe("the alert-explanation route", () => {
  type RouteHandler = (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ) => Promise<void>;

  type RouterLayer = {
    route?: {
      path: string;
      methods: Record<string, boolean>;
      stack: Array<{ handle: RouteHandler }>;
    };
  };

  test("explains the alert to the person who asked, with their grants", async () => {
    const path: string = DATA_OBSERVABILITY_API_ROUTES.alertExplanation(":id");
    const router: ExpressRouter = new DataObservabilityAPI().getRouter();
    const layer: RouterLayer | undefined = (
      router as unknown as { stack: Array<RouterLayer> }
    ).stack.find((candidate: RouterLayer): boolean => {
      return (
        candidate.route?.path === path &&
        candidate.route.methods["post"] === true
      );
    });
    const handler: RouteHandler =
      layer!.route!.stack[layer!.route!.stack.length - 1]!.handle;
    const read: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataAlertExplanationReader, "read")
      .mockResolvedValue(null as never);
    const sent: Mock<(...args: Array<unknown>) => unknown> = jest.fn();
    const next: Mock<(...args: Array<unknown>) => unknown> = jest.fn();

    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(READER);
    jest
      .spyOn(Response, "sendJsonObjectResponse")
      .mockImplementation(sent as never);

    await handler(
      {
        body: {},
        params: { id: ALERT_ID.toString() },
      } as unknown as ExpressRequest,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

    expect(next).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      alertId: ALERT_ID,
      reader: READER,
    });
    expect((sent.mock.calls[0]![2] as JSONObject)["explanation"]).toBeNull();
  });
});
