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
 * WHO MAY DECLARE AN INCIDENT FROM A SECURITY CASE: POST
 * /security-case/:caseId/declare-incident, the case page's Declare Incident
 * button.
 *
 * OneUptime creates the incident and writes its id on the case as itself,
 * so the route holds the person to what writing both themselves would
 * take, not only to holding the two tables' permissions somewhere in the
 * project:
 *
 *   - the incident is one they could create (DatabaseService
 *     .checkCallerMayCreate): an incident create permission limited to some
 *     labels creates only incidents carrying one of them, and an incident
 *     declared from a case carries none; every host, cluster and service it
 *     is linked to is one they may read;
 *   - the case is one they may change (findOneUpdatableById);
 *   - a credential issued for reading only declares nothing.
 *
 * The cases table is held in memory and the caller's real permission rows
 * go through the real permission layer; the lookups the create check makes
 * of other records (which are in the project, which the caller reads,
 * their labels) are answered here. What lies past the decision - creating
 * the incident, the case's and the incident's feeds - stands in for itself.
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

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

import CommonAPI from "../../../Server/API/CommonAPI";
import SecurityCaseAPI, {
  SECURITY_CASE_NOT_FOUND_MESSAGE,
} from "../../../Server/API/SecurityCaseAPI";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import SecurityCaseFeedService from "../../../Server/Services/SecurityCaseFeedService";
import SecurityCaseService from "../../../Server/Services/SecurityCaseService";
import CreateScopeException from "../../../Server/Types/Database/Permissions/CreateScopeException";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { SecurityConnectedRecord } from "../../../Server/Utils/SecurityEvent/Connections/SecurityConnectedRecords";
import SecurityConnections from "../../../Server/Utils/SecurityEvent/Connections/SecurityConnections";
import { DECLARED_INCIDENT_LINKS_UNREADABLE_MESSAGE } from "../../../Server/Utils/SecurityPlaybook/SecurityPlaybookActions";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil from "../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import {
  SecurityConnectionCertainty,
  SecurityConnectionKind,
} from "../../../Types/SecurityCase/SecurityConnection";
import UserType from "../../../Types/UserType";
import { stubArchivedValues } from "../TestingUtils/ArchivedValues";
import { useInMemoryTable } from "../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";

type MockedFn = ReturnType<typeof jest.fn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "5d0a9c31-7e2b-4f6a-8c14-2b9e0f7a3d01",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "5d0a9c31-7e2b-4f6a-8c14-2b9e0f7a3d02",
);
const CASE_ID: string = "5d0a9c31-7e2b-4f6a-8c14-2b9e0f7a3d03";
const DECLARED_CASE_ID: string = "5d0a9c31-7e2b-4f6a-8c14-2b9e0f7a3d04";
const OTHER_PROJECT_CASE_ID: string = "5d0a9c31-7e2b-4f6a-8c14-2b9e0f7a3d05";
const SEVERITY_ID: ObjectID = new ObjectID(
  "5d0a9c31-7e2b-4f6a-8c14-2b9e0f7a3d06",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "5d0a9c31-7e2b-4f6a-8c14-2b9e0f7a3d07",
);
const USER_ID: ObjectID = new ObjectID("5d0a9c31-7e2b-4f6a-8c14-2b9e0f7a3d08");
const PAYMENTS_LABEL_ID: ObjectID = new ObjectID(
  "5d0a9c31-7e2b-4f6a-8c14-2b9e0f7a3d09",
);
const HOST_ID: string = "5d0a9c31-7e2b-4f6a-8c14-2b9e0f7a3d0a";

interface Row {
  permission: Permission;
  labelIds?: Array<ObjectID> | undefined;
}

// A signed-in member of the project holding exactly these rows.
function caller(
  rows: Array<Row>,
  extra: Partial<DatabaseCommonInteractionProps> = {},
): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: rows.map((row: Row): UserPermission => {
          return {
            _type: "UserPermission",
            permission: row.permission,
            labelIds: row.labelIds || [],
            isBlockPermission: false,
            scope: row.labelIds ? PermissionScope.Labels : PermissionScope.All,
          };
        }),
      },
    },
    ...ON_HIGHEST_PLAN,
    ...extra,
  };
}

// Works security cases, and creates incidents over the whole project.
const DECLARER: Array<Row> = [
  { permission: Permission.SecurityMember },
  { permission: Permission.ProjectMember },
];

let props: DatabaseCommonInteractionProps;
let links: Array<SecurityConnectedRecord>;
// The hosts a read of hosts as the caller reaches.
let readableHostIds: Array<string>;
let created: Array<Incident>;
let caseLinked: MockedFn;
let caseFeed: MockedFn;

const sendJsonObjectResponseMock: MockedFn =
  Response.sendJsonObjectResponse as unknown as MockedFn;

async function declare(
  caseId: string = CASE_ID,
): Promise<{ answer: JSONObject | null; refusal: Exception | null }> {
  const req: ExpressRequest = {
    params: { caseId },
    query: {},
    headers: {},
    body: { incidentSeverityId: SEVERITY_ID.toString() },
  } as unknown as ExpressRequest;
  const next: MockedFn = jest.fn();

  sendJsonObjectResponseMock.mockClear();

  await mockRouter
    .match("post", "/security-case/:caseId/declare-incident")
    .handlerFunction(
      req,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

  return {
    answer: sendJsonObjectResponseMock.mock.calls[0]
      ? (sendJsonObjectResponseMock.mock.calls[0][2] as JSONObject)
      : null,
    refusal: (next.mock.calls[0]?.[0] as Exception | undefined) || null,
  };
}

function expectNothingDeclared(): void {
  expect(created).toHaveLength(0);
  expect(caseLinked).not.toHaveBeenCalled();
  expect(caseFeed).not.toHaveBeenCalled();
}

beforeAll(() => {
  mockRouter.routes.length = 0;
  new SecurityCaseAPI();
});

beforeEach(() => {
  jest.clearAllMocks();

  links = [];
  readableHostIds = [HOST_ID];
  created = [];

  useInMemoryTable(SecurityCaseService, [
    {
      _id: CASE_ID,
      projectId: PROJECT_ID.toString(),
      caseNumberWithPrefix: "SEC-12",
      title: "Brute force on web-1",
      incidentId: null,
    },
    {
      _id: DECLARED_CASE_ID,
      projectId: PROJECT_ID.toString(),
      caseNumberWithPrefix: "SEC-13",
      title: "Already declared",
      incidentId: INCIDENT_ID.toString(),
    },
    {
      _id: OTHER_PROJECT_CASE_ID,
      projectId: OTHER_PROJECT_ID.toString(),
      caseNumberWithPrefix: "SEC-1",
      title: "Another project's case",
      incidentId: null,
    },
  ]);

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return props;
    });

  const severity: IncidentSeverity = new IncidentSeverity();
  severity._id = SEVERITY_ID.toString();
  severity.name = "Critical";
  severity.isArchived = false;
  jest
    .spyOn(IncidentSeverityService, "findOneBy")
    .mockResolvedValue(severity as never);

  jest
    .spyOn(SecurityConnections, "readIncidentLinks")
    .mockImplementation(async (): Promise<Array<SecurityConnectedRecord>> => {
      return links;
    });

  // What the create check looks up about other records, without a database.
  stubArchivedValues();
  jest
    .spyOn(
      DatabaseService as unknown as {
        findIdsInProject: (data: {
          ids: Array<string>;
        }) => Promise<Array<string>>;
      },
      "findIdsInProject",
    )
    .mockImplementation(
      async (data: { ids: Array<string> }): Promise<Array<string>> => {
        return [...data.ids];
      },
    );
  jest
    .spyOn(
      DatabaseService as unknown as {
        findReadableParentIds: (data: {
          parentModelType: { new (): DatabaseBaseModel };
          ids: Array<string>;
        }) => Promise<Array<string>>;
      },
      "findReadableParentIds",
    )
    .mockImplementation(
      async (data: {
        parentModelType: { new (): DatabaseBaseModel };
        ids: Array<string>;
      }): Promise<Array<string>> => {
        if (new data.parentModelType().tableName !== "Host") {
          return [...data.ids];
        }

        return data.ids.filter((id: string): boolean => {
          return readableHostIds.includes(id.toLowerCase());
        });
      },
    );
  jest
    .spyOn(
      DatabaseService as unknown as {
        findRecordLabels: (data: {
          ids: Array<string>;
        }) => Promise<Record<string, Array<string>>>;
      },
      "findRecordLabels",
    )
    .mockImplementation(
      async (data: {
        ids: Array<string>;
      }): Promise<Record<string, Array<string>>> => {
        const labels: Record<string, Array<string>> = {};

        for (const id of data.ids) {
          labels[id.toLowerCase()] = [];
        }

        return labels;
      },
    );
  jest
    .spyOn(
      DatabaseService as unknown as {
        findLabelNames: (data: {
          labelIds: Array<string>;
        }) => Promise<Array<string>>;
      },
      "findLabelNames",
    )
    .mockImplementation(
      async (data: { labelIds: Array<string> }): Promise<Array<string>> => {
        return data.labelIds.map((labelId: string): string => {
          return labelId.toLowerCase() ===
            PAYMENTS_LABEL_ID.toString().toLowerCase()
            ? "payments"
            : labelId;
        });
      },
    );

  // Past the decision.
  jest
    .spyOn(SecurityCaseService, "getCaseLinkInDashboard")
    .mockResolvedValue(URL.fromString("https://oneuptime.example/c/12"));
  jest
    .spyOn(IncidentService, "getIncidentLinkInDashboard")
    .mockResolvedValue(URL.fromString("https://oneuptime.example/i/7"));
  jest
    .spyOn(IncidentService, "create")
    .mockImplementation(async (args: { data: Incident }) => {
      created.push(args.data);
      const incident: Incident = new Incident();
      incident._id = INCIDENT_ID.toString();
      incident.incidentNumberWithPrefix = "INC-7";
      return incident;
    });
  caseLinked = jest
    .spyOn(SecurityCaseService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never) as unknown as MockedFn;
  caseFeed = jest
    .spyOn(SecurityCaseFeedService, "createSecurityCaseFeedItem")
    .mockResolvedValue(undefined as never) as unknown as MockedFn;
  jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("declaring an incident from a case, by whoever could write both", () => {
  test("a Security Member who creates incidents over the whole project declares it, linked to the host the case names", async () => {
    props = caller(DECLARER);
    links = [
      {
        kind: SecurityConnectionKind.Host,
        id: HOST_ID,
        name: "web-1",
        certainty: SecurityConnectionCertainty.Exact,
        matches: [],
      },
    ];

    const { answer, refusal } = await declare();

    expect(refusal).toBeNull();
    expect(answer).toEqual({
      incidentId: INCIDENT_ID.toString(),
      incidentNumber: "INC-7",
    });
    expect(created).toHaveLength(1);
    expect(created[0]!.createdByUserId?.toString()).toBe(USER_ID.toString());
    expect(created[0]!.hosts?.[0]?.id?.toString()).toBe(HOST_ID);
    expect(caseLinked).toHaveBeenCalledTimes(1);
  });

  test("a case already declared is said to be", async () => {
    props = caller(DECLARER);

    const { refusal } = await declare(DECLARED_CASE_ID);

    expect(refusal!.message).toBe(
      "An incident is already declared for this case.",
    );
    expectNothingDeclared();
  });
});

describe("refused, before anything is created or written", () => {
  test("an incident create permission limited to some labels: the incident would carry none of them", async () => {
    props = caller([
      { permission: Permission.SecurityMember },
      { permission: Permission.ReadProjectIncident },
      {
        permission: Permission.CreateProjectIncident,
        labelIds: [PAYMENTS_LABEL_ID],
      },
    ]);

    const { answer, refusal } = await declare();

    expect(answer).toBeNull();
    expect(refusal).toBeInstanceOf(CreateScopeException);
    expect(refusal!.message).toContain(
      "Your access lets you create Incidents only with one of these labels: payments.",
    );
    expectNothingDeclared();
  });

  test("a case naming a host the declarer may not read: the incident would be linked to it", async () => {
    props = caller(DECLARER);
    readableHostIds = [];
    links = [
      {
        kind: SecurityConnectionKind.Host,
        id: HOST_ID,
        name: "web-1",
        certainty: SecurityConnectionCertainty.Exact,
        matches: [],
      },
    ];

    const { answer, refusal } = await declare();

    expect(answer).toBeNull();
    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal!.message).toBe(DECLARED_INCIDENT_LINKS_UNREADABLE_MESSAGE);
    expectNothingDeclared();
  });

  test("a credential issued for reading only declares nothing, whatever its roles", async () => {
    props = caller(DECLARER, { isReadOnlyCredential: true });

    const { answer, refusal } = await declare();

    expect(answer).toBeNull();
    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    expect(refusal!.message).toBe(
      DatabaseCommonInteractionPropsUtil.READ_ONLY_CREDENTIAL_MESSAGE,
    );
    expectNothingDeclared();
  });

  test("another project's case is not found", async () => {
    props = caller(DECLARER);

    const { answer, refusal } = await declare(OTHER_PROJECT_CASE_ID);

    expect(answer).toBeNull();
    expect(refusal).toBeInstanceOf(NotFoundException);
    expect(refusal!.message).toBe(SECURITY_CASE_NOT_FOUND_MESSAGE);
    expectNothingDeclared();
  });
});
