import Project from "../../../Models/DatabaseModels/Project";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import * as EnvironmentConfig from "../../../Server/EnvironmentConfig";
import Semaphore, {
  SemaphoreMutex,
} from "../../../Server/Infrastructure/Semaphore";
import AuditLogService from "../../../Server/Services/AuditLogService";
import BillingService from "../../../Server/Services/BillingService";
import ProjectSCIMService from "../../../Server/Services/ProjectSCIMService";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamPermissionService from "../../../Server/Services/TeamPermissionService";
import TeamService from "../../../Server/Services/TeamService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import UserService from "../../../Server/Services/UserService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnDelete } from "../../../Server/Types/Database/Hooks";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import Errors from "../../../Server/Utils/Errors";
import logger from "../../../Server/Utils/Logger";
import ProductAnalytics from "../../../Server/Utils/ProductAnalytics";
import SubscriptionPlan, {
  PlanType,
} from "../../../Types/Billing/SubscriptionPlan";
import Email from "../../../Types/Email";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

jest.mock("../../../Server/EnvironmentConfig", () => {
  const config: Record<string, unknown> = {
    ...jest.requireActual("../../../Server/EnvironmentConfig"),
  };

  // Preserve the configurable getter when TypeScript imports this namespace.
  Object.defineProperty(config, "__esModule", { value: true });

  Object.defineProperty(config, "IsBillingEnabled", {
    configurable: true,
    enumerable: true,
    get: (): boolean => {
      return true;
    },
  });

  return config;
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const TEAM_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const MEMBER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const SUBSCRIPTION_ID: string = "sub_team_members";
const PLAN_ID: string = "price_growth_monthly";

function member(): TeamMember {
  const item: TeamMember = new TeamMember(MEMBER_ID);
  item.projectId = PROJECT_ID;
  item.teamId = TEAM_ID;
  item.userId = USER_ID;
  item.hasAcceptedInvitation = false;
  return item;
}

function invitation(): CreateBy<TeamMember> {
  return {
    data: member(),
    props: { isRoot: true, tenantId: PROJECT_ID },
  };
}

function callHook(name: string, ...args: Array<unknown>): Promise<unknown> {
  const service: Record<
    string,
    (...values: Array<unknown>) => Promise<unknown>
  > = TeamMemberService as unknown as Record<
    string,
    (...values: Array<unknown>) => Promise<unknown>
  >;
  return service[name]!.apply(TeamMemberService, args);
}

function rateLimitError(): Error {
  return Object.assign(new Error("Too many requests to the billing provider"), {
    statusCode: 429,
    type: "StripeRateLimitError",
  });
}

let project: Project;
let lockSpy: jest.SpyInstance;
let releaseSpy: jest.SpyInstance;
let projectReadSpy: jest.SpyInstance;
let projectWriteSpy: jest.SpyInstance;
let memberCountSpy: jest.SpyInstance;
let billingSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;
let mutex: SemaphoreMutex;

interface SeatUpdate {
  projectId: ObjectID;
  subscriptionId: string;
  planId: string;
  seats: number | null;
}

async function applySeatUpdate(update: SeatUpdate): Promise<number> {
  if (
    update.subscriptionId !== project.paymentProviderSubscriptionId ||
    update.planId !== project.paymentProviderPlanId
  ) {
    return 0;
  }
  project.setColumnValue("paymentProviderSubscriptionSeats", update.seats);
  return 1;
}

beforeEach(() => {
  project = new Project(PROJECT_ID);
  project.paymentProviderSubscriptionId = SUBSCRIPTION_ID;
  project.paymentProviderPlanId = PLAN_ID;
  project.paymentProviderSubscriptionSeats = 3;
  project.seatLimit = 10;

  mutex = {} as SemaphoreMutex;
  lockSpy = jest.spyOn(Semaphore, "lock").mockResolvedValue(mutex);
  releaseSpy = jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);
  projectReadSpy = jest
    .spyOn(ProjectService, "findOneById")
    .mockImplementation(async (): Promise<Project> => {
      return Object.assign(new Project(PROJECT_ID), project);
    });
  projectWriteSpy = jest
    .spyOn(ProjectService, "updateSubscriptionSeats")
    .mockImplementation(applySeatUpdate as never);
  memberCountSpy = jest
    .spyOn(TeamMemberService, "getUniqueTeamMemberCountInProject")
    .mockResolvedValue(4);
  billingSpy = jest
    .spyOn(BillingService, "changeQuantity")
    .mockResolvedValue(undefined);
  errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {});
  jest
    .spyOn(SubscriptionPlan, "getSubscriptionPlanById")
    .mockReturnValue(
      new SubscriptionPlan(PLAN_ID, "price_yearly", "Growth", 20, 200, 1, 14),
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("TeamMemberService billing seat reconciliation", () => {
  test("acknowledges the distinct membership count only after the provider succeeds", async () => {
    await TeamMemberService.updateSubscriptionSeatsByUniqueTeamMembersInProject(
      PROJECT_ID,
    );

    expect(billingSpy).toHaveBeenCalledWith(SUBSCRIPTION_ID, 4);
    expect(projectWriteSpy).toHaveBeenNthCalledWith(1, {
      projectId: PROJECT_ID,
      subscriptionId: SUBSCRIPTION_ID,
      planId: PLAN_ID,
      seats: null,
    });
    expect(projectWriteSpy).toHaveBeenNthCalledWith(2, {
      projectId: PROJECT_ID,
      subscriptionId: SUBSCRIPTION_ID,
      planId: PLAN_ID,
      seats: 4,
    });
    expect(projectWriteSpy.mock.invocationCallOrder[0]).toBeLessThan(
      billingSpy.mock.invocationCallOrder[0]!,
    );
    expect(billingSpy.mock.invocationCallOrder[0]).toBeLessThan(
      projectWriteSpy.mock.invocationCallOrder[1]!,
    );
    expect(lockSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        key: PROJECT_ID.toString(),
        namespace: "team-member-subscription-seats",
      }),
    );
    expect(lockSpy.mock.invocationCallOrder[0]).toBeLessThan(
      projectReadSpy.mock.invocationCallOrder[0]!,
    );
    expect(releaseSpy).toHaveBeenCalledWith(mutex);
  });

  test("a provider 429 leaves the count uncertain and remains retryable", async () => {
    const error: Error = rateLimitError();
    billingSpy.mockRejectedValueOnce(error);

    await expect(
      TeamMemberService.updateSubscriptionSeatsByUniqueTeamMembersInProject(
        PROJECT_ID,
      ),
    ).rejects.toBe(error);

    expect(projectWriteSpy).toHaveBeenCalledTimes(1);
    expect(project.paymentProviderSubscriptionSeats).toBeNull();
    expect(releaseSpy).toHaveBeenCalledWith(mutex);

    await expect(
      TeamMemberService.updateSubscriptionSeatsByUniqueTeamMembersInProject(
        PROJECT_ID,
      ),
    ).resolves.toBeUndefined();

    expect(billingSpy).toHaveBeenCalledTimes(2);
    expect(billingSpy).toHaveBeenNthCalledWith(2, SUBSCRIPTION_ID, 4);
    expect(projectWriteSpy).toHaveBeenCalledTimes(3);
    expect(project.paymentProviderSubscriptionSeats).toBe(4);
    expect(releaseSpy).toHaveBeenCalledTimes(2);
  });

  test("retries if recording a successful provider change fails", async () => {
    const error: Error = new Error("Database temporarily unavailable");
    projectWriteSpy
      .mockImplementationOnce(applySeatUpdate)
      .mockRejectedValueOnce(error);

    await expect(
      TeamMemberService.updateSubscriptionSeatsByUniqueTeamMembersInProject(
        PROJECT_ID,
      ),
    ).rejects.toBe(error);
    await TeamMemberService.updateSubscriptionSeatsByUniqueTeamMembersInProject(
      PROJECT_ID,
    );

    expect(billingSpy).toHaveBeenCalledTimes(2);
    expect(projectWriteSpy).toHaveBeenCalledTimes(4);
    expect(releaseSpy).toHaveBeenCalledTimes(2);
  });

  test("reconciles a partially applied provider update even after the membership count returns to its old value", async () => {
    let providerSeats: number = 3;
    billingSpy.mockImplementationOnce(
      async (_subscriptionId: string, seats: number): Promise<void> => {
        providerSeats = seats;
        throw rateLimitError();
      },
    );
    await expect(
      TeamMemberService.updateSubscriptionSeatsByUniqueTeamMembersInProject(
        PROJECT_ID,
      ),
    ).rejects.toThrow();
    expect(providerSeats).toBe(4);
    expect(project.paymentProviderSubscriptionSeats).toBeNull();

    memberCountSpy.mockResolvedValue(3);
    billingSpy.mockImplementation(
      async (_subscriptionId: string, seats: number): Promise<void> => {
        providerSeats = seats;
      },
    );
    await TeamMemberService.updateSubscriptionSeatsByUniqueTeamMembersInProject(
      PROJECT_ID,
    );

    expect(billingSpy).toHaveBeenNthCalledWith(2, SUBSCRIPTION_ID, 3);
    expect(providerSeats).toBe(3);
    expect(project.paymentProviderSubscriptionSeats).toBe(3);
  });

  test("does not call the provider if persisting uncertainty fails", async () => {
    projectWriteSpy.mockRejectedValue(new Error("Database unavailable"));

    await expect(
      TeamMemberService.updateSubscriptionSeatsByUniqueTeamMembersInProject(
        PROJECT_ID,
      ),
    ).rejects.toThrow("Database unavailable");

    expect(billingSpy).not.toHaveBeenCalled();
    expect(project.paymentProviderSubscriptionSeats).toBe(3);
    expect(releaseSpy).toHaveBeenCalledWith(mutex);
  });

  test("does not bill a subscription replaced before the uncertainty marker is saved", async () => {
    projectWriteSpy.mockImplementationOnce(
      async (update: SeatUpdate): Promise<number> => {
        project.paymentProviderSubscriptionId = "sub_replacement";
        return applySeatUpdate(update);
      },
    );

    await TeamMemberService.updateSubscriptionSeatsByUniqueTeamMembersInProject(
      PROJECT_ID,
    );

    expect(billingSpy).not.toHaveBeenCalled();
    expect(projectWriteSpy).toHaveBeenCalledTimes(1);
    expect(project.paymentProviderSubscriptionSeats).toBe(3);
    expect(releaseSpy).toHaveBeenCalledWith(mutex);
  });

  test("does not acknowledge seats against a subscription replaced during the provider call", async () => {
    billingSpy.mockImplementationOnce(async (): Promise<void> => {
      project.paymentProviderSubscriptionId = "sub_replacement";
      project.paymentProviderSubscriptionSeats = 1;
    });

    await TeamMemberService.updateSubscriptionSeatsByUniqueTeamMembersInProject(
      PROJECT_ID,
    );

    expect(billingSpy).toHaveBeenCalledWith(SUBSCRIPTION_ID, 4);
    expect(project.paymentProviderSubscriptionId).toBe("sub_replacement");
    expect(project.paymentProviderSubscriptionSeats).toBe(1);
    expect(releaseSpy).toHaveBeenCalledWith(mutex);
  });

  test.each([0, 4])(
    "does not contact the provider when %i seats are already acknowledged",
    async (count: number) => {
      project.paymentProviderSubscriptionSeats = count;
      memberCountSpy.mockResolvedValue(count);

      await TeamMemberService.updateSubscriptionSeatsByUniqueTeamMembersInProject(
        PROJECT_ID,
      );

      expect(billingSpy).not.toHaveBeenCalled();
      expect(projectWriteSpy).not.toHaveBeenCalled();
      expect(releaseSpy).toHaveBeenCalledWith(mutex);
    },
  );

  test.each([0, 2, 8])(
    "synchronizes changed counts including removals and zero (%i seats)",
    async (count: number) => {
      memberCountSpy.mockResolvedValue(count);

      await TeamMemberService.updateSubscriptionSeatsByUniqueTeamMembersInProject(
        PROJECT_ID,
      );

      expect(billingSpy).toHaveBeenCalledWith(SUBSCRIPTION_ID, count);
      expect(projectWriteSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          seats: count,
        }),
      );
    },
  );

  test("an unknown acknowledged count is synchronized", async () => {
    delete project.paymentProviderSubscriptionSeats;

    await TeamMemberService.updateSubscriptionSeatsByUniqueTeamMembersInProject(
      PROJECT_ID,
    );

    expect(billingSpy).toHaveBeenCalledWith(SUBSCRIPTION_ID, 4);
  });

  test("self-hosted installations do not acquire a lock or access billing data", async () => {
    jest
      .spyOn(EnvironmentConfig, "IsBillingEnabled", "get")
      .mockReturnValue(false);

    await TeamMemberService.updateSubscriptionSeatsByUniqueTeamMembersInProject(
      PROJECT_ID,
    );

    expect(lockSpy).not.toHaveBeenCalled();
    expect(projectReadSpy).not.toHaveBeenCalled();
    expect(memberCountSpy).not.toHaveBeenCalled();
    expect(billingSpy).not.toHaveBeenCalled();
  });

  test.each([
    "missing project",
    "missing subscription",
    "missing plan",
    "unknown plan",
  ])("releases the lock without billing for %s", async (reason: string) => {
    if (reason === "missing project") {
      projectReadSpy.mockResolvedValue(null);
    } else if (reason === "missing subscription") {
      delete project.paymentProviderSubscriptionId;
    } else if (reason === "missing plan") {
      delete project.paymentProviderPlanId;
    } else {
      jest
        .spyOn(SubscriptionPlan, "getSubscriptionPlanById")
        .mockReturnValue(undefined);
    }

    await TeamMemberService.updateSubscriptionSeatsByUniqueTeamMembersInProject(
      PROJECT_ID,
    );

    expect(memberCountSpy).not.toHaveBeenCalled();
    expect(billingSpy).not.toHaveBeenCalled();
    expect(projectWriteSpy).not.toHaveBeenCalled();
    expect(releaseSpy).toHaveBeenCalledWith(mutex);
  });

  test.each(["project", "members"])(
    "releases the lock when reading %s fails",
    async (read: string) => {
      const error: Error = new Error("Database read failed");
      (read === "project" ? projectReadSpy : memberCountSpy).mockRejectedValue(
        error,
      );

      await expect(
        TeamMemberService.updateSubscriptionSeatsByUniqueTeamMembersInProject(
          PROJECT_ID,
        ),
      ).rejects.toBe(error);

      expect(billingSpy).not.toHaveBeenCalled();
      expect(releaseSpy).toHaveBeenCalledWith(mutex);
    },
  );

  test("a lock timeout performs no reads or provider writes and is retryable", async () => {
    const error: Error = new Error("Lock acquisition timed out");
    lockSpy.mockRejectedValue(error);

    await expect(
      TeamMemberService.updateSubscriptionSeatsByUniqueTeamMembersInProject(
        PROJECT_ID,
      ),
    ).rejects.toBe(error);

    expect(projectReadSpy).not.toHaveBeenCalled();
    expect(billingSpy).not.toHaveBeenCalled();
    expect(releaseSpy).not.toHaveBeenCalled();
  });

  test("concurrent request and worker calls read fresh counts in lock order", async () => {
    let previousLock: Promise<void> = Promise.resolve();
    lockSpy.mockImplementation(async (): Promise<SemaphoreMutex> => {
      const waitForPrevious: Promise<void> = previousLock;
      let unlock: () => void = (): void => {};
      previousLock = new Promise<void>((resolve: () => void) => {
        unlock = resolve;
      });
      await waitForPrevious;
      return {
        release: async (): Promise<void> => {
          unlock();
        },
      } as SemaphoreMutex;
    });
    releaseSpy.mockImplementation(
      async (heldMutex: SemaphoreMutex): Promise<void> => {
        await heldMutex.release();
      },
    );

    let actualCount: number = 4;
    memberCountSpy.mockImplementation(async (): Promise<number> => {
      return actualCount;
    });

    let firstProviderCallStarted: () => void = (): void => {};
    const firstProviderCall: Promise<void> = new Promise<void>(
      (resolve: () => void) => {
        firstProviderCallStarted = resolve;
      },
    );
    let finishFirstProviderCall: () => void = (): void => {};
    const providerGate: Promise<void> = new Promise<void>(
      (resolve: () => void) => {
        finishFirstProviderCall = resolve;
      },
    );
    billingSpy.mockImplementationOnce(async (): Promise<void> => {
      firstProviderCallStarted();
      await providerGate;
    });

    const firstSync: Promise<void> =
      TeamMemberService.updateSubscriptionSeatsByUniqueTeamMembersInProject(
        PROJECT_ID,
      );
    await firstProviderCall;
    actualCount = 5;
    const secondSync: Promise<void> =
      TeamMemberService.updateSubscriptionSeatsByUniqueTeamMembersInProject(
        PROJECT_ID,
      );

    expect(projectReadSpy).toHaveBeenCalledTimes(1);
    expect(memberCountSpy).toHaveBeenCalledTimes(1);
    finishFirstProviderCall();
    await Promise.all([firstSync, secondSync]);

    expect(billingSpy).toHaveBeenNthCalledWith(1, SUBSCRIPTION_ID, 4);
    expect(billingSpy).toHaveBeenNthCalledWith(2, SUBSCRIPTION_ID, 5);
    expect(project.paymentProviderSubscriptionSeats).toBe(5);
    expect(releaseSpy).toHaveBeenCalledTimes(2);
  });

  test("the real member count includes pending invitations and deduplicates people across teams", async () => {
    memberCountSpy.mockRestore();
    const accepted: TeamMember = member();
    accepted.hasAcceptedInvitation = true;
    const secondTeam: TeamMember = member();
    secondTeam.teamId = ObjectID.generate();
    const pending: TeamMember = member();
    pending.userId = ObjectID.generate();
    const missingUser: TeamMember = member();
    delete missingUser.userId;
    jest
      .spyOn(TeamMemberService, "findBy")
      .mockResolvedValue([accepted, secondTeam, pending, missingUser]);

    await TeamMemberService.updateSubscriptionSeatsByUniqueTeamMembersInProject(
      PROJECT_ID,
    );

    expect(billingSpy).toHaveBeenCalledWith(SUBSCRIPTION_ID, 2);
    expect(TeamMemberService.findBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { projectId: PROJECT_ID },
        props: { isRoot: true },
      }),
    );
  });
});

describe("completed membership writes during a billing outage", () => {
  beforeEach(() => {
    jest.spyOn(TeamMemberService, "refreshTokens").mockResolvedValue(undefined);
    jest.spyOn(ProductAnalytics, "captureForUser").mockImplementation(() => {});
    jest.spyOn(TeamMemberService, "findOneBy").mockResolvedValue(null);
    jest
      .spyOn(TeamMemberService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest.spyOn(TeamService, "findOneBy").mockResolvedValue(new Team(TEAM_ID));
    jest
      .spyOn(TeamPermissionService, "assertCanGrantTeamPermissions")
      .mockResolvedValue(undefined);
    jest
      .spyOn(ProjectSCIMService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(
        UserNotificationSettingService,
        "addDefaultNotificationSettingsForUser",
      )
      .mockResolvedValue(undefined);
    jest
      .spyOn(UserNotificationRuleService, "addDefaultNotificationRuleForUser")
      .mockResolvedValue(undefined);
  });

  test("returns the saved pending invitation even when the provider returns 429", async () => {
    const error: Error = rateLimitError();
    billingSpy.mockRejectedValue(error);
    const saved: TeamMember = member();
    const onCreate: OnCreate<TeamMember> = {
      createBy: invitation(),
      carryForward: null,
    };

    await expect(callHook("onCreateSuccess", onCreate, saved)).resolves.toBe(
      saved,
    );

    expect(saved.hasAcceptedInvitation).toBe(false);
    expect(projectWriteSpy).toHaveBeenCalledTimes(1);
    expect(project.paymentProviderSubscriptionSeats).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(error, {
      projectId: PROJECT_ID.toString(),
    });
    expect(TeamMemberService.refreshTokens).toHaveBeenCalledWith(
      USER_ID,
      PROJECT_ID,
    );
    expect(ProductAnalytics.captureForUser).toHaveBeenCalled();
  });

  test("a Redis outage also leaves the committed invitation successful", async () => {
    lockSpy.mockRejectedValue(new Error("Redis client is not connected"));
    const saved: TeamMember = member();

    await expect(
      callHook(
        "onCreateSuccess",
        { createBy: invitation(), carryForward: null },
        saved,
      ),
    ).resolves.toBe(saved);

    expect(billingSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  test("billing failure does not skip defaults for an automatically accepted member", async () => {
    billingSpy.mockRejectedValue(rateLimitError());
    const saved: TeamMember = member();
    saved.hasAcceptedInvitation = true;
    const user: User = new User(USER_ID);
    user.email = new Email("member@example.com");
    user.isEmailVerified = true;
    jest.spyOn(UserService, "findOneById").mockResolvedValue(user);

    await expect(
      callHook(
        "onCreateSuccess",
        { createBy: invitation(), carryForward: null },
        saved,
      ),
    ).resolves.toBe(saved);

    expect(
      UserNotificationSettingService.addDefaultNotificationSettingsForUser,
    ).toHaveBeenCalledWith(USER_ID, PROJECT_ID);
    expect(
      UserNotificationRuleService.addDefaultNotificationRuleForUser,
    ).toHaveBeenCalledWith(PROJECT_ID, USER_ID, user.email);
  });

  test("billing failure does not stop removal cleanup or change a successful delete result", async () => {
    billingSpy.mockRejectedValue(rateLimitError());
    jest
      .spyOn(TeamMemberService, "cleanupOnCallAssignmentsIfUserLeftProject")
      .mockResolvedValue(null);
    jest
      .spyOn(
        UserNotificationSettingService,
        "removeDefaultNotificationSettingsForUser",
      )
      .mockResolvedValue(undefined);
    const onDelete: OnDelete<TeamMember> = {
      deleteBy: {
        query: { _id: MEMBER_ID },
        props: { isRoot: true },
        limit: 1,
        skip: 0,
      },
      carryForward: [member()],
    };

    await expect(callHook("onDeleteSuccess", onDelete)).resolves.toBe(onDelete);

    expect(
      TeamMemberService.cleanupOnCallAssignmentsIfUserLeftProject,
    ).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      userId: USER_ID,
      hadAcceptedMembership: false,
    });
    expect(
      UserNotificationSettingService.removeDefaultNotificationSettingsForUser,
    ).toHaveBeenCalledWith(USER_ID, PROJECT_ID);
  });

  test("the complete create pipeline returns the committed row after a provider 429", async () => {
    /*
     * Keep DatabaseService.create, validation, and both membership hooks real.
     * Only persistence and other external side effects are replaced.
     */
    const persisted: Array<TeamMember> = [];
    const save: jest.Mock = jest.fn(
      async (data: TeamMember): Promise<TeamMember> => {
        persisted.push(data);
        return data;
      },
    );
    jest
      .spyOn(TeamMemberService, "getRepository")
      .mockReturnValue({ save } as never);
    jest
      .spyOn(TeamMemberService, "onTriggerRealtime")
      .mockResolvedValue(undefined);
    jest
      .spyOn(TeamMemberService, "onTriggerWorkflow")
      .mockResolvedValue(undefined);
    jest.spyOn(AuditLogService, "recordCreate").mockResolvedValue(undefined);
    jest
      .spyOn(ModelPermission, "checkCreatePermissions")
      .mockReturnValue(undefined);
    billingSpy.mockImplementation(async (): Promise<void> => {
      expect(persisted).toHaveLength(1);
      throw rateLimitError();
    });

    const saved: TeamMember = await TeamMemberService.create(invitation());

    expect(saved).toBe(persisted[0]);
    expect(saved.id?.toString()).toBe(MEMBER_ID.toString());
    expect(saved.userId?.toString()).toBe(USER_ID.toString());
    expect(saved.hasAcceptedInvitation).toBe(false);
    expect(save).toHaveBeenCalledTimes(1);
    expect(billingSpy).toHaveBeenCalledTimes(1);
    expect(projectWriteSpy).toHaveBeenCalledTimes(1);
    expect(project.paymentProviderSubscriptionSeats).toBeNull();
    expect(TeamMemberService.onTriggerRealtime).toHaveBeenCalled();

    // A retry sees the saved row and retains the normal duplicate guard.
    jest.spyOn(TeamMemberService, "findOneBy").mockResolvedValue(saved);
    await expect(TeamMemberService.create(invitation())).rejects.toThrow(
      Errors.TeamMemberService.ALREADY_INVITED,
    );
    expect(save).toHaveBeenCalledTimes(1);
  });

  test.each([undefined, null, 0, 2])(
    "enforces the real seat limit when acknowledged seats are stale (%s)",
    async (acknowledged: number | null | undefined) => {
      project.seatLimit = 4;
      project.setColumnValue("paymentProviderSubscriptionSeats", acknowledged);

      await expect(callHook("onBeforeCreate", invitation())).rejects.toThrow(
        Errors.TeamMemberService.LIMIT_REACHED,
      );

      expect(memberCountSpy).toHaveBeenCalledWith(PROJECT_ID);
      expect(billingSpy).not.toHaveBeenCalled();
    },
  );

  test("allows an invitation below the real limit when old billing seats exceed it", async () => {
    project.seatLimit = 5;
    project.paymentProviderSubscriptionSeats = 8;

    await expect(callHook("onBeforeCreate", invitation())).resolves.toEqual({
      createBy: expect.any(Object),
      carryForward: null,
    });
  });

  test("enforces the free-plan limit from persisted members when billing seats are missing", async () => {
    delete project.paymentProviderSubscriptionSeats;
    memberCountSpy.mockResolvedValue(1);
    const createBy: CreateBy<TeamMember> = invitation();
    createBy.props.currentPlan = PlanType.Free;

    await expect(callHook("onBeforeCreate", createBy)).rejects.toThrow(
      Errors.TeamMemberService.LIMIT_REACHED_FOR_FREE_PLAN,
    );
  });

  test("allows the first free-plan member even when the cached billing count is stale", async () => {
    memberCountSpy.mockResolvedValue(0);
    const createBy: CreateBy<TeamMember> = invitation();
    createBy.props.currentPlan = PlanType.Free;

    await expect(callHook("onBeforeCreate", createBy)).resolves.toEqual({
      createBy,
      carryForward: null,
    });
  });
});
