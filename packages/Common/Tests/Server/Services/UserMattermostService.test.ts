import UserMattermostService from "../../../Server/Services/UserMattermostService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../Server/Services/WorkspaceUserAuthTokenService";
import logger from "../../../Server/Utils/Logger";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import UserMattermost from "../../../Models/DatabaseModels/UserMattermost";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";

/*
 * The Mattermost twin of UserSlackService.test.ts — the same
 * creation-is-verification model, with the two Mattermost differences pinned:
 * the stored id is the Mattermost account id from the user's own
 * WorkspaceUserAuthToken, which only the one-use sign-in link writes
 * (MattermostAPI), and the username comes from that token's miscData rather
 * than from a live call to the project's Mattermost server.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const METHOD_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const MATTERMOST_USER_ID: string = "abcdefghijklmnopqrstuvwxyz";

type OnBeforeCreateFunction = (
  createBy: CreateBy<UserMattermost>,
) => Promise<OnCreate<UserMattermost>>;

type OnCreateSuccessFunction = (
  onCreate: OnCreate<UserMattermost>,
  createdItem: UserMattermost,
) => Promise<UserMattermost>;

type OnBeforeDeleteFunction = (deleteBy: {
  query: Record<string, unknown>;
  props: { isRoot: boolean };
}) => Promise<unknown>;

function callOnBeforeCreate(
  createBy: CreateBy<UserMattermost>,
): Promise<OnCreate<UserMattermost>> {
  return (
    UserMattermostService as unknown as {
      onBeforeCreate: OnBeforeCreateFunction;
    }
  ).onBeforeCreate(createBy);
}

function callOnCreateSuccess(
  onCreate: OnCreate<UserMattermost>,
  createdItem: UserMattermost,
): Promise<UserMattermost> {
  return (
    UserMattermostService as unknown as {
      onCreateSuccess: OnCreateSuccessFunction;
    }
  ).onCreateSuccess(onCreate, createdItem);
}

function callOnBeforeDelete(deleteBy: {
  query: Record<string, unknown>;
  props: { isRoot: boolean };
}): Promise<unknown> {
  return (
    UserMattermostService as unknown as {
      onBeforeDelete: OnBeforeDeleteFunction;
    }
  ).onBeforeDelete(deleteBy);
}

function createBy(
  data: Partial<UserMattermost> = {},
  props: { isRoot: boolean } = { isRoot: false },
): CreateBy<UserMattermost> {
  return {
    data: {
      projectId: PROJECT_ID,
      userId: USER_ID,
      ...data,
    } as UserMattermost,
    props: props,
  } as CreateBy<UserMattermost>;
}

describe("UserMattermostService", () => {
  let countBy: jest.SpyInstance;
  let getProjectAuth: jest.SpyInstance;
  let getUserAuth: jest.SpyInstance;
  let loggerError: jest.SpyInstance;

  beforeEach(() => {
    loggerError = jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });

    countBy = jest
      .spyOn(UserMattermostService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);

    getProjectAuth = jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockResolvedValue({
        id: PROJECT_ID,
        authToken: "the-project-connection",
      } as unknown as WorkspaceProjectAuthToken as never);

    getUserAuth = jest
      .spyOn(WorkspaceUserAuthTokenService, "getUserAuth")
      .mockResolvedValue({
        workspaceUserId: MATTERMOST_USER_ID,
        miscData: {
          userId: MATTERMOST_USER_ID,
          username: "alice",
        },
      } as unknown as WorkspaceUserAuthToken as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("onBeforeCreate", () => {
    test("resolves the account id from the user's own workspace link and stamps verified", async () => {
      const result: OnCreate<UserMattermost> =
        await callOnBeforeCreate(createBy());

      expect(result.createBy.data.mattermostUserId).toBe(MATTERMOST_USER_ID);
      expect(result.createBy.data.isVerified).toBe(true);

      const authArg: {
        projectId: ObjectID;
        userId: ObjectID;
        workspaceType: WorkspaceType;
      } = getUserAuth.mock.calls[0][0] as {
        projectId: ObjectID;
        userId: ObjectID;
        workspaceType: WorkspaceType;
      };
      expect(authArg.workspaceType).toBe(WorkspaceType.Mattermost);
      expect(authArg.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(authArg.userId.toString()).toBe(USER_ID.toString());
    });

    test("asks about the project's Mattermost connection, not another workspace's", async () => {
      await callOnBeforeCreate(createBy());

      const authArg: { workspaceType: WorkspaceType } = getProjectAuth.mock
        .calls[0][0] as { workspaceType: WorkspaceType };
      expect(authArg.workspaceType).toBe(WorkspaceType.Mattermost);
    });

    test("the username comes from what the sign-in link recorded, with no call to Mattermost", async () => {
      const result: OnCreate<UserMattermost> =
        await callOnBeforeCreate(createBy());

      expect(result.createBy.data.mattermostUserName).toBe("alice");
    });

    test("a link with no recorded username still creates, just without a label", async () => {
      getUserAuth.mockResolvedValue({
        workspaceUserId: MATTERMOST_USER_ID,
        miscData: { userId: MATTERMOST_USER_ID, username: "" },
      } as unknown as WorkspaceUserAuthToken as never);

      const result: OnCreate<UserMattermost> =
        await callOnBeforeCreate(createBy());

      expect(result.createBy.data.mattermostUserId).toBe(MATTERMOST_USER_ID);
      expect(result.createBy.data.mattermostUserName).toBeUndefined();
    });

    test("a non-root caller supplying isVerified is refused", async () => {
      await expect(
        callOnBeforeCreate(createBy({ isVerified: true })),
      ).rejects.toThrow("isVerified cannot be set to true");
    });

    test("a non-root caller supplying mattermostUserId is refused - the address is never client input", async () => {
      await expect(
        callOnBeforeCreate(
          createBy({ mattermostUserId: "someoneelsesaccountid00000" }),
        ),
      ).rejects.toThrow("mattermostUserId cannot be set directly");
    });

    test("a username the caller sends is replaced by the one the sign-in link recorded", async () => {
      const result: OnCreate<UserMattermost> = await callOnBeforeCreate(
        createBy({ mattermostUserName: "not-alice" }),
      );

      expect(result.createBy.data.mattermostUserName).toBe("alice");
    });

    test("a project that is not connected to Mattermost is refused with the settings pointer", async () => {
      getProjectAuth.mockResolvedValue(null as never);

      await expect(callOnBeforeCreate(createBy())).rejects.toThrow(
        "This project is not connected to Mattermost. Please ask a project admin to connect Mattermost in Project Settings > Workspace > Mattermost.",
      );
    });

    test("a user who has not connected their Mattermost account is refused with the settings pointer", async () => {
      getUserAuth.mockResolvedValue(null as never);

      await expect(callOnBeforeCreate(createBy())).rejects.toThrow(
        "Your Mattermost account is not connected to OneUptime in this project yet. Connect it under User Settings > Workspace > Mattermost, then add it here.",
      );
    });

    test("a second row for the same (user, project) is refused as a duplicate", async () => {
      countBy.mockResolvedValue(new PositiveNumber(1) as never);

      await expect(callOnBeforeCreate(createBy())).rejects.toThrow(
        "Mattermost is already added as a notification method for this project.",
      );

      expect(getUserAuth).not.toHaveBeenCalled();
    });

    test("a missing projectId or userId is refused before anything is queried", async () => {
      await expect(
        callOnBeforeCreate({
          data: { userId: USER_ID } as UserMattermost,
          props: { isRoot: false },
        } as CreateBy<UserMattermost>),
      ).rejects.toThrow("projectId and userId are required");

      expect(countBy).not.toHaveBeenCalled();
    });

    test("a user auth row with no workspaceUserId counts as not connected", async () => {
      getUserAuth.mockResolvedValue({
        workspaceUserId: "",
      } as unknown as WorkspaceUserAuthToken as never);

      await expect(callOnBeforeCreate(createBy())).rejects.toThrow(
        BadDataException,
      );
    });
  });

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

    test("seeds default rules pointed at the new row via userMattermostId", async () => {
      const created: UserMattermost = {
        id: METHOD_ID,
        projectId: PROJECT_ID,
        userId: USER_ID,
      } as unknown as UserMattermost;

      await callOnCreateSuccess(
        {
          createBy: createBy(),
          carryForward: null,
        } as OnCreate<UserMattermost>,
        created,
      );

      const arg: {
        notificationMethod: { userMattermostId: ObjectID };
      } = seedRules.mock.calls[0][0] as {
        notificationMethod: { userMattermostId: ObjectID };
      };
      expect(arg.notificationMethod.userMattermostId.toString()).toBe(
        METHOD_ID.toString(),
      );
    });

    test("a seeding failure is swallowed and logged - the method row is already real", async () => {
      seedRules.mockRejectedValue(new Error("severity read failed") as never);

      const created: UserMattermost = {
        id: METHOD_ID,
        projectId: PROJECT_ID,
        userId: USER_ID,
      } as unknown as UserMattermost;

      await expect(
        callOnCreateSuccess(
          {
            createBy: createBy(),
            carryForward: null,
          } as OnCreate<UserMattermost>,
          created,
        ),
      ).resolves.toBe(created);

      expect(loggerError).toHaveBeenCalled();
    });
  });

  describe("onBeforeDelete", () => {
    test("deletes every notification rule pointing at each row being deleted", async () => {
      jest.spyOn(UserMattermostService, "findBy").mockResolvedValue([
        {
          id: METHOD_ID,
          projectId: PROJECT_ID,
        } as unknown as UserMattermost,
      ] as never);

      const deleteRules: jest.SpyInstance = jest
        .spyOn(UserNotificationRuleService, "deleteBy")
        .mockResolvedValue([] as never);

      await callOnBeforeDelete({
        query: { _id: METHOD_ID },
        props: { isRoot: true },
      });

      const arg: {
        query: { userMattermostId: ObjectID; projectId: ObjectID };
        limit: number;
      } = deleteRules.mock.calls[0][0] as {
        query: { userMattermostId: ObjectID; projectId: ObjectID };
        limit: number;
      };
      expect(arg.query.userMattermostId.toString()).toBe(METHOD_ID.toString());
      expect(arg.query.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(arg.limit).toBe(LIMIT_MAX);
    });
  });

  describe("getDeletionImpact", () => {
    test("delegates to the shared preview with methodType Mattermost", async () => {
      const getImpact: jest.SpyInstance = jest
        .spyOn(
          UserNotificationRuleService,
          "getNotificationMethodDeletionImpact",
        )
        .mockResolvedValue({} as never);

      await UserMattermostService.getDeletionImpact({
        itemId: METHOD_ID,
        projectId: PROJECT_ID,
      });

      const arg: { methodType: string } = getImpact.mock.calls[0][0] as {
        methodType: string;
      };
      expect(arg.methodType).toBe("Mattermost");
    });
  });
});
