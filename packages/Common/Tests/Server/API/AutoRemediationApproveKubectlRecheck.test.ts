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
  KubernetesAiAccessGap,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
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
 * The approval-time re-check of a CommandPlan's kubectl commands
 * (Common/Server/API/AutoRemediationAPI.ts, POST /auto-remediation/approve).
 *
 * A plan names the cluster, the Runner and the credential each kubectl
 * command was composed for. Between composition and the Approve click an
 * operator may have switched the cluster's remediation off, re-pointed it
 * at another Runner, swapped its credential, or the agent may have gone
 * offline. CommandPlanExecutor hard-stops on exactly these conditions right
 * before each command runs; the route re-reads the cluster's AI access
 * status so the click itself fails, with the first blocking gap named,
 * instead of claiming the plan and stopping one command in.
 *
 * Pinned here:
 * - a cluster that is gone, not remediation-ready, bound to a different
 *   Runner or reached with a different credential rejects the plan BEFORE
 *   the CAS claim and the executor;
 * - the refusal names the cluster and, for a readiness gap, the gap;
 * - the check runs after the project opt-in and Runner consent re-checks;
 * - a plan whose clusters all still match proceeds to the claim;
 * - each cluster is read once however many commands target it, and
 *   non-kubectl commands never trigger a cluster read.
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

const executeApprovedPlanMock: jest.Mock =
  CommandPlanExecutor.executeApprovedPlan as unknown as jest.Mock;

const sendJsonObjectResponseMock: jest.Mock =
  Response.sendJsonObjectResponse as unknown as jest.Mock;

const APPROVE_ROUTE: string = "/auto-remediation/approve";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SUGGESTION_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const INCIDENT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const RUNNER_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const OTHER_RUNNER_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const CLUSTER_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const OTHER_CLUSTER_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);
const CREDENTIAL_ID: string = "99999999-9999-4999-8999-999999999999";

type RouteCallResult = {
  thrownToNext: unknown;
  nextCallCount: number;
};

function matchRoute(uri: string): MockRoute {
  const route: MockRoute | undefined = mockRoutes.find((route: MockRoute) => {
    return route.method === "POST" && route.uri === uri;
  });

  if (!route) {
    throw new Error(`Route POST ${uri} was never registered`);
  }

  return route;
}

async function callApprove(): Promise<RouteCallResult> {
  const req: ExpressRequest = {
    params: {},
    query: {},
    body: { suggestionId: SUGGESTION_ID.toString() },
    headers: {},
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  const next: jest.Mock = jest.fn();

  await matchRoute(APPROVE_ROUTE).handlerFunction(
    req,
    res,
    next as unknown as NextFunction,
  );

  return {
    thrownToNext: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    nextCallCount: next.mock.calls.length,
  };
}

function buildUserProps(): DatabaseCommonInteractionProps {
  const permissionMap: Dictionary<UserTenantAccessPermission> = {};

  permissionMap[PROJECT_ID.toString()] = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: [Permission.ProjectMember].map((permission: Permission) => {
      const userPermission: UserPermission = {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
      };

      return userPermission;
    }),
  };

  return {
    tenantId: PROJECT_ID,
    userId: USER_ID,
    userType: UserType.User,
    userTenantAccessPermission: permissionMap,
  };
}

// A kubectl command as the planner records it: in-cluster (no credential).
function kubectlCommandJson(
  overrides: Partial<Record<string, unknown>> = {},
): JSONObject {
  return {
    sequence: 1,
    stepType: RunbookStepType.Kubectl,
    runnerId: RUNNER_ID.toString(),
    runnerNameSnapshot: "kubernetes-agent/prod-us",
    kubernetesClusterId: CLUSTER_ID.toString(),
    kubernetesClusterNameSnapshot: "prod-us",
    kubectlTier: KubectlCommandTier.SafeWrite,
    command: "kubectl rollout restart deployment/web -n web",
    timeoutInMs: 60000,
    rationale: "web pods are wedged",
    expectedEffect: "fresh pods serve traffic",
    policyVerdict: "RequiresApproval",
    ...overrides,
  } as JSONObject;
}

function bashCommandJson(
  overrides: Partial<Record<string, unknown>> = {},
): JSONObject {
  return {
    sequence: 1,
    stepType: RunbookStepType.Bash,
    runnerId: OTHER_RUNNER_ID.toString(),
    runnerNameSnapshot: "web-runner-1",
    command: "systemctl restart nginx",
    timeoutInMs: 60000,
    rationale: "nginx workers are wedged",
    expectedEffect: "restores HTTP responses",
    policyVerdict: "RequiresApproval",
    ...overrides,
  } as JSONObject;
}

function fakeProject(): Project {
  return {
    _id: PROJECT_ID.toString(),
    id: PROJECT_ID,
    enableAi: true,
    enableAutoRemediation: true,
    enableAiCommandExecution: true,
  } as unknown as Project;
}

function fakeSuggestion(
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
    ruleNameSnapshot: "Web pods wedged",
  } as unknown as AutoRemediationSuggestion;
}

const REMEDIATION_GAP: KubernetesAiAccessGap = {
  code: "remediation_disabled",
  title: "AI remediation is off for this cluster",
  description: "An operator switched remediation to Disabled.",
  nextStep: "Turn remediation on from the cluster's AI page.",
  blocks: "remediation",
};

const INVESTIGATION_ONLY_GAP: KubernetesAiAccessGap = {
  code: "investigation_disabled",
  title: "AI investigation is off for this cluster",
  description: "Investigation is disabled.",
  nextStep: "Turn investigation on.",
  blocks: "investigation",
};

// The cluster exactly as the plan was composed for it: ready, same Runner, in-cluster.
function readyStatus(
  overrides: Partial<KubernetesClusterAiAccessStatus> = {},
): KubernetesClusterAiAccessStatus {
  return {
    clusterId: CLUSTER_ID.toString(),
    clusterName: "prod-us",
    clusterIdentifier: "prod-us",
    runner: {
      id: RUNNER_ID.toString(),
      name: "kubernetes-agent/prod-us",
      isOnline: true,
      canRunAiCommands: true,
    },
    accessMethod: "in_cluster",
    kubectlAllowlist: [],
    isInvestigationEnabled: true,
    isInvestigationReady: true,
    remediationMode: KubernetesAiRemediationMode.RequireApproval,
    isRemediationReady: true,
    gaps: [],
    evaluatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("POST /auto-remediation/approve — kubectl cluster re-check", () => {
  let suggestionFindSpy: jest.SpyInstance;
  let casSpy: jest.SpyInstance;
  let runnerFindSpy: jest.SpyInstance;
  let statusSpy: jest.SpyInstance;

  beforeAll(async () => {
    /*
     * AutoRemediationAPI registers its routes at module scope, so the import
     * is deferred until the mock router above is fully constructed.
     */
    await import("../../../Server/API/AutoRemediationAPI");
  });

  beforeEach(() => {
    jest.clearAllMocks();

    executeApprovedPlanMock.mockResolvedValue(undefined);

    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(buildUserProps());

    suggestionFindSpy = jest
      .spyOn(AutoRemediationSuggestionService, "findOneById")
      .mockResolvedValue(fakeSuggestion([kubectlCommandJson()]));

    casSpy = jest
      .spyOn(AutoRemediationSuggestionService, "attemptStatusTransition")
      .mockResolvedValue(1);

    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(fakeProject());

    runnerFindSpy = jest.spyOn(RunnerService, "findOneBy").mockResolvedValue({
      _id: RUNNER_ID.toString(),
    } as unknown as Runner);

    statusSpy = jest
      .spyOn(KubernetesClusterAiAccessService, "getStatusForCluster")
      .mockResolvedValue(readyStatus());

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

  function mockCommands(commands: Array<JSONObject>): void {
    suggestionFindSpy.mockResolvedValue(fakeSuggestion(commands));
  }

  function expectRefusedBeforeClaim(result: RouteCallResult): BadDataException {
    expect(result.nextCallCount).toBe(1);
    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect(casSpy).not.toHaveBeenCalled();
    expect(executeApprovedPlanMock).not.toHaveBeenCalled();
    expect(sendJsonObjectResponseMock).not.toHaveBeenCalled();

    return result.thrownToNext as BadDataException;
  }

  test("a plan whose cluster still matches proceeds to the claim, and the status was read for that cluster in this project", async () => {
    const result: RouteCallResult = await callApprove();

    expect(result.nextCallCount).toBe(0);
    expect(statusSpy).toHaveBeenCalledTimes(1);

    const call: { clusterId: ObjectID; projectId: ObjectID } = statusSpy.mock
      .calls[0]![0] as { clusterId: ObjectID; projectId: ObjectID };
    expect(call.clusterId.toString()).toBe(CLUSTER_ID.toString());
    expect(call.projectId.toString()).toBe(PROJECT_ID.toString());

    expect(casSpy).toHaveBeenCalledTimes(1);
    expect(executeApprovedPlanMock).toHaveBeenCalledTimes(1);
  });

  test("rejects when the cluster no longer exists in the project", async () => {
    statusSpy.mockResolvedValue(null);

    const error: BadDataException = expectRefusedBeforeClaim(
      await callApprove(),
    );

    expect(error.message).toContain('"prod-us"');
    expect(error.message).toContain("no longer exists");
  });

  test("rejects when the cluster is no longer remediation-ready, naming the first blocking gap", async () => {
    statusSpy.mockResolvedValue(
      readyStatus({
        isRemediationReady: false,
        remediationMode: KubernetesAiRemediationMode.Disabled,
        gaps: [INVESTIGATION_ONLY_GAP, REMEDIATION_GAP],
      }),
    );

    const error: BadDataException = expectRefusedBeforeClaim(
      await callApprove(),
    );

    expect(error.message).toContain('"prod-us"');
    expect(error.message).toContain("no longer allows AI remediation");
    // The gap that blocks REMEDIATION is the one named, not the investigation-only one.
    expect(error.message).toContain(REMEDIATION_GAP.title);
    expect(error.message).toContain(REMEDIATION_GAP.nextStep);
    expect(error.message).not.toContain(INVESTIGATION_ONLY_GAP.title);
  });

  test("an investigation-only gap does not block a remediation-ready cluster", async () => {
    statusSpy.mockResolvedValue(
      readyStatus({
        isInvestigationReady: false,
        gaps: [INVESTIGATION_ONLY_GAP],
      }),
    );

    const result: RouteCallResult = await callApprove();

    expect(result.nextCallCount).toBe(0);
    expect(casSpy).toHaveBeenCalledTimes(1);
  });

  test("rejects when the cluster is now bound to a different Runner than the plan was composed for", async () => {
    statusSpy.mockResolvedValue(
      readyStatus({
        runner: {
          id: OTHER_RUNNER_ID.toString(),
          name: "kubernetes-agent/prod-us-v2",
          isOnline: true,
          canRunAiCommands: true,
        },
      }),
    );

    const error: BadDataException = expectRefusedBeforeClaim(
      await callApprove(),
    );

    expect(error.message).toContain('"kubernetes-agent/prod-us"');
    expect(error.message).toContain('"kubernetes-agent/prod-us-v2"');
    expect(error.message).toContain("no longer reached through Runner");
  });

  test("rejects when the cluster has no Runner bound any more", async () => {
    statusSpy.mockResolvedValue(
      readyStatus({ runner: null, accessMethod: "none" }),
    );

    const error: BadDataException = expectRefusedBeforeClaim(
      await callApprove(),
    );

    expect(error.message).toContain("no longer reached through Runner");
  });

  test("rejects when the cluster's credential differs from the command's — in either direction", async () => {
    // Plan composed in-cluster; the cluster now uses a credential.
    statusSpy.mockResolvedValue(
      readyStatus({ accessMethod: "credential", credentialId: CREDENTIAL_ID }),
    );

    let error: BadDataException = expectRefusedBeforeClaim(await callApprove());
    expect(error.message).toContain(
      "no longer reached with the credential this plan was composed for",
    );

    // Plan composed with a credential; the cluster now has none (or another).
    jest.clearAllMocks();
    mockCommands([kubectlCommandJson({ credentialId: CREDENTIAL_ID })]);
    statusSpy.mockResolvedValue(readyStatus());

    error = expectRefusedBeforeClaim(await callApprove());
    expect(error.message).toContain(
      "no longer reached with the credential this plan was composed for",
    );

    // Same credential on both sides: fine.
    jest.clearAllMocks();
    statusSpy.mockResolvedValue(
      readyStatus({ accessMethod: "credential", credentialId: CREDENTIAL_ID }),
    );

    const ok: RouteCallResult = await callApprove();
    expect(ok.nextCallCount).toBe(0);
    expect(casSpy).toHaveBeenCalledTimes(1);
  });

  test("a kubectl command that names no cluster never reaches the check — the fail-closed plan parse rejects it first", async () => {
    mockCommands([kubectlCommandJson({ kubernetesClusterId: undefined })]);

    const error: BadDataException = expectRefusedBeforeClaim(
      await callApprove(),
    );

    expect(error.message).toBe(
      "This suggestion has no valid command plan to run.",
    );
    expect(statusSpy).not.toHaveBeenCalled();
  });

  test("reads each cluster once however many commands target it, and never for non-kubectl commands", async () => {
    mockCommands([
      kubectlCommandJson({ sequence: 1 }),
      kubectlCommandJson({
        sequence: 2,
        command: "kubectl rollout status deployment/web -n web",
      }),
      kubectlCommandJson({
        sequence: 3,
        kubernetesClusterId: OTHER_CLUSTER_ID.toString(),
        kubernetesClusterNameSnapshot: "staging-eu",
      }),
      bashCommandJson({ sequence: 4 }),
    ]);
    statusSpy.mockImplementation(
      async (data: {
        clusterId: ObjectID;
      }): Promise<KubernetesClusterAiAccessStatus> => {
        return readyStatus({ clusterId: data.clusterId.toString() });
      },
    );

    const result: RouteCallResult = await callApprove();

    expect(result.nextCallCount).toBe(0);
    expect(statusSpy).toHaveBeenCalledTimes(2);

    const queriedClusterIds: Array<string> = statusSpy.mock.calls.map(
      (call: Array<unknown>) => {
        return (call[0] as { clusterId: ObjectID }).clusterId.toString();
      },
    );
    expect(queriedClusterIds.sort()).toEqual(
      [CLUSTER_ID.toString(), OTHER_CLUSTER_ID.toString()].sort(),
    );
  });

  test("a plan with only Bash commands never reads a cluster status", async () => {
    mockCommands([bashCommandJson()]);

    const result: RouteCallResult = await callApprove();

    expect(result.nextCallCount).toBe(0);
    expect(statusSpy).not.toHaveBeenCalled();
    expect(casSpy).toHaveBeenCalledTimes(1);
  });

  test("the cluster check runs AFTER the Runner consent re-check, and a Runner refusal wins without any status read", async () => {
    runnerFindSpy.mockResolvedValue(null);
    statusSpy.mockResolvedValue(null);

    const error: BadDataException = expectRefusedBeforeClaim(
      await callApprove(),
    );

    expect(error.message).toContain("no longer accepts AI commands");
    expect(statusSpy).not.toHaveBeenCalled();
  });

  test("a refusal names the failing command's position", async () => {
    mockCommands([
      kubectlCommandJson({ sequence: 1 }),
      kubectlCommandJson({
        sequence: 2,
        kubernetesClusterId: OTHER_CLUSTER_ID.toString(),
        kubernetesClusterNameSnapshot: "staging-eu",
      }),
    ]);
    statusSpy.mockImplementation(
      async (data: {
        clusterId: ObjectID;
      }): Promise<KubernetesClusterAiAccessStatus | null> => {
        return data.clusterId.toString() === CLUSTER_ID.toString()
          ? readyStatus()
          : null;
      },
    );

    const error: BadDataException = expectRefusedBeforeClaim(
      await callApprove(),
    );

    expect(error.message).toContain('"staging-eu"');
    expect(error.message).toContain("command 2");
  });
});
