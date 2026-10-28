import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHAT SECURITY EVENTS SAYS ABOUT A RECORD, AND WHAT A CASE OR AN EVENT NAMES,
 * FROM THE EVENTS OF THE SOURCES THE CALLER MAY READ:
 *
 *   POST /security-case/resource-security  a record page's Security card:
 *                                          how many events and findings
 *                                          named it, or were read from its
 *                                          logs (countEventsNaming)
 *   POST /security-case/connections        Connected Signals: the records
 *                                          the logs behind a case's or an
 *                                          entity's events were sent under
 *                                          (findLogResourcesNaming)
 *
 * Both reads build their own ClickHouse SQL, so nothing downstream narrows
 * it to the caller. A security event belongs to the source it came from
 * (its primaryEntityId), and a Security role may be scoped to the sources it
 * owns or to some labels, or blocked from the sources carrying some labels;
 * such a reader's counts and connections come from those sources' events,
 * never every source's. Each route runs through its real handler, the real
 * connection readers and the real read scope (ModelPermission.getReadScope);
 * the records the cards are about, the owner and label lookups behind the
 * scope, and ClickHouse itself are answered here. The SQL each route sends
 * is what is checked.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEmptySuccessResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      sendEntityResponse: jest.fn(),
      sendEntityArrayResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Logger");

import CommonAPI from "../../../Server/API/CommonAPI";
import SecurityCaseAPI from "../../../Server/API/SecurityCaseAPI";
import { Results } from "../../../Server/Services/AnalyticsDatabaseService";
import HostService from "../../../Server/Services/HostService";
import SecurityCaseService from "../../../Server/Services/SecurityCaseService";
import SecurityEntityRiskService from "../../../Server/Services/SecurityEntityRiskService";
import SecurityEventService from "../../../Server/Services/SecurityEventService";
import ServiceService from "../../../Server/Services/ServiceService";
import OwnerTableRegistry from "../../../Server/Types/Database/Permissions/OwnerTableRegistry";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import SecurityCaseValues from "../../../Server/Utils/SecurityCase/SecurityCaseValues";
import SecurityConnectedRecords from "../../../Server/Utils/SecurityEvent/Connections/SecurityConnectedRecords";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import { SecurityConnectionKind } from "../../../Types/SecurityCase/SecurityConnection";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import UserType from "../../../Types/UserType";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";

type MockedFn = ReturnType<typeof jest.fn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "4e8b2d17-6a3c-4f90-b5d2-1c7e9a0f3b01",
);
/*
 * The source the caller owns, the one carrying label A, the one carrying
 * label B, and one of neither.
 */
const OWNED_SOURCE: ObjectID = new ObjectID(
  "4e8b2d17-6a3c-4f90-b5d2-1c7e9a0f3b02",
);
const LABELLED_SOURCE: ObjectID = new ObjectID(
  "4e8b2d17-6a3c-4f90-b5d2-1c7e9a0f3b03",
);
const BLOCKED_SOURCE: ObjectID = new ObjectID(
  "4e8b2d17-6a3c-4f90-b5d2-1c7e9a0f3b04",
);
const OTHER_SOURCE: ObjectID = new ObjectID(
  "4e8b2d17-6a3c-4f90-b5d2-1c7e9a0f3b05",
);
const LABEL_A: ObjectID = new ObjectID("4e8b2d17-6a3c-4f90-b5d2-1c7e9a0f3b06");
const LABEL_B: ObjectID = new ObjectID("4e8b2d17-6a3c-4f90-b5d2-1c7e9a0f3b07");
// The records the cards are about.
const HOST_ID: ObjectID = new ObjectID("4e8b2d17-6a3c-4f90-b5d2-1c7e9a0f3b08");
const SERVICE_ID: ObjectID = new ObjectID(
  "4e8b2d17-6a3c-4f90-b5d2-1c7e9a0f3b09",
);
const CASE_ID: ObjectID = new ObjectID("4e8b2d17-6a3c-4f90-b5d2-1c7e9a0f3b0a");

type Route =
  | "resource-security, a host"
  | "resource-security, a service"
  | "connections, a case"
  | "connections, an entity";

const ROUTES: Record<Route, { uri: string; body: JSONObject }> = {
  "resource-security, a host": {
    uri: "/security-case/resource-security",
    body: { kind: SecurityConnectionKind.Host, id: HOST_ID.toString() },
  },
  // Searched for by the events read from its logs.
  "resource-security, a service": {
    uri: "/security-case/resource-security",
    body: { kind: SecurityConnectionKind.Service, id: SERVICE_ID.toString() },
  },
  "connections, a case": {
    uri: "/security-case/connections",
    body: { caseId: CASE_ID.toString() },
  },
  // An entity's page: the logs behind its events are read too.
  "connections, an entity": {
    uri: "/security-case/connections",
    body: {
      entities: [{ type: SecurityEntityType.Host, value: "web-1" }],
      readLogResources: true,
    },
  },
};

interface Row {
  scope?: PermissionScope | undefined;
  labelIds?: Array<ObjectID> | undefined;
  isBlockPermission?: boolean | undefined;
}

// A signed-in member of the project holding Security Viewer by exactly these rows.
function securityViewer(rows: Array<Row>): DatabaseCommonInteractionProps {
  return {
    userId: ObjectID.generate(),
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: rows.map((row: Row): UserPermission => {
          return {
            _type: "UserPermission",
            permission: Permission.SecurityViewer,
            labelIds: row.labelIds || [],
            isBlockPermission: row.isBlockPermission || false,
            scope: row.scope,
          };
        }),
      },
    },
    ...ON_HIGHEST_PLAN,
  };
}

let props: DatabaseCommonInteractionProps;
let executeQuery: MockedFn;

const sendJsonObjectResponseMock: MockedFn =
  Response.sendJsonObjectResponse as unknown as MockedFn;

// Who owns which source, and which carries which label.
function stubScopeLookups(): void {
  for (const [name, entry] of OwnerTableRegistry.entries()) {
    if (!entry.canOwnTelemetry || !entry.modelService) {
      continue;
    }

    const isService: boolean = name === "Service";

    jest
      .spyOn(entry.ownerUserService, "findBy")
      .mockResolvedValue(
        isService
          ? ([{ [entry.fkColumn]: OWNED_SOURCE }] as never)
          : ([] as never),
      );
    jest.spyOn(entry.ownerTeamService, "findBy").mockResolvedValue([] as never);
    jest
      .spyOn(entry.modelService, "findBy")
      .mockImplementation((async (request: {
        query: Record<string, unknown>;
      }) => {
        if (!isService) {
          return [];
        }

        const labelIds: Array<string> = (
          (request.query["labels"] as Array<ObjectID>) || []
        ).map((id: ObjectID): string => {
          return id.toString();
        });
        const sources: Array<{ _id: string }> = [];

        if (labelIds.includes(LABEL_A.toString())) {
          sources.push({ _id: LABELLED_SOURCE.toString() });
        }

        if (labelIds.includes(LABEL_B.toString())) {
          sources.push({ _id: BLOCKED_SOURCE.toString() });
        }

        return sources;
      }) as never);
  }
}

// The records the cards are about, as the caller reads them, and what else they read.
function stubRecords(): void {
  jest.spyOn(HostService, "findOneBy").mockResolvedValue({
    id: HOST_ID,
    name: "Web One",
    hostIdentifier: "web-1",
    // A private address: kept without asking who else holds it.
    hostIpAddresses: "10.0.0.5",
  } as never);
  jest.spyOn(ServiceService, "findOneBy").mockResolvedValue({
    id: SERVICE_ID,
    name: "checkout",
  } as never);
  jest.spyOn(SecurityCaseValues, "getOpenStatusIds").mockResolvedValue([]);
  jest.spyOn(SecurityEntityRiskService, "findBy").mockResolvedValue([]);
  jest.spyOn(SecurityCaseService, "findOneBy").mockResolvedValue({
    id: CASE_ID,
    _id: CASE_ID.toString(),
    projectId: PROJECT_ID,
    entities: [
      { type: SecurityEntityType.Host, value: "web-1" },
      { type: SecurityEntityType.IpAddress, value: "203.0.113.7" },
    ],
    firstDetectedAt: new Date("2026-10-25T09:00:00.000Z"),
    lastDetectedAt: new Date("2026-10-25T10:00:00.000Z"),
    createdAt: new Date("2026-10-25T09:00:00.000Z"),
  } as never);
  jest.spyOn(SecurityConnectedRecords, "resolve").mockResolvedValue({
    records: [],
    unmatched: [],
    unreadableKinds: [],
    failedKinds: [],
  });
}

// Every security-event read the route sent, in order.
async function read(route: Route): Promise<Array<Statement>> {
  const req: ExpressRequest = {
    params: {},
    query: {},
    headers: {},
    body: ROUTES[route].body,
  } as unknown as ExpressRequest;
  const next: MockedFn = jest.fn();

  executeQuery.mockClear();
  sendJsonObjectResponseMock.mockClear();

  await mockRouter
    .match("post", ROUTES[route].uri)
    .handlerFunction(
      req,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

  expect(next).not.toHaveBeenCalled();
  expect(sendJsonObjectResponseMock).toHaveBeenCalledTimes(1);

  return executeQuery.mock.calls.map((call: Array<unknown>): Statement => {
    return call[0] as Statement;
  });
}

// The read that counts or lists events: the card's figures, or the logs behind them.
function eventRead(statements: Array<Statement>): Statement {
  const reads: Array<Statement> = statements.filter(
    (statement: Statement): boolean => {
      return statement.query.includes("count() AS eventCount");
    },
  );

  expect(reads).toHaveLength(1);

  return reads[0]!;
}

// Its conditions: before the rows are grouped, and before its settings.
function conditionsOf(statement: Statement): string {
  return statement.query.split(" GROUP BY ")[0]!.split(" SETTINGS ")[0]!;
}

// The source ids the read binds, as text.
function boundSourceIds(statement: Statement): Array<string> {
  return Object.values(statement.query_params)
    .filter((value: unknown): boolean => {
      return Array.isArray(value);
    })
    .flat()
    .map((value: unknown): string => {
      return String(value).toLowerCase();
    })
    .filter((value: string): boolean => {
      return [
        OWNED_SOURCE,
        LABELLED_SOURCE,
        BLOCKED_SOURCE,
        OTHER_SOURCE,
        PROJECT_ID,
      ]
        .map((id: ObjectID): string => {
          return id.toString().toLowerCase();
        })
        .includes(value);
    })
    .sort();
}

function sorted(...ids: Array<ObjectID>): Array<string> {
  return ids
    .map((id: ObjectID): string => {
      return id.toString().toLowerCase();
    })
    .sort();
}

beforeAll(() => {
  mockRouter.routes.length = 0;
  new SecurityCaseAPI();
});

beforeEach(() => {
  jest.clearAllMocks();

  stubScopeLookups();
  stubRecords();

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return props;
    });

  jest
    .spyOn(SecurityEventService.database, "getDatasourceOptions")
    .mockReturnValue({ database: "oneuptime" } as never);

  // The project has security events this week, none naming the record.
  const result: Results = {
    json: (): Promise<unknown> => {
      return Promise.resolve({ data: [{ found: 1 }] });
    },
  } as unknown as Results;

  executeQuery = jest
    .spyOn(SecurityEventService, "executeQuery")
    .mockResolvedValue(result as never) as unknown as MockedFn;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(Object.keys(ROUTES) as Array<Route>)(
  "POST %s",
  (route: Route) => {
    test("a Security Viewer over the whole project reads every source's events", async () => {
      props = securityViewer([{ scope: PermissionScope.All }]);

      const statement: Statement = eventRead(await read(route));

      expect(statement.query).not.toContain("primaryEntityId");
    });

    test("a Security Viewer scoped to owned sources reads the source they own and the project's unattributed events, no other", async () => {
      props = securityViewer([{ scope: PermissionScope.Owned }]);

      const statement: Statement = eventRead(await read(route));

      expect(conditionsOf(statement)).toContain(" AND primaryEntityId IN (");
      expect(boundSourceIds(statement)).toEqual(
        sorted(OWNED_SOURCE, PROJECT_ID),
      );
    });

    test("a Security Viewer limited to label A reads the source carrying it, no other", async () => {
      props = securityViewer([
        { scope: PermissionScope.Labels, labelIds: [LABEL_A] },
      ]);

      const statement: Statement = eventRead(await read(route));

      expect(conditionsOf(statement)).toContain(" AND primaryEntityId IN (");
      expect(boundSourceIds(statement)).toEqual(sorted(LABELLED_SOURCE));
    });

    test("a Security Viewer over the whole project, blocked from label B, reads every source but the one carrying it", async () => {
      props = securityViewer([
        { scope: PermissionScope.All },
        { labelIds: [LABEL_B], isBlockPermission: true },
      ]);

      const statement: Statement = eventRead(await read(route));

      expect(conditionsOf(statement)).toContain(
        " AND primaryEntityId NOT IN (",
      );
      expect(conditionsOf(statement)).not.toContain(
        " AND primaryEntityId IN (",
      );
      expect(boundSourceIds(statement)).toEqual(sorted(BLOCKED_SOURCE));
    });
  },
);

describe("a record's Security card", () => {
  test("asks whether the project uses Security Events at all of every source, whatever the reader's sources: it counts nobody's events", async () => {
    props = securityViewer([{ scope: PermissionScope.Owned }]);

    const statements: Array<Statement> = await read(
      "resource-security, a host",
    );
    const inUse: Array<Statement> = statements.filter(
      (statement: Statement): boolean => {
        return statement.query.includes("SELECT 1 AS found");
      },
    );

    expect(inUse).toHaveLength(1);
    expect(inUse[0]!.query).not.toContain("primaryEntityId");
    expect(eventRead(statements).query).toContain(" AND primaryEntityId IN (");
  });
});
