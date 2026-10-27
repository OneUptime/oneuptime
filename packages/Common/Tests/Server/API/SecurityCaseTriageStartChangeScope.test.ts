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
 * WHO MAY ASK ONEUPTIME AI TO TRIAGE A SECURITY CASE: POST
 * /security-case/:caseId/ai-triage/start, the case's AI card ("Triage with
 * AI", "Triage again").
 *
 * The triage writes its read on the case as OneUptime - a verdict, a
 * suggested priority and playbook, a report - so the route holds the person
 * to what an update of THAT case is held to (DatabaseService
 * .findOneUpdatableById), not only to holding the case's update permission
 * somewhere in the project and being able to read the case:
 *
 *   - a credential issued for reading only (an MCP client connected
 *     read-only) starts nothing, whatever its roles;
 *   - a case the caller may read but their update scope does not reach (a
 *     change of cases limited to some labels, or a team's block on changing
 *     cases with some labels: the labels of the incident a case names) is
 *     refused;
 *   - a case the caller may not read, or of another project, is not found.
 *
 * The cases table is held in memory and the caller's real permission rows go
 * through the real permission layer. Which cases a label rule reaches is the
 * permission layer's to work out from the incidents' labels, in its own
 * suites; where a test needs a case outside the update scope, that decision
 * stands in for itself. What lies past the decision - whether AI may run,
 * and queueing the run - stands in for itself too.
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
  SECURITY_CASE_CHANGE_REFUSED_MESSAGE,
  SECURITY_CASE_NOT_FOUND_MESSAGE,
} from "../../../Server/API/SecurityCaseAPI";
import SecurityCaseService from "../../../Server/Services/SecurityCaseService";
import SecurityCaseTriage from "../../../Server/Utils/AI/Security/SecurityCaseTriage";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
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
import UserType from "../../../Types/UserType";
import { useInMemoryTable } from "../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";

type MockedFn = ReturnType<typeof jest.fn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "6c2f8e41-3b7a-4d95-9e60-8a1d4c7b2f01",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "6c2f8e41-3b7a-4d95-9e60-8a1d4c7b2f02",
);
const CASE_ID: string = "6c2f8e41-3b7a-4d95-9e60-8a1d4c7b2f03";
const OTHER_PROJECT_CASE_ID: string = "6c2f8e41-3b7a-4d95-9e60-8a1d4c7b2f04";
const RUN_ID: ObjectID = new ObjectID("6c2f8e41-3b7a-4d95-9e60-8a1d4c7b2f05");
const CALLER_USER_ID: ObjectID = new ObjectID(
  "6c2f8e41-3b7a-4d95-9e60-8a1d4c7b2f06",
);

interface Row {
  permission: Permission;
}

// A signed-in member of the project holding exactly these rows, over the whole project.
function caller(
  rows: Array<Row>,
  extra: Partial<DatabaseCommonInteractionProps> = {},
): DatabaseCommonInteractionProps {
  return {
    userId: CALLER_USER_ID,
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
            labelIds: [],
            isBlockPermission: false,
            scope: PermissionScope.All,
          };
        }),
      },
    },
    ...ON_HIGHEST_PLAN,
    ...extra,
  };
}

let props: DatabaseCommonInteractionProps;
let startTriage: MockedFn;

const sendJsonObjectResponseMock: MockedFn =
  Response.sendJsonObjectResponse as unknown as MockedFn;

// The route's answer: what it sent, or what it handed to next.
async function start(
  caseId: string = CASE_ID,
): Promise<{ answer: JSONObject | null; refusal: Exception | null }> {
  const req: ExpressRequest = {
    params: { caseId },
    query: {},
    headers: {},
    body: {},
  } as unknown as ExpressRequest;
  const next: MockedFn = jest.fn();

  sendJsonObjectResponseMock.mockClear();

  await mockRouter
    .match("post", "/security-case/:caseId/ai-triage/start")
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

beforeAll(() => {
  mockRouter.routes.length = 0;
  new SecurityCaseAPI();
});

beforeEach(() => {
  jest.clearAllMocks();

  useInMemoryTable(SecurityCaseService, [
    {
      _id: CASE_ID,
      projectId: PROJECT_ID.toString(),
      caseNumberWithPrefix: "SEC-21",
      title: "Credential stuffing on the sign-in page",
      incidentId: null,
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

  // Past the decision: AI may run, and the run is queued.
  startTriage = jest
    .spyOn(SecurityCaseTriage, "startTriage")
    .mockResolvedValue({ started: true, runId: RUN_ID }) as unknown as MockedFn;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("asking OneUptime AI to triage a case, by whoever may change it", () => {
  test("a Security Member over the whole project starts the triage of the case", async () => {
    props = caller([{ permission: Permission.SecurityMember }]);

    const { answer, refusal } = await start();

    expect(refusal).toBeNull();
    expect(answer).toEqual({ runId: RUN_ID.toString() });
    expect(startTriage).toHaveBeenCalledTimes(1);

    const asked: { projectId: ObjectID; securityCaseId: ObjectID } = startTriage
      .mock.calls[0]![0] as { projectId: ObjectID; securityCaseId: ObjectID };

    expect(asked.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(asked.securityCaseId.toString()).toBe(CASE_ID);
  });

  test("what stops a triage is said, with nothing queued", async () => {
    props = caller([{ permission: Permission.SecurityMember }]);
    startTriage.mockResolvedValue({ started: false, code: "ai_disabled" });

    const { answer, refusal } = await start();

    expect(answer).toBeNull();
    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal!.message).toContain("AI is turned off for this project.");
  });
});

describe("refused, before anything is queued", () => {
  test("a case the caller may read but their update scope does not reach: asked of THAT case, as an update of it would be", async () => {
    // Reads every case, and works cases - but not this one.
    props = caller([
      { permission: Permission.SecurityViewer },
      { permission: Permission.EditSecurityCase },
    ]);
    const updatable: MockedFn = jest
      .spyOn(SecurityCaseService, "findOneUpdatableById")
      .mockResolvedValue(null) as unknown as MockedFn;

    const { answer, refusal } = await start();

    expect(updatable).toHaveBeenCalledTimes(1);

    const asked: { id: ObjectID; props: DatabaseCommonInteractionProps } =
      updatable.mock.calls[0]![0] as {
        id: ObjectID;
        props: DatabaseCommonInteractionProps;
      };

    expect(asked.id.toString()).toBe(CASE_ID);
    expect(asked.props).toBe(props);
    expect(answer).toBeNull();
    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    expect(refusal!.message).toBe(SECURITY_CASE_CHANGE_REFUSED_MESSAGE);
    expect(startTriage).not.toHaveBeenCalled();

    // They may still read it, as its CRUD read lets them.
    await expect(
      SecurityCaseService.findOneById({
        id: new ObjectID(CASE_ID),
        select: { _id: true },
        props,
      }),
    ).resolves.not.toBeNull();
  });

  test("a credential issued for reading only starts nothing, whatever its roles", async () => {
    props = caller([{ permission: Permission.SecurityAdmin }], {
      isReadOnlyCredential: true,
    });

    const { answer, refusal } = await start();

    expect(answer).toBeNull();
    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    expect(refusal!.message).toBe(
      DatabaseCommonInteractionPropsUtil.READ_ONLY_CREDENTIAL_MESSAGE,
    );
    expect(startTriage).not.toHaveBeenCalled();
  });

  test("another project's case is not found", async () => {
    props = caller([{ permission: Permission.SecurityAdmin }]);

    const { answer, refusal } = await start(OTHER_PROJECT_CASE_ID);

    expect(answer).toBeNull();
    expect(refusal).toBeInstanceOf(NotFoundException);
    expect(refusal!.message).toBe(SECURITY_CASE_NOT_FOUND_MESSAGE);
    expect(startTriage).not.toHaveBeenCalled();
  });

  test("a case ID that is not one is refused before any read", async () => {
    props = caller([{ permission: Permission.SecurityMember }]);

    const { answer, refusal } = await start("not-a-case");

    expect(answer).toBeNull();
    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal!.message).toBe("A valid case ID is required.");
    expect(startTriage).not.toHaveBeenCalled();
  });
});
