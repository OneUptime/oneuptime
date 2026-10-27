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
 * WHO MAY APPROVE, REJECT OR UNDO A PLAYBOOK RUN'S STEP, through the routes
 * the case page calls:
 *
 *   POST /security-playbook-run/:runId/approve
 *   POST /security-playbook-run/:runId/reject
 *   POST /security-playbook-run/:runId/undo
 *
 * Each is a change of the run that OneUptime then writes as itself -
 * approving lets a containment step suspend an account or isolate a host,
 * undoing releases one - so it is held to what an update of THAT run is
 * held to (DatabaseService.findOneUpdatableById), not only to holding the
 * run's update permission somewhere in the project:
 *
 *   - a change of runs limited to owned ones reaches the runs on cases the
 *     caller owns, and a case has no owners, so it reaches none - however
 *     many runs the caller may read;
 *   - a credential issued for reading only (an MCP client connected
 *     read-only) changes nothing, whatever its roles;
 *   - a run of another project is not found.
 *
 * (A grant limited to labels reaches no run at all, to read or to change: a
 * run is read through its case, and cases carry no labels to hold one to.)
 *
 * Nothing is stubbed between the route and the runs table but the table
 * itself, held in memory: the caller's real permission rows go through the
 * real permission layer. What lies past the decision - the write of the
 * decision, the queue, the case's timeline, the audit log and the product a
 * step contained a target in - stands in for itself.
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
import SecurityPlaybookRunAPI, {
  RUN_CHANGE_REFUSED_MESSAGE,
  RUN_NOT_FOUND_MESSAGE,
} from "../../../Server/API/SecurityPlaybookRunAPI";
import AuditLogService from "../../../Server/Services/AuditLogService";
import SecurityCaseFeedService from "../../../Server/Services/SecurityCaseFeedService";
import SecurityCaseService from "../../../Server/Services/SecurityCaseService";
import SecurityEventConnectionService from "../../../Server/Services/SecurityEventConnectionService";
import SecurityPlaybookRunService from "../../../Server/Services/SecurityPlaybookRunService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import SecurityPlaybookContainment from "../../../Server/Utils/SecurityPlaybook/SecurityPlaybookContainment";
import SecurityPlaybookEngine from "../../../Server/Utils/SecurityPlaybook/SecurityPlaybookEngine";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import SecurityEventConnection from "../../../Models/DatabaseModels/SecurityEventConnection";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil from "../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Exception from "../../../Types/Exception/Exception";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import { SecurityPlaybookActionType } from "../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import SecurityPlaybookRunStatus, {
  SecurityPlaybookStepStatus,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import { SecurityPlaybookStep } from "../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import {
  SecurityPlaybookStepResult,
  SecurityPlaybookTargetReason,
  SecurityPlaybookTargetState,
  buildPendingStepResults,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import UserType from "../../../Types/UserType";
import { useInMemoryTable } from "../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";

type MockedFn = ReturnType<typeof jest.fn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "3b1e7a40-5c2d-4e8f-9a61-7d0c2b4e6f01",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "3b1e7a40-5c2d-4e8f-9a61-7d0c2b4e6f02",
);
const CASE_ID: ObjectID = new ObjectID("3b1e7a40-5c2d-4e8f-9a61-7d0c2b4e6f03");
const WAITING_RUN_ID: string = "3b1e7a40-5c2d-4e8f-9a61-7d0c2b4e6f04";
const FINISHED_RUN_ID: string = "3b1e7a40-5c2d-4e8f-9a61-7d0c2b4e6f05";
const OTHER_PROJECT_RUN_ID: string = "3b1e7a40-5c2d-4e8f-9a61-7d0c2b4e6f06";
const STARTED_BY_USER_ID: ObjectID = new ObjectID(
  "3b1e7a40-5c2d-4e8f-9a61-7d0c2b4e6f07",
);
const CALLER_USER_ID: ObjectID = new ObjectID(
  "3b1e7a40-5c2d-4e8f-9a61-7d0c2b4e6f08",
);
const CONNECTION_ID: string = "3b1e7a40-5c2d-4e8f-9a61-7d0c2b4e6f0a";

const SUSPENDED_USER: string = "mallory@acme.com";

const STEP: SecurityPlaybookStep = {
  id: "s1",
  action: SecurityPlaybookActionType.SuspendOktaUser,
  config: { connectionId: CONNECTION_ID },
  requiresApproval: true,
  continueOnFailure: false,
  onlyIfThreatIntelMatched: false,
};

type Route = "approve" | "reject" | "undo";

interface Row {
  permission: Permission;
  scope?: PermissionScope | undefined;
}

// A signed-in member of the project holding exactly these rows.
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
            scope: row.scope || PermissionScope.All,
          };
        }),
      },
    },
    ...ON_HIGHEST_PLAN,
    ...extra,
  };
}

function waitingStepResults(): JSONArray {
  const results: Array<SecurityPlaybookStepResult> = buildPendingStepResults([
    STEP,
  ]);
  results[0]!.status = SecurityPlaybookStepStatus.WaitingForApproval;
  results[0]!.targets = [
    {
      type: SecurityEntityType.User,
      value: SUSPENDED_USER,
      reason: SecurityPlaybookTargetReason.GroupedOn,
      state: SecurityPlaybookTargetState.Proposed,
    },
  ];
  return results as unknown as JSONArray;
}

function containedStepResults(): JSONArray {
  const results: Array<SecurityPlaybookStepResult> = buildPendingStepResults([
    STEP,
  ]);
  results[0]!.status = SecurityPlaybookStepStatus.Succeeded;
  results[0]!.targets = [
    {
      type: SecurityEntityType.User,
      value: SUSPENDED_USER,
      reason: SecurityPlaybookTargetReason.GroupedOn,
      state: SecurityPlaybookTargetState.Done,
      detail: "suspended",
    },
  ];
  return results as unknown as JSONArray;
}

function runRows(): Array<Record<string, unknown>> {
  const run: (data: {
    id: string;
    projectId: ObjectID;
    status: SecurityPlaybookRunStatus;
    stepResults: JSONArray;
    currentStepIndex: number;
  }) => Record<string, unknown> = (data: {
    id: string;
    projectId: ObjectID;
    status: SecurityPlaybookRunStatus;
    stepResults: JSONArray;
    currentStepIndex: number;
  }): Record<string, unknown> => {
    return {
      _id: data.id,
      projectId: data.projectId.toString(),
      securityCaseId: CASE_ID.toString(),
      playbookName: "Contain",
      status: data.status,
      steps: [STEP],
      stepResults: data.stepResults,
      currentStepIndex: data.currentStepIndex,
      triggeredByUserId: STARTED_BY_USER_ID.toString(),
    };
  };

  return [
    run({
      id: WAITING_RUN_ID,
      projectId: PROJECT_ID,
      status: SecurityPlaybookRunStatus.WaitingForApproval,
      stepResults: waitingStepResults(),
      currentStepIndex: 0,
    }),
    run({
      id: FINISHED_RUN_ID,
      projectId: PROJECT_ID,
      status: SecurityPlaybookRunStatus.Succeeded,
      stepResults: containedStepResults(),
      currentStepIndex: 1,
    }),
    run({
      id: OTHER_PROJECT_RUN_ID,
      projectId: OTHER_PROJECT_ID,
      status: SecurityPlaybookRunStatus.WaitingForApproval,
      stepResults: waitingStepResults(),
      currentStepIndex: 0,
    }),
  ];
}

let props: DatabaseCommonInteractionProps;
let compareAndSet: MockedFn;
let enqueue: MockedFn;
let feed: MockedFn;
let audit: MockedFn;
let containmentUndo: MockedFn;

const sendJsonObjectResponseMock: MockedFn =
  Response.sendJsonObjectResponse as unknown as MockedFn;

// The route's answer: what it sent, or what it handed to next.
async function press(
  route: Route,
  runId: string,
): Promise<{ answer: JSONObject | null; refusal: Exception | null }> {
  const req: ExpressRequest = {
    params: { runId },
    query: {},
    headers: {},
    body: route === "undo" ? { stepId: STEP.id, value: SUSPENDED_USER } : {},
  } as unknown as ExpressRequest;
  const next: MockedFn = jest.fn();

  sendJsonObjectResponseMock.mockClear();

  await mockRouter
    .match("post", `/security-playbook-run/:runId/${route}`)
    .handlerFunction(
      req,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

  const answer: JSONObject | null = sendJsonObjectResponseMock.mock.calls[0]
    ? (sendJsonObjectResponseMock.mock.calls[0][2] as JSONObject)
    : null;

  return {
    answer,
    refusal: (next.mock.calls[0]?.[0] as Exception | undefined) || null,
  };
}

function runOf(route: Route): string {
  return route === "undo" ? FINISHED_RUN_ID : WAITING_RUN_ID;
}

function expectNothingDone(): void {
  expect(compareAndSet).not.toHaveBeenCalled();
  expect(enqueue).not.toHaveBeenCalled();
  expect(feed).not.toHaveBeenCalled();
  expect(audit).not.toHaveBeenCalled();
  expect(containmentUndo).not.toHaveBeenCalled();
}

beforeAll(() => {
  mockRouter.routes.length = 0;
  new SecurityPlaybookRunAPI();
});

beforeEach(() => {
  jest.clearAllMocks();

  useInMemoryTable(SecurityPlaybookRunService, runRows());

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return props;
    });

  compareAndSet = jest
    .spyOn(SecurityPlaybookRunService, "compareAndSetColumnsByIdWithoutHooks")
    .mockResolvedValue(true as never) as unknown as MockedFn;
  enqueue = jest
    .spyOn(SecurityPlaybookEngine, "enqueueRun")
    .mockResolvedValue(undefined as never) as unknown as MockedFn;
  feed = jest
    .spyOn(SecurityCaseFeedService, "createSecurityCaseFeedItem")
    .mockResolvedValue(undefined as never) as unknown as MockedFn;
  audit = jest
    .spyOn(AuditLogService, "recordUpdate")
    .mockResolvedValue(undefined as never) as unknown as MockedFn;

  // The product the step contained the account in: releasing it works.
  const okta: SecurityEventConnection = new SecurityEventConnection();
  okta._id = CONNECTION_ID;
  okta.name = "Okta";
  jest
    .spyOn(SecurityEventConnectionService, "findOneBy")
    .mockResolvedValue(okta as never);
  jest
    .spyOn(SecurityEventConnectionService, "getConnectorSettings")
    .mockResolvedValue({} as never);
  const securityCase: SecurityCase = new SecurityCase();
  securityCase.caseNumberWithPrefix = "CASE-7";
  jest
    .spyOn(SecurityCaseService, "findOneById")
    .mockResolvedValue(securityCase as never);
  containmentUndo = jest
    .spyOn(SecurityPlaybookContainment, "undo")
    .mockResolvedValue({
      state: SecurityPlaybookTargetState.Done,
      detail: "unsuspended",
    } as never) as unknown as MockedFn;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("approving, rejecting and undoing, by whoever may change the run", () => {
  test("a Security Member over the whole project approves: the decision is written and the run queued", async () => {
    props = caller([{ permission: Permission.SecurityMember }]);

    const { answer, refusal } = await press("approve", WAITING_RUN_ID);

    expect(refusal).toBeNull();
    expect(answer).toEqual({ runId: WAITING_RUN_ID, decision: "Approved" });
    expect(compareAndSet).toHaveBeenCalledTimes(1);
    expect(
      String(
        (compareAndSet.mock.calls[0]![0] as { id: ObjectID }).id.toString(),
      ),
    ).toBe(WAITING_RUN_ID);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  test("a Security Member over the whole project rejects", async () => {
    props = caller([{ permission: Permission.SecurityMember }]);

    const { answer, refusal } = await press("reject", WAITING_RUN_ID);

    expect(refusal).toBeNull();
    expect(answer).toEqual({ runId: WAITING_RUN_ID, decision: "Rejected" });
    expect(compareAndSet).toHaveBeenCalledTimes(1);
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("a Security Member over the whole project undoes a contained target", async () => {
    props = caller([{ permission: Permission.SecurityMember }]);

    const { answer, refusal } = await press("undo", FINISHED_RUN_ID);

    expect(refusal).toBeNull();
    expect(answer).toMatchObject({
      runId: FINISHED_RUN_ID,
      value: SUSPENDED_USER,
      state: SecurityPlaybookTargetState.Undone,
    });
    expect(containmentUndo).toHaveBeenCalledTimes(1);
    expect(compareAndSet).toHaveBeenCalledTimes(1);
  });
});

describe("refused, before anything is decided, undone or written", () => {
  describe.each([
    [
      "a reader of every run whose Security Member role is scoped to owned records",
      [
        { permission: Permission.SecurityViewer },
        {
          permission: Permission.SecurityMember,
          scope: PermissionScope.Owned,
        },
      ],
    ],
    [
      "Read Security Case and Read Security Playbook Run over the project, Edit Security Playbook Run on owned runs",
      [
        { permission: Permission.ReadSecurityCase },
        { permission: Permission.ReadSecurityPlaybookRun },
        {
          permission: Permission.EditSecurityPlaybookRun,
          scope: PermissionScope.Owned,
        },
      ],
    ],
  ] as Array<[string, Array<Row>]>)("%s", (_who: string, rows: Array<Row>) => {
    test.each(["approve", "reject", "undo"] as Array<Route>)(
      "may not %s: a change of runs limited to owned ones reaches none, as a case has no owners",
      async (route: Route) => {
        props = caller(rows);

        const { answer, refusal } = await press(route, runOf(route));

        expect(answer).toBeNull();
        expect(refusal).toBeInstanceOf(NotAuthorizedException);
        expect(refusal!.message).toBe(RUN_CHANGE_REFUSED_MESSAGE);
        expectNothingDone();
      },
    );

    test("may still read the run, as its CRUD read lets them", async () => {
      await expect(
        SecurityPlaybookRunService.findOneById({
          id: new ObjectID(WAITING_RUN_ID),
          select: { _id: true },
          props: caller(rows),
        }),
      ).resolves.not.toBeNull();
    });
  });

  test.each(["approve", "reject", "undo"] as Array<Route>)(
    "a credential issued for reading only may not %s, whatever its roles",
    async (route: Route) => {
      props = caller([{ permission: Permission.SecurityAdmin }], {
        isReadOnlyCredential: true,
      });

      const { answer, refusal } = await press(route, runOf(route));

      expect(answer).toBeNull();
      expect(refusal).toBeInstanceOf(NotAuthorizedException);
      expect(refusal!.message).toBe(
        DatabaseCommonInteractionPropsUtil.READ_ONLY_CREDENTIAL_MESSAGE,
      );
      expectNothingDone();
    },
  );

  test.each(["approve", "reject"] as Array<Route>)(
    "a run of another project is not found (%s)",
    async (route: Route) => {
      props = caller([{ permission: Permission.SecurityAdmin }]);

      const { answer, refusal } = await press(route, OTHER_PROJECT_RUN_ID);

      expect(answer).toBeNull();
      expect(refusal).toBeInstanceOf(NotFoundException);
      expect(refusal!.message).toBe(RUN_NOT_FOUND_MESSAGE);
      expectNothingDone();
    },
  );
});
