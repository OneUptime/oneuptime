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
import DataAssetUsageService from "../../../../Server/Services/DataAssetUsageService";
import DataProductService from "../../../../Server/Services/DataProductService";
import AIToolbox, {
  ToolCallOutcome,
} from "../../../../Server/Utils/AI/Toolbox/Index";
import DataTableDashboards from "../../../../Server/Utils/DataObservability/Bi/DataTableDashboards";
import DataAlertContext from "../../../../Server/Utils/DataObservability/DataAlertContext";
import DataTableAnswerer, {
  DataTableAnswer,
} from "../../../../Server/Utils/DataObservability/DataTableAnswer";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../../../../Server/Utils/Express";
import Response from "../../../../Server/Utils/Response";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertState from "../../../../Models/DatabaseModels/AlertState";
import DataAlert from "../../../../Models/DatabaseModels/DataAlert";
import DataAsset from "../../../../Models/DatabaseModels/DataAsset";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DataAssetKind from "../../../../Types/DataObservability/DataAssetKind";
import { DATA_OBSERVABILITY_API_ROUTES } from "../../../../Types/DataObservability/DataObservabilityApiTypes";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import UserType from "../../../../Types/UserType";
import {
  StoredRow,
  rowMatchesWhere,
} from "../../TestingUtils/InMemoryRepository";

/*
 * A TABLE'S ANSWER NAMES ONLY THE ALERTS ITS READER MAY SEE.
 *
 * "Is this table fresh?" names the table's open alerts by number and title.
 * A private alert is seen only by its owners - directly, or through a team
 * - and by the project's owners and admins (Utils/Alert/AlertPrivacyFilter).
 * The answer read the alerts as OneUptime, so the table-freshness route and
 * the tool that Ask AI, Slack, Microsoft Teams and the MCP server answer with
 * told anyone who may read data assets a private alert's number and title.
 * Each path reads them with its reader's privacy clause now:
 *
 *   - the route (what the MCP server asks) and the tool (Ask AI, an
 *     investigation's thread, Slack and Microsoft Teams, each for the person
 *     who asked): the alerts that person may see;
 *   - the tool in a run of OneUptime's own, read as root, and an alert
 *     investigation's context (DataAlertContext), which nobody in
 *     particular reads: the alerts that are not private.
 *
 * The alerts are rows in memory, and the privacy clause is read as Postgres
 * reads it, with this file's owners (passesPrivacyClause).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const ASSET_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const NOW: Date = new Date("2026-11-04T12:00:00.000Z");

const CREATED: string = "33333333-3333-4333-8333-000000000001";
const RESOLVED: string = "33333333-3333-4333-8333-000000000002";

const PUBLIC_ALERT: string = "44444444-4444-4444-8444-000000000001";
const PRIVATE_ALERT: string = "44444444-4444-4444-8444-000000000002";
// The alert upstream that the public alert is a consequence of.
const CAUSE_ALERT: string = "44444444-4444-4444-8444-000000000003";

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

// Who owns the private alert: one person, and the members of one team.
const DIRECT_OWNERS: Record<string, Array<string>> = {
  [PRIVATE_ALERT]: [OWNER.toString()],
};
const TEAM_OWNERS: Record<string, Array<string>> = {
  [PRIVATE_ALERT]: [TEAM_MEMBER.toString()],
};

const STATES: Array<AlertState> = [
  [CREATED, "Created", 1],
  [RESOLVED, "Resolved", 2],
].map(([id, name, order]: Array<string | number>): AlertState => {
  const alertState: AlertState = new AlertState();
  alertState._id = String(id);
  alertState.name = String(name);
  alertState.order = Number(order);
  alertState.isCreatedState = id === CREATED;
  alertState.isAcknowledgedState = false;
  alertState.isResolvedState = id === RESOLVED;

  return alertState;
});

// The table's open alerts, newest first: one private, one not.
const ALERTS: Array<StoredRow> = [
  [PRIVATE_ALERT, "ALT-2", PRIVATE_TITLE, true],
  [PUBLIC_ALERT, "ALT-1", "orders is late", false],
].map(([id, number, title, isPrivate]: Array<string | boolean>): StoredRow => {
  return {
    _id: id,
    projectId: PROJECT_ID.toString(),
    title: title,
    alertNumberWithPrefix: number,
    isPrivate: isPrivate,
    currentAlertStateId: CREATED,
    currentAlertState: { name: "Created", isResolvedState: false },
  };
});

function toAlert(row: StoredRow): Alert {
  const alert: Alert = new Alert();

  for (const [column, value] of Object.entries(row)) {
    (alert as unknown as StoredRow)[column] = value;
  }

  return alert;
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

// A person of the project with one permission, as a signed-in request makes them.
function person(
  userId: ObjectID,
  permission: Permission,
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
  };
}

const OUTSIDER: DatabaseCommonInteractionProps = person(
  MEMBER,
  Permission.ProjectMember,
);
const OWNERS: Array<[string, DatabaseCommonInteractionProps]> = [
  ["its owner", person(OWNER, Permission.ProjectMember)],
  [
    "a member of the team that owns it",
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

function stubTable(): void {
  const asset: DataAsset = new DataAsset();
  asset._id = ASSET_ID.toString();
  asset.assetKey = "public.orders";
  asset.dataStoreName = "Orders DB";
  asset.assetKind = DataAssetKind.Table;
  asset.lastChangedAt = new Date("2026-11-04T09:00:00.000Z");
  asset.updateIntervalInSeconds = 900;
  asset.isDropped = false;

  jest.spyOn(DataAssetService, "findOneBy").mockResolvedValue(asset as never);
  // The route and the tool find the table by its key.
  jest.spyOn(DataAssetService, "findBy").mockResolvedValue([asset] as never);
  jest.spyOn(DataAlertService, "findBy").mockResolvedValue(
    [PUBLIC_ALERT, PRIVATE_ALERT].map((id: string): DataAlert => {
      const row: DataAlert = new DataAlert();
      row.alertId = new ObjectID(id);

      return row;
    }) as never,
  );
  jest.spyOn(DataAssetLineageService, "findBy").mockResolvedValue([] as never);
  jest.spyOn(DataAssetUsageService, "findBy").mockResolvedValue([] as never);
  jest.spyOn(DataProductService, "findBy").mockResolvedValue([] as never);
  jest.spyOn(DataTableDashboards, "find").mockResolvedValue([] as never);
  jest
    .spyOn(AlertStateService, "getAllAlertStates")
    .mockResolvedValue(STATES as never);

  alertReads = [];

  // The alerts the query names, as the database reads it.
  jest.spyOn(AlertService, "findBy").mockImplementation((async (findBy: {
    query: Record<string, unknown>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<Alert>> => {
    alertReads.push(findBy);

    const { isPrivate, ...rest } = findBy.query;

    return ALERTS.filter((row: StoredRow): boolean => {
      return rowMatchesWhere(row, rest) && passesPrivacyClause(isPrivate, row);
    }).map(toAlert);
  }) as never);
}

async function openAlertNumbers(
  reader: DatabaseCommonInteractionProps | null,
): Promise<Array<string | null>> {
  const answer: DataTableAnswer | null = await DataTableAnswerer.answer(
    PROJECT_ID,
    ASSET_ID,
    NOW,
    reader,
  );

  expect(answer).not.toBeNull();

  return answer!.openAlerts.map(
    (alert: DataTableAnswer["openAlerts"][number]): string | null => {
      return alert.number;
    },
  );
}

beforeEach(() => {
  jest.restoreAllMocks();
  stubTable();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a table's answer, by who reads it", () => {
  test("a private alert is left out for a member who does not own it", async () => {
    expect(await openAlertNumbers(OUTSIDER)).toEqual(["ALT-1"]);
  });

  test.each(OWNERS)(
    "and shown to %s",
    async (_who: string, props: DatabaseCommonInteractionProps) => {
      expect(await openAlertNumbers(props)).toEqual(["ALT-2", "ALT-1"]);
    },
  );

  test.each(ADMINS)(
    "and to %s, who sees every private alert",
    async (_who: string, props: DatabaseCommonInteractionProps) => {
      expect(await openAlertNumbers(props)).toEqual(["ALT-2", "ALT-1"]);
    },
  );

  test("someone who may read data assets, not alerts, is told the alerts that are not private", async () => {
    expect(
      await openAlertNumbers(person(DATA_READER, Permission.ReadDataAsset)),
    ).toEqual(["ALT-1"]);

    // Read as OneUptime with their clause: the alert table's own rules would refuse them.
    expect(alertReads).toHaveLength(1);
    expect(alertReads[0]!.props.isRoot).toBe(true);
    expect(alertReads[0]!.query["isPrivate"]).toBeInstanceOf(FindOperator);
  });

  test("nobody in particular, or a run read as root, is told no private alert", async () => {
    expect(await openAlertNumbers(null)).toEqual(["ALT-1"]);
    expect(await openAlertNumbers(SYSTEM_RUN)).toEqual(["ALT-1"]);
  });
});

describe("the table-freshness route, which the MCP server asks", () => {
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

  // The route's own handler, past the session middleware, from the router the API builds.
  function freshnessHandler(): RouteHandler {
    const router: ExpressRouter = new DataObservabilityAPI().getRouter();
    const layer: RouterLayer | undefined = (
      router as unknown as { stack: Array<RouterLayer> }
    ).stack.find((candidate: RouterLayer): boolean => {
      return (
        candidate.route?.path ===
          DATA_OBSERVABILITY_API_ROUTES.tableFreshness &&
        candidate.route.methods["post"] === true
      );
    });

    expect(layer?.route?.stack).toHaveLength(3);

    return layer!.route!.stack[2]!.handle;
  }

  async function askRoute(
    props: DatabaseCommonInteractionProps,
  ): Promise<JSONObject> {
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(props);

    const sent: Mock<(...args: Array<unknown>) => unknown> = jest.fn();
    const next: Mock<(...args: Array<unknown>) => unknown> = jest.fn();

    jest
      .spyOn(Response, "sendJsonObjectResponse")
      .mockImplementation(sent as never);

    await freshnessHandler()(
      { body: { table: "public.orders" } } as unknown as ExpressRequest,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

    expect(next).not.toHaveBeenCalled();
    expect(sent).toHaveBeenCalledTimes(1);

    const tables: Array<JSONObject> = (sent.mock.calls[0]![2] as JSONObject)[
      "tables"
    ] as Array<JSONObject>;

    expect(tables).toHaveLength(1);

    return tables[0]!;
  }

  function numbersOf(table: JSONObject): Array<unknown> {
    return (table["openAlerts"] as Array<JSONObject>).map(
      (alert: JSONObject): unknown => {
        return alert["number"];
      },
    );
  }

  test("a private alert is left out for a member who does not own it", async () => {
    const table: JSONObject = await askRoute(OUTSIDER);

    expect(numbersOf(table)).toEqual(["ALT-1"]);
    expect(String(table["answer"])).not.toContain(PRIVATE_TITLE);
    expect(String(table["answer"])).toContain("ALT-1 orders is late");
  });

  test.each(OWNERS)(
    "and shown to %s",
    async (_who: string, props: DatabaseCommonInteractionProps) => {
      const table: JSONObject = await askRoute(props);

      expect(numbersOf(table)).toEqual(["ALT-2", "ALT-1"]);
      expect(String(table["answer"])).toContain(`ALT-2 ${PRIVATE_TITLE}`);
    },
  );

  test.each(ADMINS)(
    "and to %s",
    async (_who: string, props: DatabaseCommonInteractionProps) => {
      expect(numbersOf(await askRoute(props))).toEqual(["ALT-2", "ALT-1"]);
    },
  );
});

describe("the get_data_table_freshness tool, as Ask AI, Slack and Microsoft Teams run it", () => {
  /*
   * Through the toolbox, as each of them calls it: Ask AI and an
   * investigation's thread with the person's session, Slack and Microsoft
   * Teams with the props of the person whose account is linked
   * (WorkspaceActionAuthorization.getProjectMemberProps), and an AI run of
   * OneUptime's own as root.
   */
  async function askTool(
    props: DatabaseCommonInteractionProps,
  ): Promise<string> {
    const outcome: ToolCallOutcome = await AIToolbox.executeTool({
      name: "get_data_table_freshness",
      args: { table: "public.orders" },
      ctx: { projectId: PROJECT_ID, props: props },
    });

    expect(outcome.success).toBe(true);

    return outcome.textForLlm;
  }

  test("a private alert is left out for a member who does not own it", async () => {
    const text: string = await askTool(OUTSIDER);

    expect(text).toContain("ALT-1 orders is late");
    expect(text).not.toContain(PRIVATE_TITLE);
    expect(text).not.toContain("ALT-2");
  });

  test.each(OWNERS)(
    "and shown to %s",
    async (_who: string, props: DatabaseCommonInteractionProps) => {
      expect(await askTool(props)).toContain(`ALT-2 ${PRIVATE_TITLE}`);
    },
  );

  test.each(ADMINS)(
    "and to %s",
    async (_who: string, props: DatabaseCommonInteractionProps) => {
      expect(await askTool(props)).toContain(`ALT-2 ${PRIVATE_TITLE}`);
    },
  );

  test("a run of OneUptime's own, whose report everyone who may see its subject reads, is told no private alert", async () => {
    const text: string = await askTool(SYSTEM_RUN);

    expect(text).toContain("ALT-1 orders is late");
    expect(text).not.toContain(PRIVATE_TITLE);
  });
});

describe("an alert investigation's context, which nobody in particular reads", () => {
  // The public alert, a data alert on the table, caused upstream by CAUSE_ALERT.
  async function contextOf(cause: { isPrivate: boolean }): Promise<string> {
    const dataAlert: DataAlert = new DataAlert();
    dataAlert.dataAssetId = ASSET_ID;
    dataAlert.causeAlertId = new ObjectID(CAUSE_ALERT);

    jest
      .spyOn(DataAlertService, "findOneBy")
      .mockResolvedValue(dataAlert as never);
    jest.spyOn(AlertService, "findOneBy").mockImplementation((async (findBy: {
      query: { _id: ObjectID };
    }): Promise<Alert> => {
      return toAlert(
        findBy.query._id.toString() === CAUSE_ALERT
          ? {
              _id: CAUSE_ALERT,
              title: "warehouse load failed",
              alertNumberWithPrefix: "ALT-3",
              isPrivate: cause.isPrivate,
              createdAt: new Date("2026-11-04T10:00:00.000Z"),
              currentAlertState: { name: "Created" },
            }
          : {
              _id: PUBLIC_ALERT,
              createdAt: new Date("2026-11-04T11:00:00.000Z"),
            },
      );
    }) as never);

    return await DataAlertContext.buildContextSection({
      projectId: PROJECT_ID,
      alertId: new ObjectID(PUBLIC_ALERT),
      now: NOW,
    });
  }

  test("the table's private alert is never named, the others are", async () => {
    const section: string = await contextOf({ isPrivate: false });

    expect(section).toContain("Open alerts: ALT-1 orders is late (Created).");
    expect(section).not.toContain(PRIVATE_TITLE);
    expect(section).not.toContain("ALT-2");
  });

  test("a private cause is never named: only that a private alert is open upstream", async () => {
    const section: string = await contextOf({ isPrivate: true });

    expect(section).toContain(
      "This alert is a consequence of a private alert, open on what this table is built from.",
    );
    expect(section).not.toContain("warehouse load failed");
    expect(section).not.toContain("ALT-3");
  });

  test("a cause that is not private is named, to investigate first", async () => {
    expect(await contextOf({ isPrivate: false })).toContain(
      'This alert is a consequence of ALT-3 "warehouse load failed" (Created)',
    );
  });
});
