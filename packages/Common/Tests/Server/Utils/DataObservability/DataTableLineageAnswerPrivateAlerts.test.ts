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
import AlertStateService from "../../../../Server/Services/AlertStateService";
import DataAlertService from "../../../../Server/Services/DataAlertService";
import DataAssetLineageService from "../../../../Server/Services/DataAssetLineageService";
import DataAssetService from "../../../../Server/Services/DataAssetService";
import DataDashboardService from "../../../../Server/Services/DataDashboardService";
import DataPipelineService from "../../../../Server/Services/DataPipelineService";
import AIToolbox, {
  ToolCallOutcome,
} from "../../../../Server/Utils/AI/Toolbox/Index";
import DataTableLineageAnswerer, {
  DataLineageAnswerTable,
  DataTableLineageAnswer,
} from "../../../../Server/Utils/DataObservability/DataTableLineageAnswer";
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
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../../Types/BaseDatabase/Includes";
import DataAssetKind from "../../../../Types/DataObservability/DataAssetKind";
import DataAssetLineageSource from "../../../../Types/DataObservability/DataAssetLineageSource";
import { DATA_OBSERVABILITY_API_ROUTES } from "../../../../Types/DataObservability/DataObservabilityApiTypes";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import PositiveNumber from "../../../../Types/PositiveNumber";
import UserType from "../../../../Types/UserType";
import {
  StoredRow,
  rowMatchesWhere,
} from "../../TestingUtils/InMemoryRepository";

/*
 * A TABLE'S LINEAGE COUNTS ONLY THE ALERTS ITS READER MAY SEE.
 *
 * "What is the orders table built from?" tells, for the table and for each
 * table up and down its lineage, how many alerts are open on it - never
 * which. A private alert is seen only by its owners - directly, or through
 * a team - and by the project's owners and admins
 * (Utils/Alert/AlertPrivacyFilter), so each path counts with its reader's
 * privacy clause (DataTableLineageReader.getDatabaseReader):
 *
 *   - the route (what the MCP server's get_data_table_lineage asks), for
 *     the person or the API key that asked;
 *   - the tool (Ask AI, an investigation's thread, Slack and Microsoft
 *     Teams, each for the person who asked), their own;
 *   - the tool in a run of OneUptime's own, read as root, and nobody in
 *     particular: the alerts that are not private.
 *
 * The rows are in memory behind the services, the reader of them is the
 * real one, and the privacy clause is read as Postgres reads it, with this
 * file's owners (passesPrivacyClause).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
// raw.orders -> public.orders -> marts.revenue; and another table called orders.
const ORDERS: string = "22222222-2222-4222-8222-000000000001";
const RAW: string = "22222222-2222-4222-8222-000000000002";
const REVENUE: string = "22222222-2222-4222-8222-000000000003";
const ARCHIVED_ORDERS: string = "22222222-2222-4222-8222-000000000004";

const CREATED: string = "33333333-3333-4333-8333-000000000001";
const RESOLVED: string = "33333333-3333-4333-8333-000000000002";

// The alerts, by table: each table upstream and down has a private one.
const PRIVATE_ON_ORDERS: string = "44444444-4444-4444-8444-000000000001";
const PRIVATE_ON_RAW: string = "44444444-4444-4444-8444-000000000002";
const PUBLIC_ON_RAW: string = "44444444-4444-4444-8444-000000000003";
const PRIVATE_ON_REVENUE: string = "44444444-4444-4444-8444-000000000004";
// Resolved: never counted, by anyone.
const RESOLVED_ON_REVENUE: string = "44444444-4444-4444-8444-000000000005";

const PRIVATE_TITLE: string = "Payroll export stalled";

// People of the project, and what each may do.
const OWNER: ObjectID = new ObjectID("55555555-5555-4555-8555-000000000001");
const TEAM_MEMBER: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-000000000002",
);
const MEMBER: ObjectID = new ObjectID("55555555-5555-4555-8555-000000000003");
const ADMIN: ObjectID = new ObjectID("55555555-5555-4555-8555-000000000004");
const PROJECT_OWNER: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-000000000005",
);
const DATA_READER: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-000000000006",
);

// Who owns the private alerts: one person, and the members of one team.
const PRIVATE_ALERTS: Array<string> = [
  PRIVATE_ON_ORDERS,
  PRIVATE_ON_RAW,
  PRIVATE_ON_REVENUE,
];
const DIRECT_OWNERS: Record<string, Array<string>> = Object.fromEntries(
  PRIVATE_ALERTS.map((id: string): [string, Array<string>] => {
    return [id, [OWNER.toString()]];
  }),
);
const TEAM_OWNERS: Record<string, Array<string>> = Object.fromEntries(
  PRIVATE_ALERTS.map((id: string): [string, Array<string>] => {
    return [id, [TEAM_MEMBER.toString()]];
  }),
);

// Fresh by its own rhythm against the clock the route and the tool read.
const RECENT: Date = new Date(Date.now() - 60 * 1000);

const TABLES: Array<StoredRow> = [
  [ORDERS, "public.orders", "orders", "Orders DB"],
  [RAW, "raw.orders", "raw_orders", "Orders DB"],
  [REVENUE, "marts.revenue", "revenue", "Orders DB"],
  [ARCHIVED_ORDERS, "archive.orders", "orders", "Archive DB"],
].map(([id, assetKey, name, database]: Array<string>): StoredRow => {
  return {
    _id: id,
    projectId: PROJECT_ID.toString(),
    assetKey,
    name,
    dataStoreName: database,
    assetKind: DataAssetKind.Table,
    lastChangedAt: RECENT,
    updateIntervalInSeconds: 3600,
    isDropped: false,
  };
});

const EDGES: Array<StoredRow> = [
  [RAW, ORDERS],
  [ORDERS, REVENUE],
].map(([upstream, downstream]: Array<string>): StoredRow => {
  return {
    projectId: PROJECT_ID.toString(),
    upstreamDataAssetId: upstream,
    downstreamDataAssetId: downstream,
    dataPipelineId: null,
    source: DataAssetLineageSource.QueryHistory,
    lastSeenAt: RECENT,
  };
});

const DATA_ALERTS: Array<StoredRow> = [
  [PRIVATE_ON_ORDERS, ORDERS],
  [PRIVATE_ON_RAW, RAW],
  [PUBLIC_ON_RAW, RAW],
  [PRIVATE_ON_REVENUE, REVENUE],
  [RESOLVED_ON_REVENUE, REVENUE],
].map(([alertId, dataAssetId]: Array<string>): StoredRow => {
  return { projectId: PROJECT_ID.toString(), alertId, dataAssetId };
});

const ALERTS: Array<StoredRow> = [
  [PRIVATE_ON_ORDERS, PRIVATE_TITLE, true, CREATED],
  [PRIVATE_ON_RAW, PRIVATE_TITLE, true, CREATED],
  [PUBLIC_ON_RAW, "raw.orders is late", false, CREATED],
  [PRIVATE_ON_REVENUE, PRIVATE_TITLE, true, CREATED],
  [RESOLVED_ON_REVENUE, "revenue was late", false, RESOLVED],
].map(([id, title, isPrivate, state]: Array<string | boolean>): StoredRow => {
  return {
    _id: id,
    projectId: PROJECT_ID.toString(),
    title,
    isPrivate,
    currentAlertStateId: state,
  };
});

function toModel<T>(model: T, row: StoredRow): T {
  for (const [column, value] of Object.entries(row)) {
    (model as unknown as StoredRow)[column] =
      typeof value === "string" && column.endsWith("Id") && column !== "_id"
        ? new ObjectID(value)
        : value;
  }

  return model;
}

// Whether a row matches a query as the database reads it: Includes too.
function matchesQuery(row: StoredRow, query: Record<string, unknown>): boolean {
  return Object.entries(query).every(
    ([column, condition]: [string, unknown]): boolean => {
      if (condition instanceof Includes) {
        return (condition.values as Array<string | ObjectID>)
          .map((value: string | ObjectID): string => {
            return value.toString().toLowerCase();
          })
          .includes(String(row[column]).toLowerCase());
      }

      return rowMatchesWhere(row, { [column]: condition });
    },
  );
}

/*
 * Whether a row passes the alert privacy clause on its isPrivate column
 * (AlertPrivacyFilter.getAlertSelfPrivacyRaw), read as Postgres reads it with
 * this file's owners: no clause for someone who sees every private alert; a
 * reader who is no one sees none; a person also the ones they own, directly
 * or through a team. Any other clause fails the test.
 */
function passesPrivacyClause(clause: unknown, row: StoredRow): boolean {
  if (clause === undefined) {
    return true;
  }

  if (!(clause instanceof FindOperator) || !clause.getSql) {
    throw new Error(`Not an alert privacy clause: ${String(clause)}`);
  }

  const sql: string = clause.getSql("c");
  const isPrivate: boolean = row["isPrivate"] === true;

  if (sql === "(c IS NULL OR c = FALSE)") {
    return !isPrivate;
  }

  const userIds: Array<string> = Object.values(
    (clause.objectLiteralParameters as Record<string, unknown>) || {},
  ).map(String);

  if (
    sql.startsWith("(c IS NULL OR c = FALSE OR ") &&
    sql.includes('"AlertOwnerUser"') &&
    sql.includes('"AlertOwnerTeam"') &&
    sql.includes('"TeamMember"') &&
    userIds.length === 1
  ) {
    const id: string = String(row["_id"]);

    return (
      !isPrivate ||
      (DIRECT_OWNERS[id] || []).includes(userIds[0]!) ||
      (TEAM_OWNERS[id] || []).includes(userIds[0]!)
    );
  }

  throw new Error(`An alert privacy clause this test does not read: ${sql}`);
}

// Someone of the project with one permission, as a signed-in request makes them.
function person(
  userId: ObjectID | undefined,
  permission: Permission,
  fields: Partial<DatabaseCommonInteractionProps> = {},
): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT_ID,
    userId: userId,
    userType: UserType.User,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: [
          {
            _type: "UserPermission",
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
          },
        ],
      },
    },
    ...fields,
  };
}

// A project API key with one permission, as the MCP server signs in with.
function apiKey(permission: Permission): DatabaseCommonInteractionProps {
  return person(undefined, permission, { userType: UserType.API });
}

const OUTSIDER: DatabaseCommonInteractionProps = person(
  MEMBER,
  Permission.ProjectMember,
);
const OWNERS: Array<[string, DatabaseCommonInteractionProps]> = [
  ["their owner", person(OWNER, Permission.ProjectMember)],
  [
    "a member of the team that owns them",
    person(TEAM_MEMBER, Permission.ProjectMember),
  ],
];
const ADMINS: Array<[string, DatabaseCommonInteractionProps]> = [
  ["a project admin", person(ADMIN, Permission.ProjectAdmin)],
  ["the project's owner", person(PROJECT_OWNER, Permission.ProjectOwner)],
];
// What an AI run of OneUptime's own reads as: an investigation's.
const SYSTEM_RUN: DatabaseCommonInteractionProps = {
  isRoot: true,
  tenantId: PROJECT_ID,
};

let alertReads: Array<{
  query: Record<string, unknown>;
  props: DatabaseCommonInteractionProps;
}>;
let tableReads: ReturnType<typeof jest.spyOn>;

function stubProject(): void {
  tableReads = jest
    .spyOn(DataAssetService, "findBy")
    .mockImplementation((async (findBy: {
      query: Record<string, unknown>;
      limit: number;
    }): Promise<Array<DataAsset>> => {
      return TABLES.filter((row: StoredRow): boolean => {
        return matchesQuery(row, findBy.query);
      })
        .slice(0, findBy.limit)
        .map((row: StoredRow): DataAsset => {
          return toModel(new DataAsset(), row);
        });
    }) as never);
  jest
    .spyOn(DataAssetLineageService, "findBy")
    .mockImplementation((async (findBy: {
      query: Record<string, unknown>;
    }): Promise<Array<DataAssetLineage>> => {
      return EDGES.filter((row: StoredRow): boolean => {
        return matchesQuery(row, findBy.query);
      }).map((row: StoredRow): DataAssetLineage => {
        return toModel(new DataAssetLineage(), row);
      });
    }) as never);
  jest.spyOn(DataPipelineService, "findBy").mockResolvedValue([] as never);
  jest.spyOn(DataAlertService, "findBy").mockImplementation((async (findBy: {
    query: Record<string, unknown>;
  }): Promise<Array<DataAlert>> => {
    return DATA_ALERTS.filter((row: StoredRow): boolean => {
      return matchesQuery(row, findBy.query);
    }).map((row: StoredRow): DataAlert => {
      return toModel(new DataAlert(), row);
    });
  }) as never);
  jest
    .spyOn(AlertStateService, "getUnresolvedAlertStateIds")
    .mockResolvedValue([new ObjectID(CREATED)] as never);
  jest.spyOn(DataDashboardService, "findBy").mockResolvedValue([] as never);
  jest
    .spyOn(DataDashboardService, "countBy")
    .mockResolvedValue(new PositiveNumber(0) as never);

  alertReads = [];

  // The open alerts the query names, as the database reads it.
  jest.spyOn(AlertService, "findBy").mockImplementation((async (findBy: {
    query: Record<string, unknown>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<Alert>> => {
    alertReads.push(findBy);

    const { isPrivate, ...rest } = findBy.query;

    return ALERTS.filter((row: StoredRow): boolean => {
      return matchesQuery(row, rest) && passesPrivacyClause(isPrivate, row);
    }).map((row: StoredRow): Alert => {
      return toModel(new Alert(), row);
    });
  }) as never);
}

beforeEach(() => {
  jest.restoreAllMocks();
  stubProject();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The open alerts counted on each table: the table itself, then up, then down.
interface Counts {
  orders: number;
  raw: number;
  revenue: number;
}

function countsOf(answer: DataTableLineageAnswer): Counts {
  const all: Array<DataLineageAnswerTable> = [
    ...answer.upstream.problems,
    ...answer.upstream.others,
    ...answer.downstream.problems,
    ...answer.downstream.others,
  ];
  const countOf: (id: string) => number = (id: string): number => {
    const table: DataLineageAnswerTable | undefined = all.find(
      (candidate: DataLineageAnswerTable): boolean => {
        return candidate.dataAssetId === id;
      },
    );

    expect(table).toBeDefined();

    return table!.openAlertCount;
  };

  return {
    orders: answer.self!.openAlertCount,
    raw: countOf(RAW),
    revenue: countOf(REVENUE),
  };
}

// What someone who sees no private alert is told: the public one on raw.orders.
const NOT_PRIVATE: Counts = { orders: 0, raw: 1, revenue: 0 };
// What someone who sees them all is told; the resolved alert never counts.
const EVERY_OPEN: Counts = { orders: 1, raw: 2, revenue: 1 };

describe("a table's lineage, by who reads it", () => {
  async function countsFor(
    reader: DatabaseCommonInteractionProps | null,
  ): Promise<Counts> {
    const answers: Array<DataTableLineageAnswer> =
      await DataTableLineageAnswerer.answer({
        projectId: PROJECT_ID,
        reference: "public.orders",
        depth: 3,
        now: new Date(),
        reader,
      });

    expect(answers).toHaveLength(1);

    return countsOf(answers[0]!);
  }

  test("a private alert is not counted for a member who does not own it", async () => {
    expect(await countsFor(OUTSIDER)).toEqual(NOT_PRIVATE);
  });

  test.each(OWNERS)(
    "and counted for %s",
    async (_who: string, props: DatabaseCommonInteractionProps) => {
      expect(await countsFor(props)).toEqual(EVERY_OPEN);
    },
  );

  test.each(ADMINS)(
    "and for %s, who sees every private alert",
    async (_who: string, props: DatabaseCommonInteractionProps) => {
      expect(await countsFor(props)).toEqual(EVERY_OPEN);
    },
  );

  test("someone who may read data assets, not alerts, is counted the alerts that are not private", async () => {
    expect(
      await countsFor(person(DATA_READER, Permission.ReadDataAsset)),
    ).toEqual(NOT_PRIVATE);

    // Read as OneUptime with their clause: the alert table's own rules would refuse them.
    expect(alertReads.length).toBeGreaterThan(0);

    for (const read of alertReads) {
      expect(read.props.isRoot).toBe(true);
      expect(read.query["isPrivate"]).toBeInstanceOf(FindOperator);
    }
  });

  test("nobody in particular, or a run read as root, is counted no private alert", async () => {
    expect(await countsFor(null)).toEqual(NOT_PRIVATE);
    expect(await countsFor(SYSTEM_RUN)).toEqual(NOT_PRIVATE);
  });

  test("an API key that is a member counts the alerts that are not private; one that is an admin, all", async () => {
    expect(await countsFor(apiKey(Permission.ProjectMember))).toEqual(
      NOT_PRIVATE,
    );
    expect(await countsFor(apiKey(Permission.ProjectAdmin))).toEqual(
      EVERY_OPEN,
    );
  });

  test("no alert is ever named, only counted", async () => {
    const answers: Array<DataTableLineageAnswer> =
      await DataTableLineageAnswerer.answer({
        projectId: PROJECT_ID,
        reference: "public.orders",
        depth: 3,
        now: new Date(),
        reader: person(ADMIN, Permission.ProjectAdmin),
      });

    expect(JSON.stringify(answers)).not.toContain(PRIVATE_TITLE);
    expect(JSON.stringify(answers)).not.toContain(PRIVATE_ON_RAW);
  });
});

describe("the table-lineage-answer route, which the MCP server asks", () => {
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

  interface Asked {
    sent: Mock<(...args: Array<unknown>) => unknown>;
    next: Mock<(...args: Array<unknown>) => unknown>;
  }

  // The route's own handler, past the session middleware, from the router the API builds.
  function answerHandler(): RouteHandler {
    const router: ExpressRouter = new DataObservabilityAPI().getRouter();
    const layer: RouterLayer | undefined = (
      router as unknown as { stack: Array<RouterLayer> }
    ).stack.find((candidate: RouterLayer): boolean => {
      return (
        candidate.route?.path ===
          DATA_OBSERVABILITY_API_ROUTES.tableLineageAnswer &&
        candidate.route.methods["post"] === true
      );
    });

    expect(layer?.route?.stack).toHaveLength(3);

    return layer!.route!.stack[2]!.handle;
  }

  async function ask(
    props: DatabaseCommonInteractionProps,
    body: JSONObject,
  ): Promise<Asked> {
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(props);

    const sent: Mock<(...args: Array<unknown>) => unknown> = jest.fn();
    const next: Mock<(...args: Array<unknown>) => unknown> = jest.fn();

    jest
      .spyOn(Response, "sendJsonObjectResponse")
      .mockImplementation(sent as never);

    await answerHandler()(
      { body } as unknown as ExpressRequest,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

    return { sent, next };
  }

  async function answered(
    props: DatabaseCommonInteractionProps,
    body: JSONObject = { table: "public.orders" },
  ): Promise<JSONObject> {
    const asked: Asked = await ask(props, body);

    expect(asked.next).not.toHaveBeenCalled();
    expect(asked.sent).toHaveBeenCalledTimes(1);

    return asked.sent.mock.calls[0]![2] as JSONObject;
  }

  function onlyTable(reply: JSONObject): JSONObject {
    const tables: Array<JSONObject> = reply["tables"] as Array<JSONObject>;

    expect(tables).toHaveLength(1);

    return tables[0]!;
  }

  function errorOf(asked: Asked): Error {
    expect(asked.sent).not.toHaveBeenCalled();
    expect(asked.next).toHaveBeenCalledTimes(1);

    return asked.next.mock.calls[0]![0] as Error;
  }

  test("answers with the lineage in words and as fields, its depth, for a member who owns no private alert", async () => {
    const reply: JSONObject = await answered(OUTSIDER);
    const table: JSONObject = onlyTable(reply);

    expect(reply["depth"]).toBe(3);
    expect(table["dataAssetId"]).toBe(ORDERS);
    expect(table["name"]).toBe("public.orders");
    expect(countsOf(table as unknown as DataTableLineageAnswer)).toEqual(
      NOT_PRIVATE,
    );
    expect(table["answer"]).toBe(
      [
        "public.orders (Orders DB): fresh. Its lineage, 3 steps each way:",
        "Upstream, what it is built from: 1 table, 1 with a problem.",
        "- raw.orders, 1 step up: fresh; 1 open alert.",
        "Downstream, what is built from it: 1 table, none with a problem.",
        "Nearest first: marts.revenue (1 step down, fresh).",
      ].join("\n"),
    );
  });

  test.each([...OWNERS, ...ADMINS])(
    "counts the private alerts for %s",
    async (_who: string, props: DatabaseCommonInteractionProps) => {
      const table: JSONObject = onlyTable(await answered(props));

      expect(countsOf(table as unknown as DataTableLineageAnswer)).toEqual(
        EVERY_OPEN,
      );
      expect(table["answer"]).toBe(
        [
          "public.orders (Orders DB): fresh; 1 open alert. Its lineage, 3 steps each way:",
          "Upstream, what it is built from: 1 table, 1 with a problem.",
          "- raw.orders, 1 step up: fresh; 2 open alerts.",
          "Downstream, what is built from it: 1 table, 1 with a problem.",
          "- marts.revenue, 1 step down: fresh; 1 open alert.",
        ].join("\n"),
      );
    },
  );

  test("lets in a project API key - what the MCP server signs in with - and counts its alerts as the key may see them", async () => {
    const member: JSONObject = onlyTable(
      await answered(apiKey(Permission.ProjectMember)),
    );
    const admin: JSONObject = onlyTable(
      await answered(apiKey(Permission.ProjectAdmin)),
    );

    expect(countsOf(member as unknown as DataTableLineageAnswer)).toEqual(
      NOT_PRIVATE,
    );
    expect(countsOf(admin as unknown as DataTableLineageAnswer)).toEqual(
      EVERY_OPEN,
    );
  });

  test.each([
    [undefined, 3],
    [1, 1],
    ["5", 5],
    [99, 5],
    [0, 1],
    ["lots", 3],
  ])(
    "asked for %p steps, walks and says %p",
    async (depth: unknown, walked: number) => {
      const reply: JSONObject = await answered(OUTSIDER, {
        table: "public.orders",
        ...(depth === undefined ? {} : { depth: depth as number }),
      });

      expect(reply["depth"]).toBe(walked);
      expect(onlyTable(reply)["depth"]).toBe(walked);
    },
  );

  test("a name several databases share answers with each", async () => {
    const reply: JSONObject = await answered(OUTSIDER, { table: "orders" });
    const tables: Array<JSONObject> = reply["tables"] as Array<JSONObject>;

    expect(
      tables.map((table: JSONObject): unknown => {
        return table["dataAssetId"];
      }),
    ).toEqual([ORDERS, ARCHIVED_ORDERS]);
    expect(String(tables[1]!["answer"])).toBe(
      [
        "archive.orders (Archive DB): fresh. Its lineage, 3 steps each way:",
        "Upstream: no watched table is seen feeding it.",
        "Downstream: no watched table is seen built from it.",
      ].join("\n"),
    );
  });

  test("a table named by its ID is found by it", async () => {
    const table: JSONObject = onlyTable(
      await answered(OUTSIDER, { table: RAW }),
    );

    expect(table["name"]).toBe("raw.orders");
  });

  test("a name no watched table has: no tables", async () => {
    expect((await answered(OUTSIDER, { table: "nope" }))["tables"]).toEqual([]);
  });

  test.each([[{}], [{ table: "   " }], [{ table: 42 }]])(
    "refuses a table not named: %p",
    async (body: JSONObject) => {
      const error: Error = errorOf(await ask(OUTSIDER, body));

      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toBe(
        "Name the table: its schema.table key, its name, or its ID.",
      );
      expect(tableReads).not.toHaveBeenCalled();
    },
  );

  test("refuses someone who may not read data assets, before anything is read", async () => {
    const error: Error = errorOf(
      await ask(person(MEMBER, Permission.CreateDataAsset), {
        table: "public.orders",
      }),
    );

    expect(error.message).toBe(
      "You do not have permission to do this in Data Observability.",
    );
    expect(tableReads).not.toHaveBeenCalled();
  });
});

describe("the get_data_table_lineage tool, as Ask AI, Slack and Microsoft Teams run it", () => {
  /*
   * Through the toolbox, as each of them calls it: Ask AI and an
   * investigation's thread with the person's session, Slack and Microsoft
   * Teams with the props of the person whose account is linked, and an AI
   * run of OneUptime's own as root.
   */
  async function run(
    props: DatabaseCommonInteractionProps,
    args: JSONObject = { table: "public.orders" },
  ): Promise<ToolCallOutcome> {
    return await AIToolbox.executeTool({
      name: "get_data_table_lineage",
      args,
      ctx: { projectId: PROJECT_ID, props: props },
    });
  }

  async function askTool(
    props: DatabaseCommonInteractionProps,
    args?: JSONObject,
  ): Promise<string> {
    const outcome: ToolCallOutcome = await run(props, args);

    expect(outcome.success).toBe(true);

    return outcome.textForLlm;
  }

  test("a private alert is not counted for a member who does not own it", async () => {
    const text: string = await askTool(OUTSIDER);

    expect(text).toContain("public.orders (Orders DB): fresh. Its lineage");
    expect(text).toContain("- raw.orders, 1 step up: fresh; 1 open alert.");
    expect(text).toContain(
      "Nearest first: marts.revenue (1 step down, fresh).",
    );
    expect(text).not.toContain(PRIVATE_TITLE);
  });

  test.each([...OWNERS, ...ADMINS])(
    "and counted for %s",
    async (_who: string, props: DatabaseCommonInteractionProps) => {
      const text: string = await askTool(props);

      expect(text).toContain("public.orders (Orders DB): fresh; 1 open alert.");
      expect(text).toContain("- raw.orders, 1 step up: fresh; 2 open alerts.");
      expect(text).toContain(
        "- marts.revenue, 1 step down: fresh; 1 open alert.",
      );
      expect(text).not.toContain(PRIVATE_TITLE);
    },
  );

  test("someone who may read data assets, not alerts, is counted the alerts that are not private", async () => {
    expect(
      await askTool(person(DATA_READER, Permission.ReadDataAsset)),
    ).toContain("- raw.orders, 1 step up: fresh; 1 open alert.");
  });

  test("a run of OneUptime's own, whose report everyone who may see its subject reads, is counted no private alert", async () => {
    const text: string = await askTool(SYSTEM_RUN);

    expect(text).toContain("public.orders (Orders DB): fresh. Its lineage");
    expect(text).toContain("- raw.orders, 1 step up: fresh; 1 open alert.");
  });

  test("cites the table's Lineage tab, by its name", async () => {
    const outcome: ToolCallOutcome = await run(OUTSIDER);

    expect(outcome.result?.citationLabel).toBe("Lineage of public.orders");
    expect(outcome.result?.citationTarget).toEqual({
      type: AIChatCitationTargetType.DataTableLineageView,
      params: { dataAssetId: ORDERS },
    });
    expect(outcome.result?.rowCount).toBe(1);
  });

  test("a name several databases share: how many, then each, and no one page to cite", async () => {
    const outcome: ToolCallOutcome = await run(OUTSIDER, { table: "orders" });

    expect(outcome.success).toBe(true);
    expect(outcome.textForLlm).toContain(
      '2 watched tables are called "orders". The lineage of each:',
    );
    expect(outcome.textForLlm).toContain(
      "archive.orders (Archive DB): fresh. Its lineage",
    );
    expect(outcome.result?.citationLabel).toBe(
      'Lineage of tables called "orders" - 2 found',
    );
    expect(outcome.result?.citationTarget).toBeUndefined();
  });

  test("the steps asked for, up to five", async () => {
    expect(
      await askTool(OUTSIDER, { table: "public.orders", depth: 1 }),
    ).toContain("Its lineage, 1 step each way:");
    expect(
      await askTool(OUTSIDER, { table: "public.orders", depth: 50 }),
    ).toContain("Its lineage, 5 steps each way:");
  });

  test("a name no watched table has: says so, and where the watched tables are", async () => {
    expect(await askTool(OUTSIDER, { table: "nope" })).toContain(
      'No table Data Observability watches is called "nope".',
    );
  });

  test("no table named: an error the model can correct", async () => {
    const outcome: ToolCallOutcome = await run(OUTSIDER, {});

    expect(outcome.success).toBe(false);
    expect(outcome.errorMessage).toContain("table is required");
    expect(tableReads).not.toHaveBeenCalled();
  });

  test("refused to someone who may not read data assets, before anything is read", async () => {
    const outcome: ToolCallOutcome = await run(
      person(MEMBER, Permission.CreateDataAsset),
    );

    expect(outcome.success).toBe(false);
    expect(outcome.refusal).toBeDefined();
    expect(tableReads).not.toHaveBeenCalled();
  });
});
