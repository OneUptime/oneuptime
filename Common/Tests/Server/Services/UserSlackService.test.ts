import UserSlackService from "../../../Server/Services/UserSlackService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../Server/Services/WorkspaceUserAuthTokenService";
import SlackUtil from "../../../Server/Utils/Workspace/Slack/Slack";
import logger from "../../../Server/Utils/Logger";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import UserSlack from "../../../Models/DatabaseModels/UserSlack";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";

/*
 * A UserSlack row is a POINTER at the user's existing OAuth workspace link,
 * never a hand-typed address. Everything pinned here follows from that:
 *
 *   1. CREATION IS VERIFICATION. onBeforeCreate resolves the Slack member id
 *      from the caller's OWN WorkspaceUserAuthToken and stamps
 *      isVerified: true. A client-supplied slackUserId or isVerified is
 *      refused outright — accepting either would let a caller aim a bot at an
 *      arbitrary member id without ever proving they control that account.
 *
 *   2. THE GATES. No project connection, no user connection, or an existing
 *      row each refuse the create with a message that names the settings page
 *      that fixes it.
 *
 *   3. THE SEEDING. A row is born verified, so default on-call rules are
 *      seeded at create time (like webhooks) — and a seeding failure is
 *      logged, never thrown, because the method row itself is real.
 *
 *   4. THE CASCADE. Deleting the method deletes every rule pointing at it via
 *      the service hook, in addition to the FK cascade.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const METHOD_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const SLACK_MEMBER_ID: string = "U0123ABCD";
const BOT_TOKEN: string = "xoxb-project-bot-token";

type OnBeforeCreateFunction = (
  createBy: CreateBy<UserSlack>,
) => Promise<OnCreate<UserSlack>>;

type OnCreateSuccessFunction = (
  onCreate: OnCreate<UserSlack>,
  createdItem: UserSlack,
) => Promise<UserSlack>;

type OnBeforeDeleteFunction = (deleteBy: {
  query: Record<string, unknown>;
  props: { isRoot: boolean };
}) => Promise<unknown>;

function callOnBeforeCreate(
  createBy: CreateBy<UserSlack>,
): Promise<OnCreate<UserSlack>> {
  return (
    UserSlackService as unknown as { onBeforeCreate: OnBeforeCreateFunction }
  ).onBeforeCreate(createBy);
}

function callOnCreateSuccess(
  onCreate: OnCreate<UserSlack>,
  createdItem: UserSlack,
): Promise<UserSlack> {
  return (
    UserSlackService as unknown as {
      onCreateSuccess: OnCreateSuccessFunction;
    }
  ).onCreateSuccess(onCreate, createdItem);
}

function callOnBeforeDelete(deleteBy: {
  query: Record<string, unknown>;
  props: { isRoot: boolean };
}): Promise<unknown> {
  return (
    UserSlackService as unknown as { onBeforeDelete: OnBeforeDeleteFunction }
  ).onBeforeDelete(deleteBy);
}

function createBy(
  data: Partial<UserSlack> = {},
  props: { isRoot: boolean } = { isRoot: false },
): CreateBy<UserSlack> {
  return {
    data: {
      projectId: PROJECT_ID,
      userId: USER_ID,
      ...data,
    } as UserSlack,
    props: props,
  } as CreateBy<UserSlack>;
}

describe("UserSlackService", () => {
  let countBy: jest.SpyInstance;
  let getProjectAuth: jest.SpyInstance;
  let getUserAuth: jest.SpyInstance;
  let getUsername: jest.SpyInstance;
  let loggerError: jest.SpyInstance;

  beforeEach(() => {
    loggerError = jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });

    countBy = jest
      .spyOn(UserSlackService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);

    getProjectAuth = jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockResolvedValue({
        id: PROJECT_ID,
        authToken: BOT_TOKEN,
      } as unknown as WorkspaceProjectAuthToken as never);

    getUserAuth = jest
      .spyOn(WorkspaceUserAuthTokenService, "getUserAuth")
      .mockResolvedValue({
        workspaceUserId: SLACK_MEMBER_ID,
      } as unknown as WorkspaceUserAuthToken as never);

    getUsername = jest
      .spyOn(SlackUtil, "getUsernameFromUserId")
      .mockResolvedValue("alice" as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * ----------------------------------------------------------------------- *
   * (A) onBeforeCreate — creation is verification.
   * -----------------------------------------------------------------------
   */

  describe("onBeforeCreate", () => {
    test("resolves the member id from the user's own workspace link and stamps verified", async () => {
      const result: OnCreate<UserSlack> = await callOnBeforeCreate(createBy());

      expect(result.createBy.data.slackUserId).toBe(SLACK_MEMBER_ID);
      expect(result.createBy.data.isVerified).toBe(true);
      expect(result.createBy.data.slackUserName).toBe("alice");

      // The link is resolved for exactly this (project, user, Slack).
      const authArg: {
        projectId: ObjectID;
        userId: ObjectID;
        workspaceType: WorkspaceType;
      } = getUserAuth.mock.calls[0][0] as {
        projectId: ObjectID;
        userId: ObjectID;
        workspaceType: WorkspaceType;
      };
      expect(authArg.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(authArg.userId.toString()).toBe(USER_ID.toString());
      expect(authArg.workspaceType).toBe(WorkspaceType.Slack);
    });

    test("a non-root caller supplying isVerified is refused", async () => {
      await expect(
        callOnBeforeCreate(createBy({ isVerified: true })),
      ).rejects.toThrow("isVerified cannot be set to true");
    });

    test("a non-root caller supplying slackUserId is refused - the address is never client input", async () => {
      await expect(
        callOnBeforeCreate(createBy({ slackUserId: "U-ATTACKER" })),
      ).rejects.toThrow("slackUserId cannot be set directly");
    });

    test("a project that is not connected to Slack is refused with the settings pointer", async () => {
      getProjectAuth.mockResolvedValue(null as never);

      await expect(callOnBeforeCreate(createBy())).rejects.toThrow(
        "This project is not connected to Slack. Please ask a project admin to connect Slack in Project Settings > Slack Integration.",
      );
    });

    test("a user who has not connected their Slack account is refused with the settings pointer", async () => {
      getUserAuth.mockResolvedValue(null as never);

      await expect(callOnBeforeCreate(createBy())).rejects.toThrow(
        "Your Slack account is not connected to OneUptime for this project. Please go to User Settings > Slack Integration and connect your Slack account first.",
      );
    });

    test("a user auth row with no workspaceUserId counts as not connected", async () => {
      getUserAuth.mockResolvedValue({
        workspaceUserId: undefined,
      } as unknown as WorkspaceUserAuthToken as never);

      await expect(callOnBeforeCreate(createBy())).rejects.toThrow(
        BadDataException,
      );
    });

    test("a second row for the same (user, project) is refused as a duplicate", async () => {
      countBy.mockResolvedValue(new PositiveNumber(1) as never);

      await expect(callOnBeforeCreate(createBy())).rejects.toThrow(
        "Slack is already added as a notification method for this project.",
      );

      // Refused before any workspace lookup happens.
      expect(getUserAuth).not.toHaveBeenCalled();
    });

    test("a missing projectId or userId is refused before anything is queried", async () => {
      await expect(
        callOnBeforeCreate({
          data: { projectId: PROJECT_ID } as UserSlack,
          props: { isRoot: false },
        } as CreateBy<UserSlack>),
      ).rejects.toThrow("projectId and userId are required");

      expect(countBy).not.toHaveBeenCalled();
    });

    test("a username lookup failure is logged and does NOT stop the method being added", async () => {
      getUsername.mockRejectedValue(new Error("slack api down") as never);

      const result: OnCreate<UserSlack> = await callOnBeforeCreate(createBy());

      expect(result.createBy.data.slackUserId).toBe(SLACK_MEMBER_ID);
      expect(result.createBy.data.isVerified).toBe(true);
      expect(result.createBy.data.slackUserName).toBeUndefined();
      expect(loggerError).toHaveBeenCalled();
    });

    test("the username lookup uses the PROJECT bot token, not the user's token", async () => {
      await callOnBeforeCreate(createBy());

      const arg: { authToken: string; userId: string } = getUsername.mock
        .calls[0][0] as { authToken: string; userId: string };
      expect(arg.authToken).toBe(BOT_TOKEN);
      expect(arg.userId).toBe(SLACK_MEMBER_ID);
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (B) onCreateSuccess — default-rule seeding.
   * -----------------------------------------------------------------------
   */

  describe("onCreateSuccess", () => {
    let seedRules: jest.SpyInstance;

    beforeEach(() => {
      seedRules = jest
        .spyOn(
          UserNotificationRuleService,
          "addDefaultNotificationRulesForVerifiedMethod",
        )
        .mockResolvedValue(undefined as never);
    });

    test("seeds default rules pointed at the new row via userSlackId", async () => {
      const created: UserSlack = {
        id: METHOD_ID,
        projectId: PROJECT_ID,
        userId: USER_ID,
      } as unknown as UserSlack;

      await callOnCreateSuccess(
        { createBy: createBy(), carryForward: null } as OnCreate<UserSlack>,
        created,
      );

      expect(seedRules).toHaveBeenCalledTimes(1);
      const arg: {
        projectId: ObjectID;
        userId: ObjectID;
        notificationMethod: { userSlackId: ObjectID };
      } = seedRules.mock.calls[0][0] as {
        projectId: ObjectID;
        userId: ObjectID;
        notificationMethod: { userSlackId: ObjectID };
      };
      expect(arg.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(arg.userId.toString()).toBe(USER_ID.toString());
      expect(arg.notificationMethod.userSlackId.toString()).toBe(
        METHOD_ID.toString(),
      );
    });

    test("a seeding failure is swallowed and logged - the method row is already real", async () => {
      seedRules.mockRejectedValue(new Error("severity read failed") as never);

      const created: UserSlack = {
        id: METHOD_ID,
        projectId: PROJECT_ID,
        userId: USER_ID,
      } as unknown as UserSlack;

      await expect(
        callOnCreateSuccess(
          { createBy: createBy(), carryForward: null } as OnCreate<UserSlack>,
          created,
        ),
      ).resolves.toBe(created);

      expect(loggerError).toHaveBeenCalled();
    });

    test("an item missing its ids seeds nothing rather than seeding garbage", async () => {
      await callOnCreateSuccess(
        { createBy: createBy(), carryForward: null } as OnCreate<UserSlack>,
        { id: METHOD_ID } as unknown as UserSlack,
      );

      expect(seedRules).not.toHaveBeenCalled();
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (C) onBeforeDelete — the rule cascade.
   * -----------------------------------------------------------------------
   */

  describe("onBeforeDelete", () => {
    test("deletes every notification rule pointing at each row being deleted", async () => {
      jest.spyOn(UserSlackService, "findBy").mockResolvedValue([
        {
          id: METHOD_ID,
          projectId: PROJECT_ID,
        } as unknown as UserSlack,
      ] as never);

      const deleteRules: jest.SpyInstance = jest
        .spyOn(UserNotificationRuleService, "deleteBy")
        .mockResolvedValue([] as never);

      await callOnBeforeDelete({
        query: { _id: METHOD_ID },
        props: { isRoot: true },
      });

      expect(deleteRules).toHaveBeenCalledTimes(1);
      const arg: {
        query: { userSlackId: ObjectID; projectId: ObjectID };
        limit: number;
        props: { isRoot: boolean };
      } = deleteRules.mock.calls[0][0] as {
        query: { userSlackId: ObjectID; projectId: ObjectID };
        limit: number;
        props: { isRoot: boolean };
      };
      expect(arg.query.userSlackId.toString()).toBe(METHOD_ID.toString());
      expect(arg.query.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(arg.limit).toBe(LIMIT_MAX);
      expect(arg.props.isRoot).toBe(true);
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (D) getDeletionImpact — the shared preview, on the Slack channel.
   * -----------------------------------------------------------------------
   */

  describe("getDeletionImpact", () => {
    test("delegates to the shared preview with methodType Slack", async () => {
      const getImpact: jest.SpyInstance = jest
        .spyOn(UserNotificationRuleService, "getNotificationMethodDeletionImpact")
        .mockResolvedValue({} as never);

      await UserSlackService.getDeletionImpact({
        itemId: METHOD_ID,
        projectId: PROJECT_ID,
      });

      const arg: {
        projectId: ObjectID;
        methodType: string;
        methodId: ObjectID;
      } = getImpact.mock.calls[0][0] as {
        projectId: ObjectID;
        methodType: string;
        methodId: ObjectID;
      };
      expect(arg.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(arg.methodType).toBe("Slack");
      expect(arg.methodId.toString()).toBe(METHOD_ID.toString());
    });
  });
});
