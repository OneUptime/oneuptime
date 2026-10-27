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
 * THE CAMPAIGNS PAGE READS THE ATTACKS ON THE SOURCES THE CALLER MAY READ:
 * POST /security-event/attack-campaigns.
 *
 * It builds its own ClickHouse SQL (SecurityEventService
 * .findAttackCampaigns), so nothing downstream narrows it to the caller. A
 * security event belongs to the source it came from (its primaryEntityId),
 * and a Security role may be scoped to the sources it owns or to some
 * labels, or blocked from the sources carrying some labels; such a reader
 * gets the addresses, tools and targets of those sources' attacks, never
 * every source's. The route runs through its real handler and the real read
 * scope (ModelPermission.getReadScope); only the owner and label lookups
 * behind the scope, and ClickHouse itself, are answered here. The SQL the
 * route sends is what is checked.
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
import SecurityAttackCampaignAPI from "../../../Server/API/SecurityAttackCampaignAPI";
import { Results } from "../../../Server/Services/AnalyticsDatabaseService";
import SecurityEventService from "../../../Server/Services/SecurityEventService";
import OwnerTableRegistry from "../../../Server/Types/Database/Permissions/OwnerTableRegistry";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";

type MockedFn = ReturnType<typeof jest.fn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "9a3f1c62-4d7e-4b85-a1c9-6e2d0b7f8a01",
);
/*
 * The source the caller owns, the one carrying label A, the one carrying
 * label B, and one of neither.
 */
const OWNED_SOURCE: ObjectID = new ObjectID(
  "9a3f1c62-4d7e-4b85-a1c9-6e2d0b7f8a02",
);
const LABELLED_SOURCE: ObjectID = new ObjectID(
  "9a3f1c62-4d7e-4b85-a1c9-6e2d0b7f8a03",
);
const BLOCKED_SOURCE: ObjectID = new ObjectID(
  "9a3f1c62-4d7e-4b85-a1c9-6e2d0b7f8a04",
);
const OTHER_SOURCE: ObjectID = new ObjectID(
  "9a3f1c62-4d7e-4b85-a1c9-6e2d0b7f8a05",
);
const LABEL_A: ObjectID = new ObjectID("9a3f1c62-4d7e-4b85-a1c9-6e2d0b7f8a06");
const LABEL_B: ObjectID = new ObjectID("9a3f1c62-4d7e-4b85-a1c9-6e2d0b7f8a07");

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

async function readCampaigns(): Promise<Statement> {
  const req: ExpressRequest = {
    params: {},
    query: {},
    headers: {},
    body: {},
  } as unknown as ExpressRequest;
  const next: MockedFn = jest.fn();

  executeQuery.mockClear();
  sendJsonObjectResponseMock.mockClear();

  await mockRouter
    .match("post", "/security-event/attack-campaigns")
    .handlerFunction(
      req,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

  expect(next).not.toHaveBeenCalled();
  expect(sendJsonObjectResponseMock).toHaveBeenCalledTimes(1);
  expect(executeQuery).toHaveBeenCalledTimes(1);

  return executeQuery.mock.calls[0]![0] as Statement;
}

// The conditions before the rows are grouped by the address that sent them.
function whereOf(statement: Statement): string {
  return statement.query.split(" GROUP BY ")[0]!;
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
  new SecurityAttackCampaignAPI().getRouter();
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

describe("POST /security-event/attack-campaigns", () => {
  test("a Security Viewer over the whole project reads the attacks on every source", async () => {
    props = securityViewer([{ scope: PermissionScope.All }]);

    const statement: Statement = await readCampaigns();

    expect(statement.query).not.toContain("primaryEntityId");
  });

  test("a Security Viewer scoped to owned sources reads the source they own and the project's unattributed events, no other", async () => {
    props = securityViewer([{ scope: PermissionScope.Owned }]);

    const statement: Statement = await readCampaigns();

    expect(whereOf(statement)).toContain(" AND primaryEntityId IN (");
    expect(boundSourceIds(statement)).toEqual(sorted(OWNED_SOURCE, PROJECT_ID));
  });

  test("a Security Viewer limited to label A reads the source carrying it, no other", async () => {
    props = securityViewer([
      { scope: PermissionScope.Labels, labelIds: [LABEL_A] },
    ]);

    const statement: Statement = await readCampaigns();

    expect(whereOf(statement)).toContain(" AND primaryEntityId IN (");
    expect(boundSourceIds(statement)).toEqual(sorted(LABELLED_SOURCE));
  });

  test("a Security Viewer over the whole project, blocked from label B, reads every source but the one carrying it", async () => {
    props = securityViewer([
      { scope: PermissionScope.All },
      { labelIds: [LABEL_B], isBlockPermission: true },
    ]);

    const statement: Statement = await readCampaigns();

    expect(whereOf(statement)).toContain(" AND primaryEntityId NOT IN (");
    expect(whereOf(statement)).not.toContain(" AND primaryEntityId IN (");
    expect(boundSourceIds(statement)).toEqual(sorted(BLOCKED_SOURCE));
  });
});
