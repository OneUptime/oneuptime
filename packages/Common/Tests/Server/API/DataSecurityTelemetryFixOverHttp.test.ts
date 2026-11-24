jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      getLogLevel: jest.fn().mockReturnValue("INFO"),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import CommonAPI from "../../../Server/API/CommonAPI";
import DataSecurityAPI from "../../../Server/API/DataSecurityAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import DataSecurityIssueService from "../../../Server/Services/DataSecurityIssueService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import DataSecurityIssueCodeFix from "../../../Server/Utils/DataSecurity/DataSecurityIssueCodeFix";
import TelemetryLeakFix from "../../../Server/Utils/DataSecurity/TelemetryLeakFix";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  DATA_SECURITY_API_ROUTES,
  DataSecurityFixResult,
  DataSecurityIssueCodeFixResult,
} from "../../../Types/DataSecurity/DataSecurityApiTypes";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { customDomainCaller } from "./CustomDomainCallers";
import DashboardRequestsOverHttp, {
  SentRequest,
} from "../TestingUtils/DashboardRequestsOverHttp";
import { useInMemoryTable } from "../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { everyServerProductIsOn } from "../TestingUtils/ServerProductsOn";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * A SERVICE'S TELEMETRY FIX THROUGH THE SERVER'S OWN ROUTES, FOR EACH ROLE
 * (#10367).
 *
 * Express, each route's permission list and DataSecurityAPI, over HTTP:
 * the plan Fix with AI shows (fix-plan) is for who may ask for it - who
 * may change the issue; where an issue's fix in code stands (code-fix) is
 * for who may read the issue; and Fix with AI on a service's telemetry
 * issue asks for exactly the plan shown, in the repository picked - the
 * telemetry fix's own path, never the one-issue fix. What each route then
 * does is the telemetry fix's (TelemetryLeakFix, DataSecurityIssueCodeFix),
 * stood in for here: who reaches it is the routes'.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10367000-0000-4000-8000-000000000001",
);
const ISSUE_ID: string = "10367000-0000-4000-8000-0000000000a1";
const STORE_ID: string = "10367000-0000-4000-8000-0000000000b1";
const REPOSITORY_ID: string = "10367000-0000-4000-8000-0000000000c1";
const PERMISSION_MESSAGE: string =
  "You do not have permission to do this in Data Security.";

interface Role {
  name: string;
  permissions: Array<Permission>;
  // May read the issue: where its fix stands.
  reads: boolean;
  // May change the issue: ask for its fix, and see the plan first.
  asks: boolean;
}

const ROLES: Array<Role> = [
  {
    name: "a project owner",
    permissions: [Permission.ProjectOwner],
    reads: true,
    asks: true,
  },
  {
    name: "a project admin",
    permissions: [Permission.ProjectAdmin],
    reads: true,
    asks: true,
  },
  {
    name: "a security admin",
    permissions: [Permission.SecurityAdmin],
    reads: true,
    asks: true,
  },
  {
    name: "a security member",
    permissions: [Permission.SecurityMember],
    reads: true,
    asks: true,
  },
  {
    name: "a security viewer",
    permissions: [Permission.SecurityViewer],
    reads: true,
    asks: false,
  },
  {
    name: "a project member",
    permissions: [Permission.ProjectMember],
    reads: false,
    asks: false,
  },
  {
    name: "a viewer",
    permissions: [Permission.Viewer],
    reads: false,
    asks: false,
  },
];

const asService: <T extends BaseModel>(
  service: unknown,
) => DatabaseService<T> = <T extends BaseModel>(
  service: unknown,
): DatabaseService<T> => {
  return service as DatabaseService<T>;
};

function passSessionGuards(): void {
  jest.spyOn(UserMiddleware, "getUserMiddleware").mockImplementation((async (
    _req: ExpressRequest,
    _res: ExpressResponse,
    next: NextFunction,
  ) => {
    next();
  }) as never);
  jest
    .spyOn(UserMiddleware, "requireUserAuthentication")
    .mockImplementation((async (
      _req: ExpressRequest,
      _res: ExpressResponse,
      next: NextFunction,
    ) => {
      next();
    }) as never);
}

let server: DashboardRequestsOverHttp;
let caller: DatabaseCommonInteractionProps;
let planned: SpyInstance<typeof TelemetryLeakFix.planForIssue>;
let asked: SpyInstance<typeof TelemetryLeakFix.runForIssue>;
let codeFixRead: SpyInstance<typeof DataSecurityIssueCodeFix.read>;

beforeAll(async () => {
  passSessionGuards();
  server = new DashboardRequestsOverHttp();
  await server.start([new DataSecurityAPI().getRouter()]);
});

afterAll(async () => {
  await server.stop();
});

beforeEach(() => {
  server.requests.length = 0;
  everyServerProductIsOn();
  caller = {
    ...customDomainCaller({
      permissions: [Permission.ProjectOwner],
      projectId: PROJECT_ID,
    }),
    ...ON_HIGHEST_PLAN,
  };
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return caller;
    });
  useInMemoryTable(asService(DataSecurityIssueService), [
    {
      _id: ISSUE_ID,
      projectId: PROJECT_ID.toString(),
      title: "Sensitive data is reaching your telemetry",
      checkId: "sensitive-data-in-telemetry",
      severity: "High",
      status: "Open",
      dataStoreId: STORE_ID,
    },
  ]);
  planned = jest.spyOn(TelemetryLeakFix, "planForIssue").mockResolvedValue({
    result: { plan: null, message: "No plan here." },
    plan: null,
  });
  asked = jest.spyOn(TelemetryLeakFix, "runForIssue").mockResolvedValue({
    message:
      "OneUptime AI is working on one pull request for the service's leaks.",
    aiRunId: "10367000-0000-4000-8000-0000000000f1",
  } as DataSecurityFixResult);
  jest
    .spyOn(TelemetryLeakFix, "serviceOfIssue")
    .mockResolvedValue(new ObjectID("10367000-0000-4000-8000-0000000000e1"));
  codeFixRead = jest
    .spyOn(DataSecurityIssueCodeFix, "read")
    .mockResolvedValue({ fix: null } as DataSecurityIssueCodeFixResult);
});

afterEach(() => {
  jest.restoreAllMocks();
  passSessionGuards();
});

async function post(
  route: string,
  body: JSONObject = {},
): Promise<SentRequest> {
  return await server.request("POST", `/api${route}`, body);
}

function as(role: Role): void {
  caller = {
    ...customDomainCaller({
      permissions: role.permissions,
      projectId: PROJECT_ID,
    }),
    ...ON_HIGHEST_PLAN,
  };
}

describe.each(
  ROLES.map((role: Role): [string, Role] => {
    return [role.name, role];
  }),
)("%s", (_name: string, role: Role) => {
  test(
    role.asks
      ? "sees the plan Fix with AI would ask for"
      : "is refused the plan",
    async () => {
      as(role);

      const sent: SentRequest = await post(
        DATA_SECURITY_API_ROUTES.issueFixPlan(ISSUE_ID),
      );

      if (role.asks) {
        expect(sent.status).toBe(200);
        expect(planned).toHaveBeenCalledTimes(1);
        expect(
          (
            planned.mock.calls[0]![0] as { issueId: ObjectID }
          ).issueId.toString(),
        ).toBe(ISSUE_ID);
      } else {
        expect(sent.status).not.toBe(200);
        expect(JSON.stringify(sent.answer)).toContain(PERMISSION_MESSAGE);
        expect(planned).not.toHaveBeenCalled();
      }
    },
  );

  test(
    role.reads
      ? "reads where the issue's fix in code stands"
      : "is refused where the issue's fix stands",
    async () => {
      as(role);

      const sent: SentRequest = await post(
        DATA_SECURITY_API_ROUTES.issueCodeFix(ISSUE_ID),
      );

      if (role.reads) {
        expect(sent.status).toBe(200);
        expect(codeFixRead).toHaveBeenCalledTimes(1);
        // Read as the person, never as OneUptime.
        expect(
          (
            codeFixRead.mock.calls[0]![0] as {
              props: DatabaseCommonInteractionProps;
            }
          ).props.isRoot,
        ).toBeFalsy();
      } else {
        expect(sent.status).not.toBe(200);
        expect(codeFixRead).not.toHaveBeenCalled();
      }
    },
  );
});

describe("Fix with AI on a service's telemetry issue", () => {
  test("asks for exactly the plan shown, in the repository picked, as the person", async () => {
    const sent: SentRequest = await post(
      DATA_SECURITY_API_ROUTES.fixIssueWithAi(ISSUE_ID),
      {
        codeRepositoryId: REPOSITORY_ID,
        expectedPlanFingerprint: "0123456789abcdef",
      },
    );

    expect(sent.status).toBe(200);
    expect(asked).toHaveBeenCalledTimes(1);

    const call: Parameters<typeof TelemetryLeakFix.runForIssue>[0] =
      asked.mock.calls[0]![0];

    expect(call.issueId.toString()).toBe(ISSUE_ID);
    expect(call.codeRepositoryId).toBe(REPOSITORY_ID);
    expect(call.expectedPlanFingerprint).toBe("0123456789abcdef");
    expect(call.props.isRoot).toBeFalsy();
  });

  test("is refused to who may not change the issue, and nothing is asked", async () => {
    as(
      ROLES.find((role: Role): boolean => {
        return role.name === "a security viewer";
      })!,
    );

    const sent: SentRequest = await post(
      DATA_SECURITY_API_ROUTES.fixIssueWithAi(ISSUE_ID),
    );

    expect(sent.status).not.toBe(200);
    expect(asked).not.toHaveBeenCalled();
  });

  test("an issue in no service's telemetry takes the one-issue fix, never the service's", async () => {
    jest.spyOn(TelemetryLeakFix, "serviceOfIssue").mockResolvedValue(null);

    await post(DATA_SECURITY_API_ROUTES.fixIssueWithAi(ISSUE_ID));

    expect(asked).not.toHaveBeenCalled();
  });
});
