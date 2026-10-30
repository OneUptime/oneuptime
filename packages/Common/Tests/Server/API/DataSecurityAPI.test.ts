import { mockRouter } from "./Helpers";
import DataSecurityAPI from "../../../Server/API/DataSecurityAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import Queue from "../../../Server/Infrastructure/Queue";
import AIService from "../../../Server/Services/AIService";
import CloudConnectionService from "../../../Server/Services/CloudConnectionService";
import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
import DataSecurityIssueFeedService from "../../../Server/Services/DataSecurityIssueFeedService";
import DataSecurityIssueService from "../../../Server/Services/DataSecurityIssueService";
import DataStoreFindingService from "../../../Server/Services/DataStoreFindingService";
import DataStoreService from "../../../Server/Services/DataStoreService";
import CodeTaskRuns from "../../../Server/Utils/AI/CodeTask/CodeTaskRuns";
import AiContextReader from "../../../Server/Utils/AI/AiContext/AiContextReader";
import { AiContextSource } from "../../../Types/AI/AiContext";
import DataSecurityIntegrations from "../../../Server/Utils/DataSecurity/DataSecurityIntegrations";
import {
  DATA_SECURITY_EVALUATE_PROJECT_JOB,
  DATA_SECURITY_READ_CONNECTION_JOB,
  DATA_SECURITY_SCAN_STORE_JOB,
} from "../../../Server/Utils/DataSecurity/DataSecurityJobs";
import * as TelemetryScrubCoverage from "../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubCoverage";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import DataSecurityIssue from "../../../Models/DatabaseModels/DataSecurityIssue";
import { DataSecurityIssueFeedEventType } from "../../../Models/DatabaseModels/DataSecurityIssueFeed";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import DataStoreFinding from "../../../Models/DatabaseModels/DataStoreFinding";
import User from "../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { Purple500 } from "../../../Types/BrandColors";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import Email from "../../../Types/Email";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import SecuritySeverity from "../../../Types/SecuritySeverity";
import UserType from "../../../Types/UserType";
import ComplianceFramework, {
  ALL_COMPLIANCE_FRAMEWORKS,
  COMPLIANCE_FRAMEWORK_INFO,
} from "../../../Types/DataSecurity/ComplianceFramework";
import {
  ComplianceIssueInput,
  ComplianceRequirementResult,
  ComplianceRequirementStatus,
  ComplianceStoreInput,
  scoreComplianceFramework,
} from "../../../Types/DataSecurity/ComplianceRequirementCatalog";
import DataCategory from "../../../Types/DataSecurity/DataCategory";
import {
  DATA_SECURITY_API_ROUTES,
  DataSecurityComplianceFramework,
  DataSecurityComplianceResponse,
  DataSecurityOverview,
  DataSecurityRecordOfProcessingResponse,
} from "../../../Types/DataSecurity/DataSecurityApiTypes";
import { getDataSecurityCheck } from "../../../Types/DataSecurity/DataSecurityCheckCatalog";
import DataSecurityIssueStatus from "../../../Types/DataSecurity/DataSecurityIssueStatus";
import DataSensitivity from "../../../Types/DataSecurity/DataSensitivity";
import DataStoreEnvironment from "../../../Types/DataSecurity/DataStoreEnvironment";
import { DataStoreKind } from "../../../Types/DataSecurity/DataStoreKind";
import { DataStoreExposure } from "../../../Types/DataSecurity/DataStorePosture";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendJsonObjectResponse: jest.fn(),
    sendEntityArrayResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

/*
 * Data Security's own routes (DataSecurityAPI), beside the Data Store CRUD:
 * each is mounted under the path the Dashboard reads from
 * (DATA_SECURITY_API_ROUTES), refuses whoever is not a member of the
 * project or lacks the route's permissions before it reads anything, reads
 * only the caller's project, and answers what it says it computes - the
 * Overview's figures, each framework's compliance score, the record of
 * processing. Postgres, the queue, OneUptime AI and the code task runner
 * are stood in for.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const STORE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const NOW: Date = new Date("2026-10-27T12:00:00.000Z");
const DAY_IN_MS: number = 24 * 60 * 60 * 1000;
const PERMISSION_MESSAGE: string =
  "You do not have permission to do this in Data Security.";

const READ: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
  Permission.ReadDataStore,
];
const OPERATE: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.EditDataStore,
];
const SCRUB: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.CreateProjectLogScrubRule,
  Permission.CreateProjectTraceScrubRule,
];
const FIX: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.EditDataSecurityIssue,
];

interface RouteCase {
  name: string;
  path: string;
  allowed: Array<Permission>;
  refused: Array<Permission>;
}

const ROUTES: Array<RouteCase> = [
  {
    name: "overview",
    path: DATA_SECURITY_API_ROUTES.overview,
    allowed: READ,
    refused: [Permission.ProjectMember, Permission.ReadDataSecurityIssue],
  },
  {
    name: "compliance",
    path: DATA_SECURITY_API_ROUTES.compliance,
    allowed: READ,
    refused: [Permission.ProjectMember, Permission.ReadDataSecurityIssue],
  },
  {
    name: "record of processing",
    path: DATA_SECURITY_API_ROUTES.recordOfProcessing,
    allowed: READ,
    refused: [Permission.ProjectMember, Permission.ReadDataStoreFinding],
  },
  {
    name: "scan now",
    path: DATA_SECURITY_API_ROUTES.scanNow(":id"),
    allowed: OPERATE,
    refused: [
      Permission.ReadDataStore,
      Permission.SecurityViewer,
      Permission.ProjectMember,
    ],
  },
  {
    name: "check now",
    path: DATA_SECURITY_API_ROUTES.checkNow(":id"),
    allowed: OPERATE,
    refused: [
      Permission.ReadDataStore,
      Permission.SecurityViewer,
      Permission.EditDataSecurityIssue,
    ],
  },
  {
    name: "scrub it",
    path: DATA_SECURITY_API_ROUTES.scrubFinding(":id"),
    allowed: SCRUB,
    refused: [
      Permission.SecurityAdmin,
      Permission.EditDataStore,
      Permission.EditDataStoreFinding,
    ],
  },
  {
    name: "explain",
    path: DATA_SECURITY_API_ROUTES.explainIssue(":id"),
    allowed: READ,
    refused: [Permission.ProjectMember, Permission.ReadDataSecurityIssue],
  },
  {
    name: "fix with AI",
    path: DATA_SECURITY_API_ROUTES.fixIssueWithAi(":id"),
    allowed: FIX,
    refused: [
      Permission.SecurityViewer,
      Permission.ReadDataSecurityIssue,
      Permission.EditDataStore,
    ],
  },
];

// Each route with each permission it answers, and each it refuses.
const ROUTE_PERMISSIONS_ALLOWED: Array<[string, Permission, RouteCase]> =
  ROUTES.flatMap((route: RouteCase): Array<[string, Permission, RouteCase]> => {
    return route.allowed.map(
      (permission: Permission): [string, Permission, RouteCase] => {
        return [route.name, permission, route];
      },
    );
  });

const ROUTE_PERMISSIONS_REFUSED: Array<[string, Permission, RouteCase]> =
  ROUTES.flatMap((route: RouteCase): Array<[string, Permission, RouteCase]> => {
    return route.refused.map(
      (permission: Permission): [string, Permission, RouteCase] => {
        return [route.name, permission, route];
      },
    );
  });

function buildProps(
  permissions: Array<Permission>,
  memberOf: ObjectID = PROJECT_ID,
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: memberOf,
    permissions: permissions.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  };
  const map: Dictionary<UserTenantAccessPermission> = {};
  map[memberOf.toString()] = tenantPermission;

  return {
    tenantId: PROJECT_ID,
    userId: USER_ID,
    userType: UserType.User,
    userTenantAccessPermission: map,
  };
}

interface RouteCall {
  thrown: unknown;
  answer: JSONObject | undefined;
}

let propsSpy: jest.SpyInstance;
let queueSpy: jest.SpyInstance;
let storeFindOneSpy: jest.SpyInstance;
let storeFindSpy: jest.SpyInstance;
let storeUpdateSpy: jest.SpyInstance;
let issueFindOneSpy: jest.SpyInstance;
let issueFindSpy: jest.SpyInstance;
let findingFindOneSpy: jest.SpyInstance;
let findingFindSpy: jest.SpyInstance;
let findingUpdateSpy: jest.SpyInstance;
let connectionsSpy: jest.SpyInstance;
let feedSpy: jest.SpyInstance;
let aiSpy: jest.SpyInstance;
let repositoriesSpy: jest.SpyInstance;
let codeTaskSpy: jest.SpyInstance;
let scrubSpy: jest.SpyInstance;
let ownersSpy: jest.SpyInstance;
let aiContextSpy: jest.SpyInstance;

let storeRow: DataStore | null;
let issueRow: DataSecurityIssue | null;
let findingRow: DataStoreFinding | null;
let stores: Array<DataStore>;
let issues: Array<DataSecurityIssue>;
let findings: Array<DataStoreFinding>;
let connections: Array<CloudConnection>;
let repositories: Array<CodeRepository>;

function asCaller(permissions: Array<Permission>): void {
  propsSpy.mockResolvedValue(buildProps(permissions));
}

async function call(
  path: string,
  params: Record<string, string> = {},
  body: JSONObject = {},
): Promise<RouteCall> {
  const req: ExpressRequest = {
    params,
    query: {},
    body,
    headers: {},
  } as unknown as ExpressRequest;
  const res: ExpressResponse = {} as ExpressResponse;
  const next: jest.Mock = jest.fn();
  const send: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;
  const before: number = send.mock.calls.length;

  await mockRouter
    .match("POST", path)
    .handlerFunction(req, res, next as unknown as NextFunction);

  return {
    thrown: next.mock.calls[0]?.[0],
    answer:
      send.mock.calls.length > before
        ? (send.mock.calls[send.mock.calls.length - 1]![2] as JSONObject)
        : undefined,
  };
}

function paramsFor(route: RouteCase): Record<string, string> {
  return route.path.includes(":id") ? { id: STORE_ID.toString() } : {};
}

function readsMade(): number {
  return [
    storeFindOneSpy,
    storeFindSpy,
    issueFindOneSpy,
    issueFindSpy,
    findingFindOneSpy,
    findingFindSpy,
    connectionsSpy,
    repositoriesSpy,
  ].reduce((sum: number, spy: jest.SpyInstance) => {
    return sum + spy.mock.calls.length;
  }, 0);
}

function queuedJobs(): Array<{ jobName: string; payload: JSONObject }> {
  return queueSpy.mock.calls.map((queued: Array<unknown>) => {
    return { jobName: queued[2] as string, payload: queued[3] as JSONObject };
  });
}

function telemetryFinding(kind: DataStoreKind): DataStoreFinding {
  const finding: DataStoreFinding = new DataStoreFinding(STORE_ID);
  finding.dataTypeId = "email-address";
  finding.location = "attributes.user.email";
  finding.dataStoreId = ObjectID.generate();
  const store: DataStore = new DataStore();
  store.kind = kind;
  finding.dataStore = store;
  return finding;
}

function issueOf(): DataSecurityIssue {
  const issue: DataSecurityIssue = new DataSecurityIssue(STORE_ID);
  issue.checkId = "public-read";
  issue.title = "Anyone on the internet can read it";
  issue.severity = SecuritySeverity.Critical;
  issue.evidence = "The bucket policy grants s3:GetObject to *.";
  issue.dataTypeIds = ["credit-card-number", "custom:loyalty"];
  const store: DataStore = new DataStore();
  store.name = "customer-exports";
  store.kind = DataStoreKind.AwsS3Bucket;
  store.region = "us-east-1";
  store.sensitivity = DataSensitivity.Restricted;
  store.providerResourceId = "arn:aws:s3:::customer-exports";
  issue.dataStore = store;
  return issue;
}

beforeAll(() => {
  mockRouter.routes.length = 0;
  new DataSecurityAPI();
});

beforeEach(() => {
  jest.clearAllMocks();

  storeRow = new DataStore(STORE_ID);
  issueRow = issueOf();
  findingRow = telemetryFinding(DataStoreKind.TelemetryLogs);
  stores = [];
  issues = [];
  findings = [];
  connections = [];
  repositories = [];

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
    return new Date(NOW.getTime());
  });
  propsSpy = jest.spyOn(CommonAPI, "getDatabaseCommonInteractionProps");
  asCaller([Permission.ProjectOwner]);

  queueSpy = jest.spyOn(Queue, "addJob").mockResolvedValue(undefined as never);
  storeFindOneSpy = jest
    .spyOn(DataStoreService, "findOneBy")
    .mockImplementation((async () => {
      return storeRow;
    }) as never);
  storeFindSpy = jest
    .spyOn(DataStoreService, "findBy")
    .mockImplementation((async () => {
      return stores;
    }) as never);
  storeUpdateSpy = jest
    .spyOn(DataStoreService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);
  issueFindOneSpy = jest
    .spyOn(DataSecurityIssueService, "findOneBy")
    .mockImplementation((async () => {
      return issueRow;
    }) as never);
  issueFindSpy = jest
    .spyOn(DataSecurityIssueService, "findBy")
    .mockImplementation((async () => {
      return issues;
    }) as never);
  findingFindOneSpy = jest
    .spyOn(DataStoreFindingService, "findOneBy")
    .mockImplementation((async () => {
      return findingRow;
    }) as never);
  findingFindSpy = jest
    .spyOn(DataStoreFindingService, "findBy")
    .mockImplementation((async () => {
      return findings;
    }) as never);
  findingUpdateSpy = jest
    .spyOn(DataStoreFindingService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);
  connectionsSpy = jest
    .spyOn(CloudConnectionService, "findBy")
    .mockImplementation((async () => {
      return connections;
    }) as never);
  feedSpy = jest
    .spyOn(DataSecurityIssueFeedService, "createDataSecurityIssueFeedItem")
    .mockResolvedValue(undefined);
  aiSpy = jest
    .spyOn(AIService, "executeWithLogging")
    .mockResolvedValue({ content: "Turn on Block Public Access." } as never);
  repositoriesSpy = jest
    .spyOn(CodeRepositoryService, "findBy")
    .mockImplementation((async () => {
      return repositories;
    }) as never);
  codeTaskSpy = jest
    .spyOn(CodeTaskRuns, "start")
    .mockImplementation((async () => {
      return new AIRun(new ObjectID("77777777-7777-4777-8777-777777777777"));
    }) as never);
  scrubSpy = jest
    .spyOn(TelemetryScrubCoverage, "createScrubRuleForFinding")
    .mockResolvedValue({
      signal: "log",
      scrubRuleId: "88888888-8888-4888-8888-888888888888",
      scrubRuleName: "Data Security: Email address in attributes.user.email",
    });
  ownersSpy = jest
    .spyOn(DataSecurityIntegrations, "getOwnerUsers")
    .mockResolvedValue([]);
  // A project with no AI context, unless a test writes one.
  aiContextSpy = jest.spyOn(AiContextReader, "read").mockResolvedValue(null);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("routes and who may call them", () => {
  test("the routes are the shared paths the Dashboard calls", () => {
    expect(DATA_SECURITY_API_ROUTES.overview).toBe("/data-security/overview");
    expect(DATA_SECURITY_API_ROUTES.compliance).toBe(
      "/data-security/compliance",
    );
    expect(DATA_SECURITY_API_ROUTES.recordOfProcessing).toBe(
      "/data-security/record-of-processing",
    );
    expect(DATA_SECURITY_API_ROUTES.scanNow("x")).toBe(
      "/data-store/x/scan-now",
    );
    expect(DATA_SECURITY_API_ROUTES.checkNow("x")).toBe(
      "/data-store/x/check-now",
    );
    expect(DATA_SECURITY_API_ROUTES.scrubFinding("x")).toBe(
      "/data-store-finding/x/scrub",
    );
    expect(DATA_SECURITY_API_ROUTES.explainIssue("x")).toBe(
      "/data-security-issue/x/explain",
    );
    expect(DATA_SECURITY_API_ROUTES.fixIssueWithAi("x")).toBe(
      "/data-security-issue/x/fix-with-ai",
    );
  });

  test.each(ROUTES)(
    "$name is a POST under its path, behind the user middleware and sign-in",
    (route: RouteCase) => {
      expect(mockRouter.match("POST", route.path).middlewares).toEqual([
        UserMiddleware.getUserMiddleware,
        UserMiddleware.requireUserAuthentication,
      ]);
    },
  );

  test.each(ROUTE_PERMISSIONS_ALLOWED)(
    "%s answers a caller holding %s",
    async (_name: string, permission: Permission, route: RouteCase) => {
      asCaller([permission]);
      repositories = [new CodeRepository(ObjectID.generate())];

      const result: RouteCall = await call(route.path, paramsFor(route));

      expect(result.thrown).toBeUndefined();
      expect(result.answer).toBeDefined();
    },
  );

  test.each(ROUTE_PERMISSIONS_REFUSED)(
    "%s refuses a caller holding only %s, before reading anything",
    async (_name: string, permission: Permission, route: RouteCase) => {
      asCaller([permission]);

      const result: RouteCall = await call(route.path, paramsFor(route));

      expect(result.thrown).toBeInstanceOf(NotAuthorizedException);
      expect((result.thrown as Exception).message).toBe(PERMISSION_MESSAGE);
      expect(result.answer).toBeUndefined();
      expect(readsMade()).toBe(0);
      expect(queueSpy).not.toHaveBeenCalled();
      expect(aiSpy).not.toHaveBeenCalled();
      expect(scrubSpy).not.toHaveBeenCalled();
    },
  );

  test.each(ROUTES)(
    "$name refuses an anonymous caller",
    async (route: RouteCase) => {
      propsSpy.mockResolvedValue({});

      const result: RouteCall = await call(route.path, paramsFor(route));

      expect(result.thrown).toBeInstanceOf(NotAuthenticatedException);
      expect(readsMade()).toBe(0);
    },
  );

  test.each(ROUTES)(
    "$name refuses someone who is not a member of the project they named",
    async (route: RouteCase) => {
      propsSpy.mockResolvedValue(
        buildProps([Permission.ProjectOwner], ObjectID.generate()),
      );

      const result: RouteCall = await call(route.path, paramsFor(route));

      expect(result.thrown).toBeInstanceOf(NotAuthorizedException);
      expect(readsMade()).toBe(0);
    },
  );
});

describe("Scan Now and Check Now", () => {
  test("Scan Now makes the store due now and queues its scan", async () => {
    const result: RouteCall = await call(
      DATA_SECURITY_API_ROUTES.scanNow(":id"),
      {
        id: STORE_ID.toString(),
      },
    );

    expect(result.answer).toEqual({});
    expect(storeFindOneSpy.mock.calls[0]![0]).toMatchObject({
      query: { _id: STORE_ID, projectId: PROJECT_ID },
      props: { isRoot: true },
    });
    expect(storeUpdateSpy).toHaveBeenCalledWith({
      id: STORE_ID,
      data: { nextContentScanAt: NOW },
    });
    expect(queuedJobs()).toEqual([
      {
        jobName: DATA_SECURITY_SCAN_STORE_JOB,
        payload: {
          projectId: PROJECT_ID.toString(),
          dataStoreId: STORE_ID.toString(),
        },
      },
    ]);
  });

  test("a store of another project, or none at all, is not found, and nothing is queued", async () => {
    storeRow = null;

    for (const path of [
      DATA_SECURITY_API_ROUTES.scanNow(":id"),
      DATA_SECURITY_API_ROUTES.checkNow(":id"),
    ]) {
      const result: RouteCall = await call(path, { id: STORE_ID.toString() });

      expect(result.thrown).toBeInstanceOf(BadDataException);
      expect((result.thrown as Exception).message).toBe(
        "Data store not found.",
      );
    }

    expect(storeUpdateSpy).not.toHaveBeenCalled();
    expect(queueSpy).not.toHaveBeenCalled();
  });

  test("an id that is not an id is not found, before anything is read", async () => {
    const result: RouteCall = await call(
      DATA_SECURITY_API_ROUTES.scanNow(":id"),
      {
        id: "../other-project",
      },
    );

    expect((result.thrown as Exception).message).toBe("Not found.");
    expect(storeFindOneSpy).not.toHaveBeenCalled();
  });

  test("Check Now reads the store's cloud connection again, then evaluates the project", async () => {
    const connectionId: ObjectID = ObjectID.generate();
    storeRow!.cloudConnectionId = connectionId;

    const result: RouteCall = await call(
      DATA_SECURITY_API_ROUTES.checkNow(":id"),
      {
        id: STORE_ID.toString(),
      },
    );

    expect(result.answer).toEqual({});
    expect(queuedJobs()).toEqual([
      {
        jobName: DATA_SECURITY_READ_CONNECTION_JOB,
        payload: {
          projectId: PROJECT_ID.toString(),
          cloudConnectionId: connectionId.toString(),
        },
      },
      {
        jobName: DATA_SECURITY_EVALUATE_PROJECT_JOB,
        payload: { projectId: PROJECT_ID.toString() },
      },
    ]);
  });

  test("Check Now on a store with no cloud connection only evaluates the project", async () => {
    await call(DATA_SECURITY_API_ROUTES.checkNow(":id"), {
      id: STORE_ID.toString(),
    });

    expect(queuedJobs()).toEqual([
      {
        jobName: DATA_SECURITY_EVALUATE_PROJECT_JOB,
        payload: { projectId: PROJECT_ID.toString() },
      },
    ]);
  });
});

describe("Scrub It", () => {
  test("makes the scrub rule as the caller, marks the finding scrubbed, and evaluates again", async () => {
    asCaller([Permission.CreateProjectLogScrubRule]);

    const result: RouteCall = await call(
      DATA_SECURITY_API_ROUTES.scrubFinding(":id"),
      {
        id: STORE_ID.toString(),
      },
    );

    expect(scrubSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      userId: USER_ID,
      kind: DataStoreKind.TelemetryLogs,
      dataTypeId: "email-address",
      location: "attributes.user.email",
    });
    expect(findingFindOneSpy.mock.calls[0]![0]).toMatchObject({
      query: { _id: STORE_ID, projectId: PROJECT_ID },
    });
    expect(findingUpdateSpy).toHaveBeenCalledWith({
      id: STORE_ID,
      data: { isScrubbed: true },
    });
    expect(queuedJobs()).toEqual([
      {
        jobName: DATA_SECURITY_EVALUATE_PROJECT_JOB,
        payload: { projectId: PROJECT_ID.toString() },
      },
    ]);
    expect(result.answer).toEqual({
      signal: "log",
      scrubRuleId: "88888888-8888-4888-8888-888888888888",
      scrubRuleName: "Data Security: Email address in attributes.user.email",
    });
  });

  test("every kind of telemetry can be scrubbed", async () => {
    for (const kind of [
      DataStoreKind.TelemetryTraces,
      DataStoreKind.TelemetryExceptions,
      DataStoreKind.TelemetrySessionReplays,
      DataStoreKind.TelemetryAiConversations,
    ]) {
      findingRow = telemetryFinding(kind);

      const result: RouteCall = await call(
        DATA_SECURITY_API_ROUTES.scrubFinding(":id"),
        { id: STORE_ID.toString() },
      );

      expect(result.thrown).toBeUndefined();
    }

    expect(scrubSpy).toHaveBeenCalledTimes(4);
  });

  test("a finding in a data store, not telemetry, is refused: Scrub It masks telemetry at ingest", async () => {
    findingRow = telemetryFinding(DataStoreKind.AwsS3Bucket);

    const result: RouteCall = await call(
      DATA_SECURITY_API_ROUTES.scrubFinding(":id"),
      {
        id: STORE_ID.toString(),
      },
    );

    expect((result.thrown as Exception).message).toBe(
      "Scrub It masks telemetry at ingest; this finding is in a data store.",
    );
    expect(scrubSpy).not.toHaveBeenCalled();
    expect(findingUpdateSpy).not.toHaveBeenCalled();
  });

  test("a finding of another project, or with nothing to scrub, is not found", async () => {
    findingRow = null;

    const missing: RouteCall = await call(
      DATA_SECURITY_API_ROUTES.scrubFinding(":id"),
      {
        id: STORE_ID.toString(),
      },
    );

    expect((missing.thrown as Exception).message).toBe("Finding not found.");

    findingRow = telemetryFinding(DataStoreKind.TelemetryLogs);
    delete findingRow.location;

    const nowhere: RouteCall = await call(
      DATA_SECURITY_API_ROUTES.scrubFinding(":id"),
      {
        id: STORE_ID.toString(),
      },
    );

    expect((nowhere.thrown as Exception).message).toBe("Finding not found.");
    expect(scrubSpy).not.toHaveBeenCalled();
  });
});

describe("Explain and Fix With AI", () => {
  test("Explain asks OneUptime AI about the issue as the check saw it, and writes the answer to its timeline", async () => {
    const result: RouteCall = await call(
      DATA_SECURITY_API_ROUTES.explainIssue(":id"),
      {
        id: STORE_ID.toString(),
      },
    );

    expect(aiSpy).toHaveBeenCalledTimes(1);

    const request: {
      projectId: ObjectID;
      userId: ObjectID;
      feature: string;
      messages: Array<{ role: string; content: string }>;
      maxTokens: number;
    } = aiSpy.mock.calls[0]![0];

    expect(request.projectId).toBe(PROJECT_ID);
    expect(request.userId).toBe(USER_ID);
    expect(request.feature).toBe("DataSecurityIssueExplanation");
    expect(request.maxTokens).toBe(900);
    expect(request.messages[0]!.role).toBe("system");
    expect(request.messages[1]).toEqual({
      role: "user",
      content: DataSecurityAPI.describeIssue(issueRow!),
    });
    expect(feedSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      dataSecurityIssueId: issueRow!.id,
      eventType: DataSecurityIssueFeedEventType.AiExplanation,
      displayColor: Purple500,
      feedInfoInMarkdown: "OneUptime AI explained this issue.",
      moreInformationInMarkdown: "Turn on Block Public Access.",
      userId: USER_ID,
    });
    expect(result.answer).toEqual({ markdown: "Turn on Block Public Access." });
  });

  test("Explain puts the project's AI context in front of its prompt, so the steps to fix are the team's own", async () => {
    aiContextSpy.mockResolvedValue({
      parts: [
        {
          source: AiContextSource.Project,
          text: "Our buckets are managed with Terraform in the infra repository.",
        },
      ],
      characterCount: 63,
      estimatedTokenCount: 16,
    });

    await call(DATA_SECURITY_API_ROUTES.explainIssue(":id"), {
      id: STORE_ID.toString(),
    });

    expect(aiContextSpy).toHaveBeenCalledWith({ projectId: PROJECT_ID });

    const system: string = (
      aiSpy.mock.calls[0]![0] as {
        messages: Array<{ role: string; content: string }>;
      }
    ).messages[0]!.content;

    expect(system).toContain(
      "Our buckets are managed with Terraform in the infra repository.",
    );
    // The context first, then the explanation's own instructions.
    expect(
      system.indexOf("Our buckets are managed with Terraform"),
    ).toBeLessThan(system.length - 200);
  });

  test("with no AI context, Explain's prompt is its own alone", async () => {
    await call(DATA_SECURITY_API_ROUTES.explainIssue(":id"), {
      id: STORE_ID.toString(),
    });

    const withNone: string = (
      aiSpy.mock.calls[0]![0] as {
        messages: Array<{ role: string; content: string }>;
      }
    ).messages[0]!.content;

    aiContextSpy.mockResolvedValue({
      parts: [{ source: AiContextSource.Project, text: "Notes." }],
      characterCount: 6,
      estimatedTokenCount: 2,
    });

    await call(DATA_SECURITY_API_ROUTES.explainIssue(":id"), {
      id: STORE_ID.toString(),
    });

    const withSome: string = (
      aiSpy.mock.calls[1]![0] as {
        messages: Array<{ role: string; content: string }>;
      }
    ).messages[0]!.content;

    expect(withSome.endsWith(withNone)).toBe(true);
    expect(withSome.length).toBeGreaterThan(withNone.length);
  });

  test("Explain reads the issue without any finding's samples, and only in the caller's project", async () => {
    await call(DATA_SECURITY_API_ROUTES.explainIssue(":id"), {
      id: STORE_ID.toString(),
    });

    const findBy: { query: JSONObject; select: JSONObject } = issueFindOneSpy
      .mock.calls[0]![0] as { query: JSONObject; select: JSONObject };

    expect(findBy.query).toEqual({ _id: STORE_ID, projectId: PROJECT_ID });
    expect(JSON.stringify(findBy.select)).not.toContain("maskedSamples");
    expect(Object.keys(findBy.select).sort()).toEqual([
      "_id",
      "checkId",
      "dataStore",
      "dataTypeIds",
      "evidence",
      "severity",
      "title",
    ]);
  });

  test("a long explanation is answered whole and kept to 20,000 characters on the timeline", async () => {
    aiSpy.mockResolvedValue({ content: "x".repeat(25000) } as never);

    const result: RouteCall = await call(
      DATA_SECURITY_API_ROUTES.explainIssue(":id"),
      {
        id: STORE_ID.toString(),
      },
    );

    expect((result.answer!["markdown"] as string).length).toBe(25000);
    expect(
      (feedSpy.mock.calls[0]![0] as { moreInformationInMarkdown: string })
        .moreInformationInMarkdown,
    ).toHaveLength(20000);
  });

  test("an issue of another project is not found, and OneUptime AI is not asked", async () => {
    issueRow = null;

    const result: RouteCall = await call(
      DATA_SECURITY_API_ROUTES.explainIssue(":id"),
      {
        id: STORE_ID.toString(),
      },
    );

    expect((result.thrown as Exception).message).toBe("Issue not found.");
    expect(aiSpy).not.toHaveBeenCalled();
  });

  test("Fix With AI starts a code task on the project's repository, as the caller, and notes it", async () => {
    const repository: CodeRepository = new CodeRepository(ObjectID.generate());
    repositories = [repository];

    const result: RouteCall = await call(
      DATA_SECURITY_API_ROUTES.fixIssueWithAi(":id"),
      {
        id: STORE_ID.toString(),
      },
    );

    expect(repositoriesSpy.mock.calls[0]![0]).toMatchObject({
      query: { projectId: PROJECT_ID },
      limit: 2,
      props: { isRoot: true },
    });
    expect(codeTaskSpy).toHaveBeenCalledTimes(1);

    const started: {
      projectId: ObjectID;
      userId: ObjectID;
      repository: CodeRepository;
      message: string;
      context: Array<unknown>;
    } = codeTaskSpy.mock.calls[0]![0];

    expect(started.projectId).toBe(PROJECT_ID);
    expect(started.userId).toBe(USER_ID);
    expect(started.repository).toBe(repository);
    expect(started.context).toEqual([]);
    expect(started.message).toContain("Open a pull request.");
    expect(started.message).toContain(DataSecurityAPI.describeIssue(issueRow!));
    expect(feedSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      dataSecurityIssueId: issueRow!.id,
      eventType: DataSecurityIssueFeedEventType.AiFixRequested,
      displayColor: Purple500,
      feedInfoInMarkdown:
        "OneUptime AI was asked to open a fix as a pull request.",
      userId: USER_ID,
    });
    expect(result.answer).toEqual({
      message:
        "OneUptime AI is working on a fix. Its pull request will appear under Code.",
      aiRunId: "77777777-7777-4777-8777-777777777777",
    });
  });

  test("with no repository connected, it says to connect one", async () => {
    const result: RouteCall = await call(
      DATA_SECURITY_API_ROUTES.fixIssueWithAi(":id"),
      {
        id: STORE_ID.toString(),
      },
    );

    expect(result.answer).toEqual({
      message:
        "Connect the repository that holds this store's infrastructure code under Code, then ask again.",
    });
    expect(codeTaskSpy).not.toHaveBeenCalled();
  });

  test("with several repositories and none chosen, it asks which", async () => {
    repositories = [
      new CodeRepository(ObjectID.generate()),
      new CodeRepository(ObjectID.generate()),
    ];

    const result: RouteCall = await call(
      DATA_SECURITY_API_ROUTES.fixIssueWithAi(":id"),
      {
        id: STORE_ID.toString(),
      },
    );

    expect(result.answer).toEqual({
      message:
        "This project has several repositories: choose the one that holds this store's infrastructure code.",
    });
    expect(codeTaskSpy).not.toHaveBeenCalled();
  });

  test("the repository the caller chose is the one asked for", async () => {
    const chosen: ObjectID = ObjectID.generate();
    repositories = [new CodeRepository(chosen)];

    await call(
      DATA_SECURITY_API_ROUTES.fixIssueWithAi(":id"),
      { id: STORE_ID.toString() },
      { codeRepositoryId: chosen.toString() },
    );

    const query: JSONObject = (
      repositoriesSpy.mock.calls[0]![0] as { query: JSONObject }
    ).query;

    expect(query["projectId"]).toBe(PROJECT_ID);
    expect((query["_id"] as ObjectID).toString()).toBe(chosen.toString());
    expect(codeTaskSpy).toHaveBeenCalledTimes(1);
  });

  test("a repository id that is not an id is no choice: with several repositories, it still asks which", async () => {
    repositories = [
      new CodeRepository(ObjectID.generate()),
      new CodeRepository(ObjectID.generate()),
    ];

    const result: RouteCall = await call(
      DATA_SECURITY_API_ROUTES.fixIssueWithAi(":id"),
      { id: STORE_ID.toString() },
      { codeRepositoryId: "infrastructure-repo" },
    );

    expect(result.answer).toEqual({
      message:
        "This project has several repositories: choose the one that holds this store's infrastructure code.",
    });
    expect(codeTaskSpy).not.toHaveBeenCalled();
  });
});

describe("describeIssue", () => {
  test("says what the check saw and how to fix it on the store's cloud, with the store's values filled in", () => {
    const described: string = DataSecurityAPI.describeIssue(issueOf());
    const check: ReturnType<typeof getDataSecurityCheck> =
      getDataSecurityCheck("public-read");

    expect(described.split("\n").slice(0, 8)).toEqual([
      "Issue: Anyone on the internet can read it",
      "Severity: Critical",
      "Store: customer-exports (AWS S3 Bucket, us-east-1)",
      "Cloud id: arn:aws:s3:::customer-exports",
      "Sensitivity: Restricted",
      "Data types found: Card number, custom:loyalty",
      "Evidence: The bucket policy grants s3:GetObject to *.",
      `Why it matters: ${check!.whyItMatters}`,
    ]);
    expect(described).toContain(
      "Suggested fix:\nStep 1: Open the bucket in the S3 console and choose Permissions.",
    );
    expect(described).toContain(
      "CLI: aws s3api put-public-access-block --bucket customer-exports --public-access-block-configuration",
    );
    expect(described).toContain(
      'Terraform:\nresource "aws_s3_bucket_public_access_block" "customer-exports" {',
    );
    expect(described).not.toContain("{name}");
  });

  test("an issue with little recorded still reads plainly, leaving out what it does not know", () => {
    const issue: DataSecurityIssue = new DataSecurityIssue(STORE_ID);
    issue.checkId = "a-check-from-a-later-release";
    issue.severity = SecuritySeverity.Low;

    expect(DataSecurityAPI.describeIssue(issue)).toBe(
      [
        "Issue: a-check-from-a-later-release",
        "Severity: Low",
        "Store: unknown",
        "Sensitivity: unknown",
        "Evidence: none recorded",
      ].join("\n"),
    );
  });
});

describe("the Overview", () => {
  function storeOf(data: {
    kind?: DataStoreKind | undefined;
    sensitivity?: DataSensitivity | undefined;
    sensitivityOverride?: DataSensitivity | undefined;
    dataCategories?: Array<DataCategory> | undefined;
    exposure?: DataStoreExposure | undefined;
    configurationReadAt?: Date | undefined;
    contentScannedAt?: Date | undefined;
  }): DataStore {
    const store: DataStore = new DataStore(ObjectID.generate());
    store.kind = data.kind || DataStoreKind.AwsS3Bucket;

    if (data.sensitivity) {
      store.sensitivity = data.sensitivity;
    }

    if (data.sensitivityOverride) {
      store.sensitivityOverride = data.sensitivityOverride;
    }

    if (data.dataCategories) {
      store.dataCategories = data.dataCategories;
    }

    if (data.exposure) {
      store.exposure = data.exposure;
    }

    if (data.configurationReadAt) {
      store.configurationReadAt = data.configurationReadAt;
    }

    if (data.contentScannedAt) {
      store.contentScannedAt = data.contentScannedAt;
    }

    stores.push(store);
    return store;
  }

  function overviewIssue(data: {
    store: DataStore;
    status: DataSecurityIssueStatus;
    severity: SecuritySeverity;
    riskScore: number;
    openedDaysAgo: number;
    resolvedDaysAgo?: number | undefined;
    title?: string | undefined;
  }): DataSecurityIssue {
    const issue: DataSecurityIssue = new DataSecurityIssue(ObjectID.generate());
    issue.status = data.status;
    issue.severity = data.severity;
    issue.riskScore = data.riskScore;
    issue.title =
      data.title || `${data.severity} issue scoring ${data.riskScore}`;
    issue.checkId = "public-read";
    issue.dataStoreId = data.store.id!;
    const store: DataStore = new DataStore();
    store.name = `store of ${issue.title}`;
    issue.dataStore = store;
    issue.firstDetectedAt = new Date(
      NOW.getTime() - data.openedDaysAgo * DAY_IN_MS,
    );

    if (data.resolvedDaysAgo !== undefined) {
      issue.resolvedAt = new Date(
        NOW.getTime() - data.resolvedDaysAgo * DAY_IN_MS,
      );
    }

    issues.push(issue);
    return issue;
  }

  function findingOf(
    store: DataStore,
    matchCount: number,
    isScrubbed: boolean,
  ): void {
    const finding: DataStoreFinding = new DataStoreFinding();
    finding.dataStoreId = store.id!;
    finding.matchCount = matchCount;
    finding.isScrubbed = isScrubbed;
    findings.push(finding);
  }

  function connectionOf(config: JSONObject | undefined): void {
    const connection: CloudConnection = new CloudConnection(
      ObjectID.generate(),
    );

    if (config) {
      connection.config = config;
    }

    connections.push(connection);
  }

  async function overview(): Promise<DataSecurityOverview> {
    const result: RouteCall = await call(DATA_SECURITY_API_ROUTES.overview);

    expect(result.thrown).toBeUndefined();
    return result.answer as unknown as DataSecurityOverview;
  }

  test("counts the project's stores by sensitivity, category and exposure, and how many were evaluated", async () => {
    storeOf({
      sensitivity: DataSensitivity.Confidential,
      sensitivityOverride: DataSensitivity.Restricted,
      dataCategories: [DataCategory.Financial, DataCategory.ContactAndIdentity],
      exposure: DataStoreExposure.Public,
      configurationReadAt: NOW,
    });
    storeOf({
      sensitivity: DataSensitivity.Confidential,
      dataCategories: [DataCategory.ContactAndIdentity],
      exposure: DataStoreExposure.OtherAccounts,
      contentScannedAt: NOW,
    });
    storeOf({
      kind: DataStoreKind.PostgreSql,
      sensitivity: DataSensitivity.Internal,
      exposure: DataStoreExposure.Public,
      configurationReadAt: NOW,
      contentScannedAt: NOW,
    });
    storeOf({
      sensitivity: DataSensitivity.Confidential,
      dataCategories: [DataCategory.Health],
      exposure: DataStoreExposure.InternetReachable,
    });
    storeOf({ kind: DataStoreKind.TelemetryLogs });

    const answer: DataSecurityOverview = await overview();

    expect(storeFindSpy.mock.calls[0]![0]).toMatchObject({
      query: { projectId: PROJECT_ID, isArchived: false },
      props: { isRoot: true },
    });
    expect(answer.storeCount).toBe(5);
    expect(answer.evaluatedStoreCount).toBe(3);
    expect(answer.contentScannedStoreCount).toBe(2);
    expect(answer.storesBySensitivity).toEqual({
      [DataSensitivity.Restricted]: 1,
      [DataSensitivity.Confidential]: 2,
      [DataSensitivity.Internal]: 1,
      [DataSensitivity.Public]: 1,
    });
    // In the order the Overview lists categories, only those found.
    expect(answer.storesByCategory).toEqual([
      { category: DataCategory.Financial, storeCount: 1 },
      { category: DataCategory.Health, storeCount: 1 },
      { category: DataCategory.ContactAndIdentity, storeCount: 2 },
    ]);
    // Restricted and public, Confidential and shared; Internal and reachable ones are not.
    expect(answer.exposedSensitiveStoreCount).toBe(2);
  });

  test("counts open issues by severity, ranks the five riskiest, and charts 30 days of opened and resolved", async () => {
    const store: DataStore = storeOf({
      sensitivity: DataSensitivity.Restricted,
    });
    const scores: Array<[SecuritySeverity, number]> = [
      [SecuritySeverity.Critical, 95],
      [SecuritySeverity.Critical, 80],
      [SecuritySeverity.High, 70],
      [SecuritySeverity.High, 99],
      [SecuritySeverity.Medium, 40],
      [SecuritySeverity.Low, 10],
    ];

    for (const [index, [severity, riskScore]] of scores.entries()) {
      overviewIssue({
        store,
        status: DataSecurityIssueStatus.Open,
        severity,
        riskScore,
        openedDaysAgo: index,
      });
    }

    overviewIssue({
      store,
      status: DataSecurityIssueStatus.Resolved,
      severity: SecuritySeverity.Critical,
      riskScore: 100,
      openedDaysAgo: 3,
      resolvedDaysAgo: 1,
    });
    overviewIssue({
      store,
      status: DataSecurityIssueStatus.Accepted,
      severity: SecuritySeverity.High,
      riskScore: 98,
      openedDaysAgo: 45,
    });
    overviewIssue({
      store,
      status: DataSecurityIssueStatus.Resolved,
      severity: SecuritySeverity.Low,
      riskScore: 1,
      openedDaysAgo: 60,
      resolvedDaysAgo: 40,
    });

    const answer: DataSecurityOverview = await overview();

    expect(answer.openIssuesBySeverity).toEqual({
      [SecuritySeverity.Critical]: 2,
      [SecuritySeverity.High]: 2,
      [SecuritySeverity.Medium]: 1,
      [SecuritySeverity.Low]: 1,
    });
    expect(
      answer.topIssues.map((issue: { riskScore: number }): number => {
        return issue.riskScore;
      }),
    ).toEqual([99, 95, 80, 70, 40]);
    expect(answer.topIssues[0]).toEqual({
      issueId: issues[3]!.id!.toString(),
      title: "High issue scoring 99",
      severity: SecuritySeverity.High,
      riskScore: 99,
      checkId: "public-read",
      dataStoreId: store.id!.toString(),
      dataStoreName: "store of High issue scoring 99",
    });

    expect(answer.issueTrend).toHaveLength(30);
    expect(answer.issueTrend[0]!.day).toBe("2026-09-28");
    expect(answer.issueTrend[29]!.day).toBe("2026-10-27");

    const byDay: Map<string, { opened: number; resolved: number }> = new Map(
      answer.issueTrend.map(
        (entry: {
          day: string;
          opened: number;
          resolved: number;
        }): [string, { opened: number; resolved: number }] => {
          return [
            entry.day,
            { opened: entry.opened, resolved: entry.resolved },
          ];
        },
      ),
    );

    expect(byDay.get("2026-10-27")).toEqual({ opened: 1, resolved: 0 });
    expect(byDay.get("2026-10-24")).toEqual({ opened: 2, resolved: 0 });
    expect(byDay.get("2026-10-26")).toEqual({ opened: 1, resolved: 1 });
    expect(
      answer.issueTrend.reduce((sum: number, entry: { opened: number }) => {
        return sum + entry.opened;
      }, 0),
    ).toBe(7);
    expect(
      answer.issueTrend.reduce((sum: number, entry: { resolved: number }) => {
        return sum + entry.resolved;
      }, 0),
    ).toBe(1);
  });

  test("counts telemetry findings, and the ones no scrub rule masks", async () => {
    const logs: DataStore = storeOf({ kind: DataStoreKind.TelemetryLogs });
    const traces: DataStore = storeOf({ kind: DataStoreKind.TelemetryTraces });
    const bucket: DataStore = storeOf({ kind: DataStoreKind.AwsS3Bucket });
    findingOf(logs, 4, false);
    findingOf(logs, 2, true);
    findingOf(traces, 9, false);
    findingOf(traces, 0, false);
    findingOf(bucket, 30, false);

    const answer: DataSecurityOverview = await overview();

    expect(findingFindSpy.mock.calls[0]![0]).toMatchObject({
      query: { projectId: PROJECT_ID, isSuppressed: false },
    });
    expect(answer.telemetryFindingCount).toBe(3);
    expect(answer.unscrubbedTelemetryFindingCount).toBe(2);
  });

  test("with no telemetry stores, findings are not read at all", async () => {
    storeOf({ kind: DataStoreKind.AwsS3Bucket });

    const answer: DataSecurityOverview = await overview();

    expect(findingFindSpy).not.toHaveBeenCalled();
    expect(answer.telemetryFindingCount).toBe(0);
    expect(answer.unscrubbedTelemetryFindingCount).toBe(0);
  });

  test("counts the cloud connections that cannot read content yet", async () => {
    connectionOf({ dataSecurity: "content" });
    connectionOf({ dataSecurity: "configuration" });
    connectionOf({ dataSecurity: "off" });
    connectionOf(undefined);

    const answer: DataSecurityOverview = await overview();

    expect(answer.connectionsWithoutContentAccess).toBe(3);
    expect(answer.hasCloudConnection).toBe(true);
  });

  test("an empty project: everything is zero, and it has no cloud connection", async () => {
    const answer: DataSecurityOverview = await overview();

    expect(answer).toMatchObject({
      storeCount: 0,
      evaluatedStoreCount: 0,
      contentScannedStoreCount: 0,
      storesByCategory: [],
      exposedSensitiveStoreCount: 0,
      topIssues: [],
      telemetryFindingCount: 0,
      unscrubbedTelemetryFindingCount: 0,
      connectionsWithoutContentAccess: 0,
      hasCloudConnection: false,
    });
    expect(
      answer.issueTrend.every((entry: { opened: number; resolved: number }) => {
        return entry.opened === 0 && entry.resolved === 0;
      }),
    ).toBe(true);
  });
});

describe("Compliance", () => {
  function storeOf(data: {
    dataTypeIds: Array<string>;
    subjectCountries?: Array<string> | undefined;
    evaluated: boolean;
  }): DataStore {
    const store: DataStore = new DataStore(ObjectID.generate());
    store.dataTypeIds = data.dataTypeIds;

    if (data.subjectCountries) {
      store.subjectCountries = data.subjectCountries;
    }

    if (data.evaluated) {
      store.configurationReadAt = NOW;
    }

    stores.push(store);
    return store;
  }

  function openIssue(store: DataStore, checkId: string): void {
    const issue: DataSecurityIssue = new DataSecurityIssue(ObjectID.generate());
    issue.dataStoreId = store.id!;
    issue.checkId = checkId;
    issues.push(issue);
  }

  test("scores every framework from the project's stores and its open issues", async () => {
    const cards: DataStore = storeOf({
      dataTypeIds: ["credit-card-number", "email-address"],
      evaluated: true,
    });
    const brazil: DataStore = storeOf({
      dataTypeIds: ["br-cpf"],
      subjectCountries: ["BR"],
      evaluated: false,
    });
    storeOf({ dataTypeIds: [], evaluated: true });
    openIssue(cards, "public-read");
    openIssue(brazil, "no-owner");

    const result: RouteCall = await call(DATA_SECURITY_API_ROUTES.compliance);
    const answer: DataSecurityComplianceResponse =
      result.answer as unknown as DataSecurityComplianceResponse;

    expect(issueFindSpy.mock.calls[0]![0]).toMatchObject({
      query: { projectId: PROJECT_ID, status: DataSecurityIssueStatus.Open },
    });

    const storeInputs: Array<ComplianceStoreInput> = stores.map(
      (store: DataStore): ComplianceStoreInput => {
        return {
          id: store.id!.toString(),
          dataTypeIds: store.dataTypeIds || [],
          subjectCountries: store.subjectCountries || [],
          isEvaluated: Boolean(store.configurationReadAt),
        };
      },
    );
    const issueInputs: Array<ComplianceIssueInput> = issues.map(
      (issue: DataSecurityIssue): ComplianceIssueInput => {
        return {
          storeId: issue.dataStoreId!.toString(),
          checkId: issue.checkId!,
        };
      },
    );

    expect(
      answer.frameworks.map((framework: DataSecurityComplianceFramework) => {
        return framework.framework;
      }),
    ).toEqual([...ALL_COMPLIANCE_FRAMEWORKS]);

    for (const framework of answer.frameworks) {
      expect(framework).toEqual({
        ...scoreComplianceFramework(
          framework.framework,
          storeInputs,
          issueInputs,
        ),
        fullName: COMPLIANCE_FRAMEWORK_INFO[framework.framework].fullName,
        scope: COMPLIANCE_FRAMEWORK_INFO[framework.framework].scope,
      });
    }

    const pci: DataSecurityComplianceFramework = answer.frameworks.find(
      (framework: DataSecurityComplianceFramework) => {
        return framework.framework === ComplianceFramework.PCIDSS;
      },
    )!;

    // Only the store with card numbers is in scope; its public bucket fails 7.2.
    expect(pci.storesInScope).toBe(1);
    expect(
      pci.requirements.find((requirement: ComplianceRequirementResult) => {
        return requirement.requirement === "7.2";
      }),
    ).toMatchObject({
      status: ComplianceRequirementStatus.Failing,
      failingIssueCount: 1,
    });
    expect(pci.score).toBe(86);
    expect(pci.fullName).toBe("PCI DSS v4.0");

    const lgpd: DataSecurityComplianceFramework = answer.frameworks.find(
      (framework: DataSecurityComplianceFramework) => {
        return framework.framework === ComplianceFramework.LGPD;
      },
    )!;

    // Brazil's store is in LGPD's scope, but nothing in it was evaluated yet.
    expect(lgpd.storesInScope).toBe(1);
    expect(lgpd.score).toBeNull();
  });

  test("a project with no stores evaluates nothing", async () => {
    const result: RouteCall = await call(DATA_SECURITY_API_ROUTES.compliance);
    const answer: DataSecurityComplianceResponse =
      result.answer as unknown as DataSecurityComplianceResponse;

    for (const framework of answer.frameworks) {
      expect({
        framework: framework.framework,
        score: framework.score,
      }).toEqual({
        framework: framework.framework,
        score: null,
      });
      expect(framework.storesInScope).toBe(0);
    }
  });
});

describe("the record of processing", () => {
  function storeOf(data: {
    name: string;
    dataCategories: Array<DataCategory>;
    dataTypeIds: Array<string>;
    sensitivity?: DataSensitivity | undefined;
    sensitivityOverride?: DataSensitivity | undefined;
  }): DataStore {
    const store: DataStore = new DataStore(ObjectID.generate());
    store.name = data.name;
    store.kind = DataStoreKind.AwsS3Bucket;
    store.provider = "aws";
    store.region = "eu-west-1";
    store.environment = DataStoreEnvironment.Production;
    store.dataCategories = data.dataCategories;
    store.dataTypeIds = data.dataTypeIds;

    if (data.sensitivity) {
      store.sensitivity = data.sensitivity;
    }

    if (data.sensitivityOverride) {
      store.sensitivityOverride = data.sensitivityOverride;
    }

    stores.push(store);
    return store;
  }

  function ownerOf(name: string, email?: string): User {
    const user: User = new User(ObjectID.generate());

    if (name) {
      user.name = new Name(name);
    }

    if (email) {
      user.email = new Email(email);
    }

    return user;
  }

  test("one row per store holding personal data: what it holds, where, whose and under which laws", async () => {
    const crm: DataStore = storeOf({
      name: "crm-exports",
      dataCategories: [DataCategory.ContactAndIdentity, DataCategory.Financial],
      dataTypeIds: ["email-address", "credit-card-number", "custom:loyalty"],
      sensitivity: DataSensitivity.Confidential,
      sensitivityOverride: DataSensitivity.Restricted,
    });
    crm.purpose = "Customer support exports";
    crm.retention = "90 days";
    storeOf({
      name: "secrets-only",
      dataCategories: [DataCategory.SecretsAndCredentials],
      dataTypeIds: ["aws-access-key-id"],
    });
    storeOf({
      name: "board-papers",
      dataCategories: [DataCategory.BusinessConfidential],
      dataTypeIds: ["confidential-document"],
    });
    const nhs: DataStore = storeOf({
      name: "patients",
      dataCategories: [DataCategory.Health],
      dataTypeIds: ["medical-record-number"],
    });

    ownersSpy.mockImplementation(async (dataStoreId: ObjectID) => {
      return dataStoreId.toString() === crm.id!.toString()
        ? [ownerOf("Alice Owner", "alice@acme.io"), ownerOf("", "bob@acme.io")]
        : [];
    });

    const result: RouteCall = await call(
      DATA_SECURITY_API_ROUTES.recordOfProcessing,
    );
    const answer: DataSecurityRecordOfProcessingResponse =
      result.answer as unknown as DataSecurityRecordOfProcessingResponse;

    expect(
      answer.rows.map((row: { name: string }) => {
        return row.name;
      }),
    ).toEqual(["crm-exports", "patients"]);
    expect(answer.rows[0]).toEqual({
      dataStoreId: crm.id!.toString(),
      name: "crm-exports",
      kind: DataStoreKind.AwsS3Bucket,
      provider: "aws",
      region: "eu-west-1",
      environment: DataStoreEnvironment.Production,
      sensitivity: DataSensitivity.Restricted,
      dataCategories: [DataCategory.ContactAndIdentity, DataCategory.Financial],
      dataTypeNames: ["Email address", "Card number", "custom:loyalty"],
      owners: ["Alice Owner", "bob@acme.io"],
      purpose: "Customer support exports",
      retention: "90 days",
      frameworks: [
        ComplianceFramework.GDPR,
        ComplianceFramework.CCPA,
        ComplianceFramework.PCIDSS,
      ],
    });
    expect(answer.rows[1]).toMatchObject({
      dataStoreId: nhs.id!.toString(),
      sensitivity: DataSensitivity.Public,
      dataTypeNames: ["Medical record number"],
      owners: [],
      purpose: "",
      retention: "",
      frameworks: [
        ComplianceFramework.HIPAA,
        ComplianceFramework.GDPR,
        ComplianceFramework.CCPA,
      ],
    });
    expect(
      ownersSpy.mock.calls.map((ownerCall: Array<unknown>): string => {
        return (ownerCall[0] as ObjectID).toString();
      }),
    ).toEqual([crm.id!.toString(), nhs.id!.toString()]);
  });

  test("a project holding no personal data has nothing to record", async () => {
    storeOf({
      name: "secrets-only",
      dataCategories: [DataCategory.SecretsAndCredentials],
      dataTypeIds: ["aws-access-key-id"],
    });
    storeOf({ name: "empty", dataCategories: [], dataTypeIds: [] });

    const result: RouteCall = await call(
      DATA_SECURITY_API_ROUTES.recordOfProcessing,
    );

    expect(result.answer).toEqual({ rows: [] });
    expect(ownersSpy).not.toHaveBeenCalled();
  });
});
