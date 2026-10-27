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
 * THE ENTITY READS OF SECURITY EVENTS FOLLOW THE CALLER'S READ SCOPE:
 *
 *   POST /security-case/entity-activity  how active some values have been
 *   POST /security-case/top-entities     the values the findings name most
 *
 * Both build their own ClickHouse SQL, so nothing downstream narrows it to
 * the caller. A security event belongs to the source it came from (its
 * primaryEntityId), and a Security role may be scoped to the sources it
 * owns or to some labels; such a reader gets the users, hosts and addresses
 * of those sources' events, never every source's. Each route runs through
 * its real handler and the real read scope (ModelPermission.getReadScope);
 * only the owner and label lookups behind the scope, and ClickHouse itself,
 * are answered here. The SQL each route sends is what is checked.
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
import SecurityEventService from "../../../Server/Services/SecurityEventService";
import OwnerTableRegistry from "../../../Server/Types/Database/Permissions/OwnerTableRegistry";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";

type MockedFn = ReturnType<typeof jest.fn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "7c4e2a90-1b3d-4f5e-8a6c-0d9e8f7a6b01",
);
// The source the caller owns, the one carrying label A, and one of neither.
const OWNED_SOURCE: ObjectID = new ObjectID(
  "7c4e2a90-1b3d-4f5e-8a6c-0d9e8f7a6b02",
);
const LABELLED_SOURCE: ObjectID = new ObjectID(
  "7c4e2a90-1b3d-4f5e-8a6c-0d9e8f7a6b03",
);
const OTHER_SOURCE: ObjectID = new ObjectID(
  "7c4e2a90-1b3d-4f5e-8a6c-0d9e8f7a6b04",
);
const LABEL_A: ObjectID = new ObjectID("7c4e2a90-1b3d-4f5e-8a6c-0d9e8f7a6b05");

type Route = "entity-activity" | "top-entities";

const ROUTES: Array<Route> = ["entity-activity", "top-entities"];

function securityViewer(
  scope: PermissionScope,
  labelIds: Array<ObjectID> = [],
): DatabaseCommonInteractionProps {
  const row: UserPermission = {
    _type: "UserPermission",
    permission: Permission.SecurityViewer,
    labelIds: labelIds,
    isBlockPermission: false,
    scope: scope,
  };

  return {
    userId: ObjectID.generate(),
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: [row],
      },
    },
    ...ON_HIGHEST_PLAN,
  };
}

let props: DatabaseCommonInteractionProps;
let executeQuery: MockedFn;

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
        const labelIds: Array<string> = (
          (request.query["labels"] as Array<ObjectID>) || []
        ).map((id: ObjectID): string => {
          return id.toString();
        });

        return isService && labelIds.includes(LABEL_A.toString())
          ? [{ _id: LABELLED_SOURCE.toString() }]
          : [];
      }) as never);
  }
}

async function read(route: Route): Promise<Statement> {
  const req: ExpressRequest = {
    params: {},
    query: {},
    headers: {},
    body:
      route === "entity-activity"
        ? { values: ["203.0.113.7", "mallory@acme.com"] }
        : {},
  } as unknown as ExpressRequest;
  const next: MockedFn = jest.fn();

  executeQuery.mockClear();

  await mockRouter
    .match("post", `/security-case/${route}`)
    .handlerFunction(
      req,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

  expect(next).not.toHaveBeenCalled();
  expect(executeQuery).toHaveBeenCalledTimes(1);

  return executeQuery.mock.calls[0]![0] as Statement;
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
      return [OWNED_SOURCE, LABELLED_SOURCE, OTHER_SOURCE, PROJECT_ID]
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

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return props;
    });

  jest
    .spyOn(SecurityEventService.database, "getDatasourceOptions")
    .mockReturnValue({ database: "oneuptime" } as never);

  const result: Results = {
    json: (): Promise<unknown> => {
      return Promise.resolve({ data: [] });
    },
  } as unknown as Results;

  executeQuery = jest
    .spyOn(SecurityEventService, "executeQuery")
    .mockResolvedValue(result as never) as unknown as MockedFn;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(ROUTES)("POST /security-case/%s", (route: Route) => {
  test("a Security Viewer over the whole project reads every source", async () => {
    props = securityViewer(PermissionScope.All);

    const statement: Statement = await read(route);

    expect(statement.query).not.toContain("primaryEntityId");
  });

  test("a Security Viewer scoped to owned sources reads the source they own and the project's unattributed events, no other", async () => {
    props = securityViewer(PermissionScope.Owned);

    const statement: Statement = await read(route);

    expect(statement.query.split(" GROUP BY ")[0]).toContain(
      " AND primaryEntityId IN (",
    );
    expect(boundSourceIds(statement)).toEqual(sorted(OWNED_SOURCE, PROJECT_ID));
  });

  test("a Security Viewer limited to label A reads the source carrying it, no other", async () => {
    props = securityViewer(PermissionScope.Labels, [LABEL_A]);

    const statement: Statement = await read(route);

    expect(statement.query.split(" GROUP BY ")[0]).toContain(
      " AND primaryEntityId IN (",
    );
    expect(boundSourceIds(statement)).toEqual(sorted(LABELLED_SOURCE));
  });
});
