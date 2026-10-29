jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      trace: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import AccessTokenService from "../../../Server/Services/AccessTokenService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import { Service as MonitorProbeServiceType } from "../../../Server/Services/MonitorProbeService";
import { Service as NetworkDeviceServiceType } from "../../../Server/Services/NetworkDeviceService";
import PayAsYouGoBillingService from "../../../Server/Services/PayAsYouGoBillingService";
import ProjectService from "../../../Server/Services/ProjectService";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import TelemetryIngestionKeyService from "../../../Server/Services/TelemetryIngestionKeyService";
import UserService from "../../../Server/Services/UserService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import { OneUptimeRequest } from "../../../Server/Utils/Express";
import FileViewerAccess from "../../../Server/Utils/File/FileViewerAccess";
import McpOAuthGrantAccess, {
  McpOAuthGrantRefusal,
} from "../../../Server/Utils/Mcp/McpOAuthGrantAccess";
import ProjectMembership from "../../../Server/Utils/TeamMember/ProjectMembership";
import VMwareProbeCollectionStore from "../../../Server/Utils/VMware/VMwareProbeCollectionStore";
import WorkspaceActionAuthorization from "../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import Query from "../../../Server/Types/Database/Query";
import Project from "../../../Models/DatabaseModels/Project";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import VMwareVCenter from "../../../Models/DatabaseModels/VMwareVCenter";
import ExceptionMessages from "../../../Types/Exception/ExceptionMessages";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ProjectBlockedException from "../../../Types/Exception/ProjectBlockedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import TelemetryIngestionKeyPolicy from "../../../Types/Telemetry/TelemetryIngestionKeyPolicy";
import {
  CapturedStatement,
  captureClaimStatements,
  normalizeSql,
} from "../TestingUtils/PastDueMonitoringClaimSql";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A BLOCKED PROJECT'S WORK STOPS.
 *
 * Blocking a project (Admin Dashboard > Projects) stops what it does on its
 * own as well as what its members do: its monitors are not handed to probes
 * or swept, its telemetry is not taken in, an MCP client cannot use it, a
 * chat action or a tool import cannot act in it, and its private files are
 * not shown to its members. Everything here reads whether the project is
 * blocked from the row (the monitoring queries) or through the cached
 * ProjectService.isProjectBlocked, stubbed here.
 * ---------------------------------------------------------------------------
 */

const USER_ID: ObjectID = new ObjectID("b5000000-0000-4000-8000-000000000001");
const BLOCKED_PROJECT_ID: ObjectID = new ObjectID(
  "b5000000-0000-4000-8000-0000000000b1",
);
const LIVE_PROJECT_ID: ObjectID = new ObjectID(
  "b5000000-0000-4000-8000-0000000000a1",
);
const PROBE_ID: ObjectID = new ObjectID("b5000000-0000-4000-8000-000000000002");
const TEAM_ID: ObjectID = new ObjectID("b5000000-0000-4000-8000-000000000003");

const tenantPermission: UserTenantAccessPermission = {
  _type: "UserTenantAccessPermission",
  projectId: BLOCKED_PROJECT_ID,
  permissions: [
    {
      _type: "UserPermission",
      permission: Permission.ProjectMember,
      labelIds: [],
    },
  ],
};

let isProjectBlocked: jest.SpyInstance;

beforeEach(() => {
  isProjectBlocked = jest
    .spyOn(ProjectService, "isProjectBlocked")
    .mockImplementation(async (projectId: ObjectID): Promise<boolean> => {
      return projectId.toString() === BLOCKED_PROJECT_ID.toString();
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("monitoring", () => {
  test("a blocked project is not one that is still served", () => {
    const query: Query<Project> = ProjectService.getActiveProjectStatusQuery();

    expect(query.isBlocked).toBe(false);
    // Its subscription rule is kept as it was.
    expect(query.paymentProviderSubscriptionStatus).toBeDefined();
    expect(query.paymentProviderMeteredSubscriptionStatus).toBeDefined();
  });

  const expectClaimSkipsBlockedProjects: (
    statement: CapturedStatement,
  ) => void = (statement: CapturedStatement): void => {
    const sql: string = normalizeSql(statement.sql);

    expect(sql).toContain('INNER JOIN "Project" p');
    expect(sql.split('AND p."isBlocked" = false').length - 1).toBe(1);
  };

  test("the probes' monitor claim hands out no monitor of a blocked project", async () => {
    const service: MonitorProbeServiceType = new MonitorProbeServiceType();
    const statements: Array<CapturedStatement> =
      captureClaimStatements(service);

    await service.claimMonitorProbesForProbing({
      probeId: PROBE_ID,
      limit: 10,
    });

    expectClaimSkipsBlockedProjects(statements[0]!);
  });

  test("the network device poll claim hands out no device of a blocked project", async () => {
    const service: NetworkDeviceServiceType = new NetworkDeviceServiceType();
    const statements: Array<CapturedStatement> =
      captureClaimStatements(service);

    await service.claimDevicesForPolling({ probeId: PROBE_ID, limit: 10 });

    expectClaimSkipsBlockedProjects(statements[0]!);
  });

  test("the VMware collection claim hands out no vCenter of a blocked project", async () => {
    const service: { executeTransaction: unknown } = {
      executeTransaction: async (): Promise<unknown> => {
        return [];
      },
    };
    const statements: Array<CapturedStatement> =
      captureClaimStatements(service);

    await VMwareProbeCollectionStore.claimDueVCenters(
      service as unknown as DatabaseService<VMwareVCenter>,
      { probeId: PROBE_ID, runningVMwareVCenterIds: [], limit: 10 },
    );

    expectClaimSkipsBlockedProjects(statements[0]!);
  });
});

describe("telemetry ingest", () => {
  let requirePayAsYouGo: jest.SpyInstance;

  beforeEach(() => {
    requirePayAsYouGo = jest
      .spyOn(PayAsYouGoBillingService, "requirePayAsYouGo")
      .mockResolvedValue(undefined);
  });

  const keyIn: (
    projectId: ObjectID,
    isEnabled?: boolean,
  ) => TelemetryIngestionKey = (
    projectId: ObjectID,
    isEnabled: boolean = true,
  ): TelemetryIngestionKey => {
    const key: TelemetryIngestionKey = new TelemetryIngestionKey();
    key._id = ObjectID.generate().toString();
    key.projectId = projectId;
    key.isEnabled = isEnabled;
    return key;
  };

  test("a blocked project's key is refused with a 403, before billing is asked", async () => {
    jest
      .spyOn(TelemetryIngestionKeyService, "findOneBy")
      .mockResolvedValue(keyIn(BLOCKED_PROJECT_ID));

    await expect(
      TelemetryIngestionKeyService.getPolicyFromSecretKey(
        ObjectID.generate().toString(),
      ),
    ).rejects.toBeInstanceOf(ProjectBlockedException);

    expect(requirePayAsYouGo).not.toHaveBeenCalled();
  });

  test("is refused on a cache hit too: a block reaches a key already in use", async () => {
    const secret: string = ObjectID.generate().toString();
    jest
      .spyOn(TelemetryIngestionKeyService, "findOneBy")
      .mockResolvedValue(keyIn(BLOCKED_PROJECT_ID));
    isProjectBlocked.mockResolvedValueOnce(false);

    await expect(
      TelemetryIngestionKeyService.getPolicyFromSecretKey(secret),
    ).resolves.not.toBeNull();

    await expect(
      TelemetryIngestionKeyService.getPolicyFromSecretKey(secret),
    ).rejects.toBeInstanceOf(ProjectBlockedException);
  });

  test("a project that is not blocked ingests as before", async () => {
    jest
      .spyOn(TelemetryIngestionKeyService, "findOneBy")
      .mockResolvedValue(keyIn(LIVE_PROJECT_ID));

    const policy: TelemetryIngestionKeyPolicy | null =
      await TelemetryIngestionKeyService.getPolicyFromSecretKey(
        ObjectID.generate().toString(),
      );

    expect(policy?.projectId.toString()).toBe(LIVE_PROJECT_ID.toString());
    expect(requirePayAsYouGo).toHaveBeenCalledTimes(1);
  });

  test("a disabled key still resolves, so its own refusal can be told", async () => {
    jest
      .spyOn(TelemetryIngestionKeyService, "findOneBy")
      .mockResolvedValue(keyIn(BLOCKED_PROJECT_ID, false));

    await expect(
      TelemetryIngestionKeyService.getPolicyFromSecretKey(
        ObjectID.generate().toString(),
      ),
    ).resolves.not.toBeNull();

    expect(isProjectBlocked).not.toHaveBeenCalled();
  });
});

describe("an MCP client's grant", () => {
  beforeEach(() => {
    jest
      .spyOn(AccessTokenService, "getUserTenantAccessPermission")
      .mockResolvedValue(tenantPermission);
  });

  test("is refused for a member of a blocked project", async () => {
    jest.spyOn(ProjectMembership, "isMember").mockResolvedValue(true);

    await expect(
      McpOAuthGrantAccess.getProjectRefusal({
        userId: USER_ID,
        projectId: BLOCKED_PROJECT_ID,
      }),
    ).resolves.toBe(McpOAuthGrantRefusal.ProjectBlocked);
  });

  test("somebody who is not a member is told only that", async () => {
    jest.spyOn(ProjectMembership, "isMember").mockResolvedValue(false);

    await expect(
      McpOAuthGrantAccess.getProjectRefusal({
        userId: USER_ID,
        projectId: BLOCKED_PROJECT_ID,
      }),
    ).resolves.toBe(McpOAuthGrantRefusal.NotAProjectMember);

    expect(isProjectBlocked).not.toHaveBeenCalled();
  });

  test("a member of a project that is not blocked may use it", async () => {
    jest.spyOn(ProjectMembership, "isMember").mockResolvedValue(true);

    await expect(
      McpOAuthGrantAccess.getProjectRefusal({
        userId: USER_ID,
        projectId: LIVE_PROJECT_ID,
      }),
    ).resolves.toBeNull();
  });
});

describe("a chat action or a tool import acting as a member", () => {
  interface AuthorizationInternals {
    getAcceptedTeamIds: (data: {
      userId: ObjectID;
      projectId: ObjectID;
    }) => Promise<Array<ObjectID>>;
  }

  const internals: AuthorizationInternals =
    WorkspaceActionAuthorization as unknown as AuthorizationInternals;

  beforeEach(() => {
    jest
      .spyOn(AccessTokenService, "getUserGlobalAccessPermission")
      .mockResolvedValue(null);
    jest
      .spyOn(AccessTokenService, "getUserTenantAccessPermission")
      .mockResolvedValue(tenantPermission);
    /*
     * The project's plan, which a member's props carry on OneUptime Cloud
     * (billing on, as CI runs): WorkspaceActionPlan.test.ts.
     */
    jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
      plan: PlanType.Growth,
      isSubscriptionUnpaid: false,
    });
    /*
     * The person is not one a master admin blocked: 07d925ca80 asks that
     * first, before any project of theirs is looked at.
     */
    jest.spyOn(UserService, "isUserBlocked").mockResolvedValue(false);
  });

  test("a person a master admin blocked is refused in a live project, before their permissions are read", async () => {
    jest.spyOn(UserService, "isUserBlocked").mockResolvedValue(true);
    jest.spyOn(internals, "getAcceptedTeamIds").mockResolvedValue([TEAM_ID]);

    const refusal: Promise<unknown> =
      WorkspaceActionAuthorization.getProjectMemberProps({
        userId: USER_ID,
        projectId: LIVE_PROJECT_ID,
      });

    await expect(refusal).rejects.toBeInstanceOf(NotAuthorizedException);
    await expect(refusal).rejects.toThrow(ExceptionMessages.UserBlocked);
    expect(
      AccessTokenService.getUserTenantAccessPermission,
    ).not.toHaveBeenCalled();
  });

  /*
   * As a refusal (NotAuthorizedException), which Slack and Microsoft Teams
   * answer in the member's own words; any other error reads "try again".
   */
  test("is refused in a blocked project, in words that say why", async () => {
    jest.spyOn(internals, "getAcceptedTeamIds").mockResolvedValue([TEAM_ID]);

    const refusal: Promise<unknown> =
      WorkspaceActionAuthorization.getProjectMemberProps({
        userId: USER_ID,
        projectId: BLOCKED_PROJECT_ID,
      });

    await expect(refusal).rejects.toBeInstanceOf(NotAuthorizedException);
    await expect(refusal).rejects.toThrow(ExceptionMessages.ProjectBlocked);
  });

  test("somebody who is not a member is told only that", async () => {
    jest.spyOn(internals, "getAcceptedTeamIds").mockResolvedValue([]);

    await expect(
      WorkspaceActionAuthorization.getProjectMemberProps({
        userId: USER_ID,
        projectId: BLOCKED_PROJECT_ID,
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);

    expect(isProjectBlocked).not.toHaveBeenCalled();
  });

  test("a member acts in a project that is not blocked as before", async () => {
    jest.spyOn(internals, "getAcceptedTeamIds").mockResolvedValue([TEAM_ID]);

    await expect(
      WorkspaceActionAuthorization.getProjectMemberProps({
        userId: USER_ID,
        projectId: LIVE_PROJECT_ID,
      }),
    ).resolves.toEqual(
      expect.objectContaining({ userTeamIds: [TEAM_ID] }) as never,
    );
  });
});

describe("a private file of a blocked project", () => {
  interface FileViewerInternals {
    canOpenProject: (data: {
      req: OneUptimeRequest;
      userId: ObjectID;
      projectId: ObjectID;
    }) => Promise<boolean>;
  }

  const internals: FileViewerInternals =
    FileViewerAccess as unknown as FileViewerInternals;

  const request: OneUptimeRequest = {
    headers: {},
    cookies: {},
    userAuthorization: { userId: USER_ID, isMasterAdmin: false },
  } as unknown as OneUptimeRequest;

  beforeEach(() => {
    jest
      .spyOn(ProjectService, "getRequireSsoForLogin")
      .mockResolvedValue(false);
    jest
      .spyOn(GlobalConfigService, "getRequireSsoForLogin")
      .mockResolvedValue(false);
    jest.spyOn(UserService, "isUserBlocked").mockResolvedValue(false);
    jest
      .spyOn(AccessTokenService, "getUserTenantAccessPermission")
      .mockResolvedValue(tenantPermission);
  });

  test("is not shown to its members", async () => {
    await expect(
      internals.canOpenProject({
        req: request,
        userId: USER_ID,
        projectId: BLOCKED_PROJECT_ID,
      }),
    ).resolves.toBe(false);
  });

  test("a file of a project that is not blocked is shown as before", async () => {
    await expect(
      internals.canOpenProject({
        req: request,
        userId: USER_ID,
        projectId: LIVE_PROJECT_ID,
      }),
    ).resolves.toBe(true);
  });
});
