import CommonAPI from "../../../Server/API/CommonAPI";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import AutoRemediationSuggestionService from "../../../Server/Services/AutoRemediationSuggestionService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import KubernetesClusterAiAccessService from "../../../Server/Services/KubernetesClusterAiAccessService";
import ProjectService from "../../../Server/Services/ProjectService";
import RunnerService from "../../../Server/Services/RunnerService";
import CommandPlanExecutor from "../../../Server/Utils/AutoRemediation/CommandPlanExecutor";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import Project from "../../../Models/DatabaseModels/Project";
import Runner from "../../../Models/DatabaseModels/Runner";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import {
  KubectlCommandTier,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * APPROVING A PLAN THAT RUNS WITH A RUNBOOK CREDENTIAL NEEDS THE APPROVER'S
 * READ OF RUNBOOK CREDENTIALS.
 *
 * An SSH command in an AI command plan runs over SSH with one of the
 * credentials assigned to its Runner - the one OneUptime AI picked. The
 * person who approves the plan confirms that pick, so they must be someone
 * who may read runbook credentials (Project Owner, Project Admin or Read
 * Runbook Credential), as naming a credential in a runbook step requires.
 * A plan made by OneUptime AI and approved by a person is held to the
 * person.
 *
 * Pinned here (POST /auto-remediation/approve):
 * - an approver who may start runbooks but not read credentials is refused
 *   a plan with an SSH command, before the claim and the executor, with
 *   the command, the credential and who may approve it named;
 * - an approver who may read credentials - by the permission, as an owner
 *   or admin, as a master admin - is let through;
 * - a block on Read Runbook Credential takes it away, even from an admin;
 * - a plan that runs with no credential (Bash), or a kubectl command that
 *   runs with the credential its cluster's AI page bound, asks nothing more.
 * ---------------------------------------------------------------------------
 */

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

type MockRoute = {
  method: string;
  uri: string;
  middleware: RouterFunction;
  handlerFunction: RouterFunction;
};

type MockRouter = {
  get: jest.Mock;
  post: jest.Mock;
  put: jest.Mock;
  delete: jest.Mock;
};

const mockRoutes: Array<MockRoute> = [];

type RegisterRouteFunction = (
  method: string,
) => (
  uri: string,
  middleware: RouterFunction,
  handlerFunction: RouterFunction,
) => void;

const registerRoute: RegisterRouteFunction = (method: string) => {
  return (
    uri: string,
    middleware: RouterFunction,
    handlerFunction: RouterFunction,
  ): void => {
    mockRoutes.push({
      method: method.toUpperCase(),
      uri,
      middleware,
      handlerFunction,
    });
  };
};

const mockRouter: MockRouter = {
  get: jest.fn().mockImplementation(registerRoute("get")),
  post: jest.fn().mockImplementation(registerRoute("post")),
  put: jest.fn().mockImplementation(registerRoute("put")),
  delete: jest.fn().mockImplementation(registerRoute("delete")),
};

jest.mock("../../../Server/Utils/Express", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/Utils/Express",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      ...((actual["default"] as Record<string, unknown>) || {}),
      getRouter: (): MockRouter => {
        return mockRouter;
      },
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendJsonObjectResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      sendEmptySuccessResponse: jest.fn(),
      sendEntityResponse: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/AutoRemediation/CommandPlanExecutor", () => {
  return {
    __esModule: true,
    default: {
      executeApprovedPlan: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Logger");

const executeApprovedPlanMock: jest.Mock =
  CommandPlanExecutor.executeApprovedPlan as unknown as jest.Mock;

const APPROVE_ROUTE: string = "/auto-remediation/approve";

const PROJECT_ID: ObjectID = new ObjectID(
  "9a000000-0000-4000-8000-000000000001",
);
const SUGGESTION_ID: ObjectID = new ObjectID(
  "9a000000-0000-4000-8000-000000000002",
);
const USER_ID: ObjectID = new ObjectID("9a000000-0000-4000-8000-000000000003");
const INCIDENT_ID: ObjectID = new ObjectID(
  "9a000000-0000-4000-8000-000000000004",
);
const RUNNER_ID: ObjectID = new ObjectID(
  "9a000000-0000-4000-8000-000000000005",
);
const CLUSTER_RUNNER_ID: ObjectID = new ObjectID(
  "9a000000-0000-4000-8000-000000000006",
);
const CLUSTER_ID: ObjectID = new ObjectID(
  "9a000000-0000-4000-8000-000000000007",
);
const CREDENTIAL_ID: string = "9b000000-0000-4000-8000-000000000001";

// Who may read runbook credentials, as the refusal names them.
const CREDENTIAL_READERS: string =
  "Project Owner, Project Admin, Read Runbook Credential";

interface RouteCallResult {
  thrownToNext: unknown;
  nextCallCount: number;
}

async function callApprove(): Promise<RouteCallResult> {
  const route: MockRoute | undefined = mockRoutes.find((route: MockRoute) => {
    return route.method === "POST" && route.uri === APPROVE_ROUTE;
  });

  if (!route) {
    throw new Error(`Route POST ${APPROVE_ROUTE} was never registered`);
  }

  const next: jest.Mock = jest.fn();

  await route.handlerFunction(
    {
      params: {},
      query: {},
      body: { suggestionId: SUGGESTION_ID.toString() },
      headers: {},
    } as unknown as ExpressRequest,
    {
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse,
    next as unknown as NextFunction,
  );

  return {
    thrownToNext: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    nextCallCount: next.mock.calls.length,
  };
}

function approverProps(data: {
  permissions: Array<Permission>;
  blocked?: Array<Permission> | undefined;
  isMasterAdmin?: boolean | undefined;
}): DatabaseCommonInteractionProps {
  const permissionMap: Dictionary<UserTenantAccessPermission> = {};

  permissionMap[PROJECT_ID.toString()] = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: [
      ...data.permissions.map((permission: Permission): UserPermission => {
        return {
          _type: "UserPermission",
          permission: permission,
          labelIds: [],
        };
      }),
      ...(data.blocked || []).map((permission: Permission): UserPermission => {
        return {
          _type: "UserPermission",
          permission: permission,
          labelIds: [],
          isBlockPermission: true,
        };
      }),
    ],
  };

  return {
    tenantId: PROJECT_ID,
    userId: USER_ID,
    userType: UserType.User,
    userTenantAccessPermission: permissionMap,
    ...(data.isMasterAdmin ? { isMasterAdmin: true } : {}),
  };
}

function bashCommandJson(
  overrides: Partial<Record<string, unknown>> = {},
): JSONObject {
  return {
    sequence: 1,
    stepType: RunbookStepType.Bash,
    runnerId: RUNNER_ID.toString(),
    runnerNameSnapshot: "web-runner-1",
    command: "systemctl restart nginx",
    timeoutInMs: 60000,
    rationale: "nginx workers are wedged",
    expectedEffect: "restores HTTP responses",
    policyVerdict: "RequiresApproval",
    ...overrides,
  } as JSONObject;
}

function sshCommandJson(
  overrides: Partial<Record<string, unknown>> = {},
): JSONObject {
  return bashCommandJson({
    stepType: RunbookStepType.SSH,
    credentialId: CREDENTIAL_ID,
    credentialNameSnapshot: "web-hosts",
    command: "sudo systemctl restart nginx",
    ...overrides,
  });
}

// A kubectl command through a Runner, with the credential its cluster binds.
function kubectlCommandJson(): JSONObject {
  return {
    sequence: 1,
    stepType: RunbookStepType.Kubectl,
    runnerId: CLUSTER_RUNNER_ID.toString(),
    runnerNameSnapshot: "cluster-runner",
    kubernetesClusterId: CLUSTER_ID.toString(),
    kubernetesClusterNameSnapshot: "prod-us",
    kubectlTier: KubectlCommandTier.SafeWrite,
    credentialId: CREDENTIAL_ID,
    credentialNameSnapshot: "prod-us kubeconfig",
    command: "kubectl rollout restart deployment/web -n web",
    timeoutInMs: 60000,
    rationale: "web pods are wedged",
    expectedEffect: "fresh pods serve traffic",
    policyVerdict: "RequiresApproval",
  } as JSONObject;
}

function clusterBoundWithTheCredential(): KubernetesClusterAiAccessStatus {
  return {
    clusterId: CLUSTER_ID.toString(),
    clusterName: "prod-us",
    clusterIdentifier: "prod-us",
    runner: {
      id: CLUSTER_RUNNER_ID.toString(),
      name: "cluster-runner",
      isOnline: true,
      canRunAiCommands: true,
    },
    accessMethod: "credential",
    credentialId: CREDENTIAL_ID,
    aiAgent: null,
    automaticInvestigation: { incidents: false, alerts: false },
    kubectlAllowlist: [],
    isInvestigationEnabled: true,
    isInvestigationReady: true,
    remediationMode: KubernetesAiRemediationMode.RequireApproval,
    isRemediationReady: true,
    gaps: [],
    evaluatedAt: "2026-01-01T00:00:00.000Z",
  } as KubernetesClusterAiAccessStatus;
}

function suggestionWith(
  commands: Array<JSONObject>,
): AutoRemediationSuggestion {
  return {
    id: SUGGESTION_ID,
    _id: SUGGESTION_ID.toString(),
    projectId: PROJECT_ID,
    incidentId: INCIDENT_ID,
    status: AutoRemediationSuggestionStatus.Suggested,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    commandPlan: { commands } as JSONObject,
    verificationWindowMinutes: 15,
    ruleNameSnapshot: "Web tier wedged",
  } as unknown as AutoRemediationSuggestion;
}

describe("POST /auto-remediation/approve — a plan that runs with a runbook credential", () => {
  let propsSpy: jest.SpyInstance;
  let suggestionFindSpy: jest.SpyInstance;
  let casSpy: jest.SpyInstance;

  beforeAll(async () => {
    // Routes register at module scope, once the mock router exists.
    await import("../../../Server/API/AutoRemediationAPI");
  });

  beforeEach(() => {
    jest.clearAllMocks();

    executeApprovedPlanMock.mockResolvedValue(undefined);

    // Someone who may start runbooks, and not read credentials.
    propsSpy = jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(
        approverProps({ permissions: [Permission.ProjectMember] }),
      );

    suggestionFindSpy = jest
      .spyOn(AutoRemediationSuggestionService, "findOneById")
      .mockResolvedValue(suggestionWith([sshCommandJson()]));

    casSpy = jest
      .spyOn(AutoRemediationSuggestionService, "attemptStatusTransition")
      .mockResolvedValue(1);

    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      _id: PROJECT_ID.toString(),
      id: PROJECT_ID,
      enableAi: true,
    } as unknown as Project);

    jest.spyOn(RunnerService, "findOneBy").mockResolvedValue({
      _id: RUNNER_ID.toString(),
      name: "web-runner-1",
    } as unknown as Runner);

    jest
      .spyOn(KubernetesClusterAiAccessService, "getStatusForCluster")
      .mockResolvedValue(clusterBoundWithTheCredential());

    jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(AlertFeedService, "createAlertFeedItem")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function approver(data: Parameters<typeof approverProps>[0]): void {
    propsSpy.mockResolvedValue(approverProps(data));
  }

  function expectRefused(result: RouteCallResult): NotAuthorizedException {
    expect(result.nextCallCount).toBe(1);
    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    // Nothing was claimed, nothing ran.
    expect(casSpy).not.toHaveBeenCalled();
    expect(executeApprovedPlanMock).not.toHaveBeenCalled();

    return result.thrownToNext as NotAuthorizedException;
  }

  function expectApproved(result: RouteCallResult): void {
    expect(result.nextCallCount).toBe(0);
    expect(casSpy).toHaveBeenCalledTimes(1);
    expect(executeApprovedPlanMock).toHaveBeenCalledTimes(1);
  }

  test("someone who may start runbooks but not read credentials may not approve an SSH command", async () => {
    const error: NotAuthorizedException = expectRefused(await callApprove());

    expect(error.message).toBe(
      `Command 1 of this plan runs over SSH with the credential "web-hosts", and approving a plan that runs with a runbook credential needs permission to read runbook credentials: ${CREDENTIAL_READERS}. Ask someone who has it to approve the plan, or dismiss the suggestion.`,
    );
  });

  test("names the first command that runs with a credential, in a mixed plan", async () => {
    suggestionFindSpy.mockResolvedValue(
      suggestionWith([
        bashCommandJson({ sequence: 1 }),
        sshCommandJson({ sequence: 2, credentialNameSnapshot: "db-hosts" }),
      ]),
    );

    const error: NotAuthorizedException = expectRefused(await callApprove());

    expect(error.message).toContain(
      'Command 2 of this plan runs over SSH with the credential "db-hosts"',
    );
  });

  test("a credential with no name on record is still refused, without a name", async () => {
    suggestionFindSpy.mockResolvedValue(
      suggestionWith([sshCommandJson({ credentialNameSnapshot: undefined })]),
    );

    const error: NotAuthorizedException = expectRefused(await callApprove());

    expect(error.message).toContain(
      "Command 1 of this plan runs over SSH with a runbook credential",
    );
  });

  test.each([
    [
      "Read Runbook Credential",
      [Permission.ProjectMember, Permission.ReadRunbookCredential],
    ],
    ["Project Admin", [Permission.ProjectAdmin]],
    ["Project Owner", [Permission.ProjectOwner]],
  ])(
    "someone who may read credentials (%s) approves it",
    async (_label: string, permissions: Array<Permission>) => {
      approver({ permissions: permissions });

      expectApproved(await callApprove());
    },
  );

  test("a master admin who may start runbooks approves it", async () => {
    approver({ permissions: [Permission.ProjectMember], isMasterAdmin: true });

    expectApproved(await callApprove());
  });

  test("a block on Read Runbook Credential takes it away, even from an admin", async () => {
    approver({
      permissions: [Permission.ProjectAdmin],
      blocked: [Permission.ReadRunbookCredential],
    });

    expectRefused(await callApprove());
  });

  test("a plan that runs with no credential asks nothing more", async () => {
    suggestionFindSpy.mockResolvedValue(suggestionWith([bashCommandJson()]));

    expectApproved(await callApprove());
  });

  test("a kubectl command runs with the credential its cluster's AI page bound, and asks nothing more", async () => {
    suggestionFindSpy.mockResolvedValue(suggestionWith([kubectlCommandJson()]));

    expectApproved(await callApprove());
  });

  test("the claim records the approver, held to their own read", async () => {
    approver({
      permissions: [Permission.ProjectMember, Permission.ReadRunbookCredential],
    });

    expectApproved(await callApprove());

    const transition: { set: JSONObject } = casSpy.mock.calls[0]![0] as {
      set: JSONObject;
    };
    expect(transition.set["approvedByUserId"]).toBe(USER_ID.toString());
  });
});
