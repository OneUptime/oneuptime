import AutoRechargeStateRequest from "../../../../Server/Utils/Billing/AutoRechargeStateRequest";
import AIBillingService from "../../../../Server/Services/AIBillingService";
import NotificationService from "../../../../Server/Services/NotificationService";
import ProjectService from "../../../../Server/Services/ProjectService";
import { OneUptimeRequest } from "../../../../Server/Utils/Express";
import Project from "../../../../Models/DatabaseModels/Project";
import AutoRechargeState from "../../../../Types/Billing/AutoRechargeState";
import ProjectBalanceType from "../../../../Types/Billing/ProjectBalanceType";
import Dictionary from "../../../../Types/Dictionary";
import BadDataException from "../../../../Types/Exception/BadDataException";
import JSONWebTokenData from "../../../../Types/JsonWebTokenData";
import ObjectID from "../../../../Types/ObjectID";
import { UserTenantAccessPermission } from "../../../../Types/Permission";
import { setTestBillingEnabled } from "../../Enterprise/TestBillingFlag";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * AutoRechargeStateRequest - what Auto Recharge of one of the project's
 * prepaid balances would do now, for GET /notification/auto-recharge-state
 * and GET /ai/auto-recharge-state.
 *
 * Its contract: asked about the request's tenant, by a member of it or a
 * master admin - anybody else learns nothing, not even whether the project
 * exists (the access check comes before any read). Without billing there is
 * no Auto Recharge (Off, nothing read). With billing, the balance's own
 * columns are read as root and the balance's own service decides.
 *
 * Billing is pinned per test (TestBillingFlag): CI's config.env turns it on,
 * local runs do not.
 */

jest.mock("../../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../../Enterprise/TestBillingFlag",
    ) as typeof import("../../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

const PROJECT_ID: ObjectID = new ObjectID(
  "7e000000-0000-4000-8000-0000000000a1",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "7e000000-0000-4000-8000-0000000000a2",
);

const SMS_OR_CALL_SELECT: Record<string, boolean> = {
  enableAutoRechargeSmsOrCallBalance: true,
  autoRechargeSmsOrCallByBalanceInUSD: true,
  autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: true,
};

const AI_SELECT: Record<string, boolean> = {
  enableAutoRechargeAiBalance: true,
  autoAiRechargeByBalanceInUSD: true,
  autoRechargeAiWhenCurrentBalanceFallsInUSD: true,
};

function membershipOf(
  projectId: ObjectID,
): Dictionary<UserTenantAccessPermission> {
  return {
    [projectId.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: projectId,
      permissions: [],
    } as UserTenantAccessPermission,
  };
}

function makeRequest(options: {
  tenantId?: ObjectID | undefined;
  memberOf?: Array<ObjectID> | undefined;
  isMasterAdmin?: boolean | undefined;
}): OneUptimeRequest {
  const permissions: Dictionary<UserTenantAccessPermission> = {};

  for (const projectId of options.memberOf || []) {
    Object.assign(permissions, membershipOf(projectId));
  }

  return {
    tenantId: options.tenantId,
    userTenantAccessPermission: permissions,
    userAuthorization:
      options.isMasterAdmin === undefined
        ? undefined
        : ({
            isMasterAdmin: options.isMasterAdmin,
          } as unknown as JSONWebTokenData),
  } as unknown as OneUptimeRequest;
}

async function captureError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }

  throw new Error("Expected the request to be refused, and it was not.");
}

describe("AutoRechargeStateRequest.getState", () => {
  let findOneById: jest.SpiedFunction<typeof ProjectService.findOneById>;
  let aiState: jest.SpiedFunction<typeof AIBillingService.getAutoRechargeState>;
  let smsOrCallState: jest.SpiedFunction<
    typeof NotificationService.getAutoRechargeState
  >;
  let project: Project;

  beforeEach(() => {
    setTestBillingEnabled(true);

    project = new Project();
    project.id = PROJECT_ID;

    findOneById = jest
      .spyOn(ProjectService, "findOneById")
      .mockImplementation(async (): Promise<Project | null> => {
        return project;
      });
    aiState = jest
      .spyOn(AIBillingService, "getAutoRechargeState")
      .mockResolvedValue(AutoRechargeState.Ready);
    smsOrCallState = jest
      .spyOn(NotificationService, "getAutoRechargeState")
      .mockResolvedValue(AutoRechargeState.Failed);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    setTestBillingEnabled(false);
  });

  describe("who may ask", () => {
    test("a request without a project is refused before anything is read", async () => {
      const err: Error = await captureError(
        AutoRechargeStateRequest.getState({
          req: makeRequest({ memberOf: [PROJECT_ID], isMasterAdmin: true }),
          balance: ProjectBalanceType.SmsOrCall,
        }),
      );

      expect(err).toBeInstanceOf(BadDataException);
      expect(err.message).toBe("Project ID is required");
      expect(findOneById).not.toHaveBeenCalled();
    });

    test.each([ProjectBalanceType.SmsOrCall, ProjectBalanceType.AI])(
      "%s: somebody who is not a member learns nothing - not even whether the project exists",
      async (balance: ProjectBalanceType) => {
        const err: Error = await captureError(
          AutoRechargeStateRequest.getState({
            req: makeRequest({
              tenantId: PROJECT_ID,
              isMasterAdmin: false,
            }),
            balance,
          }),
        );

        expect(err).toBeInstanceOf(BadDataException);
        expect(err.message).toBe("You do not have access to this project");
        expect(findOneById).not.toHaveBeenCalled();
        expect(aiState).not.toHaveBeenCalled();
        expect(smsOrCallState).not.toHaveBeenCalled();
      },
    );

    test("membership of another project does not count for this one", async () => {
      const err: Error = await captureError(
        AutoRechargeStateRequest.getState({
          req: makeRequest({
            tenantId: PROJECT_ID,
            memberOf: [OTHER_PROJECT_ID],
          }),
          balance: ProjectBalanceType.SmsOrCall,
        }),
      );

      expect(err.message).toBe("You do not have access to this project");
      expect(findOneById).not.toHaveBeenCalled();
    });

    test("a request with no user at all is refused", async () => {
      const err: Error = await captureError(
        AutoRechargeStateRequest.getState({
          req: makeRequest({ tenantId: PROJECT_ID }),
          balance: ProjectBalanceType.AI,
        }),
      );

      expect(err.message).toBe("You do not have access to this project");
    });

    test("the refusal comes before the billing switch: without billing a stranger is still refused, not told Off", async () => {
      setTestBillingEnabled(false);

      const err: Error = await captureError(
        AutoRechargeStateRequest.getState({
          req: makeRequest({ tenantId: PROJECT_ID }),
          balance: ProjectBalanceType.SmsOrCall,
        }),
      );

      expect(err.message).toBe("You do not have access to this project");
    });

    test("a member of the project may ask", async () => {
      await expect(
        AutoRechargeStateRequest.getState({
          req: makeRequest({ tenantId: PROJECT_ID, memberOf: [PROJECT_ID] }),
          balance: ProjectBalanceType.SmsOrCall,
        }),
      ).resolves.toBe(AutoRechargeState.Failed);
    });

    test("a master admin who is not a member may ask", async () => {
      await expect(
        AutoRechargeStateRequest.getState({
          req: makeRequest({ tenantId: PROJECT_ID, isMasterAdmin: true }),
          balance: ProjectBalanceType.AI,
        }),
      ).resolves.toBe(AutoRechargeState.Ready);
    });
  });

  describe("where OneUptime does not bill", () => {
    test.each([ProjectBalanceType.SmsOrCall, ProjectBalanceType.AI])(
      "%s: Off, without reading the project or asking the balance's service",
      async (balance: ProjectBalanceType) => {
        setTestBillingEnabled(false);

        await expect(
          AutoRechargeStateRequest.getState({
            req: makeRequest({ tenantId: PROJECT_ID, memberOf: [PROJECT_ID] }),
            balance,
          }),
        ).resolves.toBe(AutoRechargeState.Off);

        expect(findOneById).not.toHaveBeenCalled();
        expect(aiState).not.toHaveBeenCalled();
        expect(smsOrCallState).not.toHaveBeenCalled();
      },
    );
  });

  describe("the messaging balance (SMS, calls, WhatsApp, Telegram)", () => {
    test("reads only its own Auto Recharge columns, as root, and lets NotificationService decide", async () => {
      const state: AutoRechargeState = await AutoRechargeStateRequest.getState({
        req: makeRequest({ tenantId: PROJECT_ID, memberOf: [PROJECT_ID] }),
        balance: ProjectBalanceType.SmsOrCall,
      });

      expect(state).toBe(AutoRechargeState.Failed);
      expect(findOneById).toHaveBeenCalledTimes(1);
      expect(findOneById).toHaveBeenCalledWith({
        id: PROJECT_ID,
        select: SMS_OR_CALL_SELECT,
        props: { isRoot: true },
      });
      expect(smsOrCallState).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        project: project,
      });
      expect(aiState).not.toHaveBeenCalled();
    });

    test.each([
      AutoRechargeState.Off,
      AutoRechargeState.Ready,
      AutoRechargeState.Failed,
    ])(
      "passes on %s as NotificationService says it",
      async (expected: AutoRechargeState) => {
        smsOrCallState.mockResolvedValue(expected);

        await expect(
          AutoRechargeStateRequest.getState({
            req: makeRequest({ tenantId: PROJECT_ID, memberOf: [PROJECT_ID] }),
            balance: ProjectBalanceType.SmsOrCall,
          }),
        ).resolves.toBe(expected);
      },
    );

    test("a project that is gone is refused, and NotificationService is not asked", async () => {
      findOneById.mockImplementation(async (): Promise<Project | null> => {
        return null;
      });

      const err: Error = await captureError(
        AutoRechargeStateRequest.getState({
          req: makeRequest({ tenantId: PROJECT_ID, memberOf: [PROJECT_ID] }),
          balance: ProjectBalanceType.SmsOrCall,
        }),
      );

      expect(err).toBeInstanceOf(BadDataException);
      expect(err.message).toBe("Project not found");
      expect(smsOrCallState).not.toHaveBeenCalled();
    });

    test("with the real NotificationService: Auto Recharge switched off reads as Off", async () => {
      smsOrCallState.mockRestore();
      project.enableAutoRechargeSmsOrCallBalance = false;
      project.autoRechargeSmsOrCallByBalanceInUSD = 20;
      project.autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD = 5;

      await expect(
        AutoRechargeStateRequest.getState({
          req: makeRequest({ tenantId: PROJECT_ID, memberOf: [PROJECT_ID] }),
          balance: ProjectBalanceType.SmsOrCall,
        }),
      ).resolves.toBe(AutoRechargeState.Off);
    });
  });

  describe("the AI credits balance", () => {
    test("reads only its own Auto Recharge columns, as root, and lets AIBillingService decide", async () => {
      const state: AutoRechargeState = await AutoRechargeStateRequest.getState({
        req: makeRequest({ tenantId: PROJECT_ID, memberOf: [PROJECT_ID] }),
        balance: ProjectBalanceType.AI,
      });

      expect(state).toBe(AutoRechargeState.Ready);
      expect(findOneById).toHaveBeenCalledTimes(1);
      expect(findOneById).toHaveBeenCalledWith({
        id: PROJECT_ID,
        select: AI_SELECT,
        props: { isRoot: true },
      });
      expect(aiState).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        project: project,
      });
      expect(smsOrCallState).not.toHaveBeenCalled();
    });

    test.each([
      AutoRechargeState.Off,
      AutoRechargeState.Ready,
      AutoRechargeState.Failed,
    ])(
      "passes on %s as AIBillingService says it",
      async (expected: AutoRechargeState) => {
        aiState.mockResolvedValue(expected);

        await expect(
          AutoRechargeStateRequest.getState({
            req: makeRequest({ tenantId: PROJECT_ID, memberOf: [PROJECT_ID] }),
            balance: ProjectBalanceType.AI,
          }),
        ).resolves.toBe(expected);
      },
    );

    test("a project that is gone is refused, and AIBillingService is not asked", async () => {
      findOneById.mockImplementation(async (): Promise<Project | null> => {
        return null;
      });

      const err: Error = await captureError(
        AutoRechargeStateRequest.getState({
          req: makeRequest({ tenantId: PROJECT_ID, isMasterAdmin: true }),
          balance: ProjectBalanceType.AI,
        }),
      );

      expect(err).toBeInstanceOf(BadDataException);
      expect(err.message).toBe("Project not found");
      expect(aiState).not.toHaveBeenCalled();
    });

    test("an error reading the project is passed on", async () => {
      const readError: Error = new Error("database is unavailable");
      findOneById.mockRejectedValue(readError as never);

      const err: Error = await captureError(
        AutoRechargeStateRequest.getState({
          req: makeRequest({ tenantId: PROJECT_ID, memberOf: [PROJECT_ID] }),
          balance: ProjectBalanceType.AI,
        }),
      );

      expect(err).toBe(readError);
    });

    test("with the real AIBillingService: Auto Recharge with no amount to recharge by reads as Off", async () => {
      aiState.mockRestore();
      project.enableAutoRechargeAiBalance = true;
      project.autoRechargeAiWhenCurrentBalanceFallsInUSD = 5;

      await expect(
        AutoRechargeStateRequest.getState({
          req: makeRequest({ tenantId: PROJECT_ID, memberOf: [PROJECT_ID] }),
          balance: ProjectBalanceType.AI,
        }),
      ).resolves.toBe(AutoRechargeState.Off);
    });
  });
});
