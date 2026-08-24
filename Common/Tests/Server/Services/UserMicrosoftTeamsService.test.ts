import UserMicrosoftTeamsService from "../../../Server/Services/UserMicrosoftTeamsService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../Server/Services/WorkspaceUserAuthTokenService";
import logger from "../../../Server/Utils/Logger";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import UserMicrosoftTeams from "../../../Models/DatabaseModels/UserMicrosoftTeams";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";

/*
 * The Microsoft Teams twin of UserSlackService.test.ts — the same
 * creation-is-verification model, with the two Teams-specific differences
 * pinned: the stored id is the Microsoft Entra object id from the user's own
 * WorkspaceUserAuthToken, and the display name comes from that token's
 * miscData (captured at OAuth time) rather than from a live API call.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const METHOD_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const ENTRA_OBJECT_ID: string = "e6f1c1f7-aad0-4b6c-9c11-2f5b7c8d9e0f";

type OnBeforeCreateFunction = (
  createBy: CreateBy<UserMicrosoftTeams>,
) => Promise<OnCreate<UserMicrosoftTeams>>;

type OnCreateSuccessFunction = (
  onCreate: OnCreate<UserMicrosoftTeams>,
  createdItem: UserMicrosoftTeams,
) => Promise<UserMicrosoftTeams>;

type OnBeforeDeleteFunction = (deleteBy: {
  query: Record<string, unknown>;
  props: { isRoot: boolean };
}) => Promise<unknown>;

function callOnBeforeCreate(
  createBy: CreateBy<UserMicrosoftTeams>,
): Promise<OnCreate<UserMicrosoftTeams>> {
  return (
    UserMicrosoftTeamsService as unknown as {
      onBeforeCreate: OnBeforeCreateFunction;
    }
  ).onBeforeCreate(createBy);
}

function callOnCreateSuccess(
  onCreate: OnCreate<UserMicrosoftTeams>,
  createdItem: UserMicrosoftTeams,
): Promise<UserMicrosoftTeams> {
  return (
    UserMicrosoftTeamsService as unknown as {
      onCreateSuccess: OnCreateSuccessFunction;
    }
  ).onCreateSuccess(onCreate, createdItem);
}

function callOnBeforeDelete(deleteBy: {
  query: Record<string, unknown>;
  props: { isRoot: boolean };
}): Promise<unknown> {
  return (
    UserMicrosoftTeamsService as unknown as {
      onBeforeDelete: OnBeforeDeleteFunction;
    }
  ).onBeforeDelete(deleteBy);
}

function createBy(
  data: Partial<UserMicrosoftTeams> = {},
  props: { isRoot: boolean } = { isRoot: false },
): CreateBy<UserMicrosoftTeams> {
  return {
    data: {
      projectId: PROJECT_ID,
      userId: USER_ID,
      ...data,
    } as UserMicrosoftTeams,
    props: props,
  } as CreateBy<UserMicrosoftTeams>;
}

describe("UserMicrosoftTeamsService", () => {
  let countBy: jest.SpyInstance;
  let getProjectAuth: jest.SpyInstance;
  let getUserAuth: jest.SpyInstance;
  let loggerError: jest.SpyInstance;

  beforeEach(() => {
    loggerError = jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });

    countBy = jest
      .spyOn(UserMicrosoftTeamsService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);

    getProjectAuth = jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockResolvedValue({
        id: PROJECT_ID,
        authToken: "graph-delegated-token",
      } as unknown as WorkspaceProjectAuthToken as never);

    getUserAuth = jest
      .spyOn(WorkspaceUserAuthTokenService, "getUserAuth")
      .mockResolvedValue({
        workspaceUserId: ENTRA_OBJECT_ID,
        miscData: {
          userId: USER_ID.toString(),
          displayName: "Alice Example",
          email: "alice@example.com",
        },
      } as unknown as WorkspaceUserAuthToken as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("onBeforeCreate", () => {
    test("resolves the Entra object id from the user's own workspace link and stamps verified", async () => {
      const result: OnCreate<UserMicrosoftTeams> =
        await callOnBeforeCreate(createBy());

      expect(result.createBy.data.microsoftTeamsUserId).toBe(ENTRA_OBJECT_ID);
      expect(result.createBy.data.isVerified).toBe(true);

      const authArg: {
        workspaceType: WorkspaceType;
      } = getUserAuth.mock.calls[0][0] as { workspaceType: WorkspaceType };
      expect(authArg.workspaceType).toBe(WorkspaceType.MicrosoftTeams);
    });

    test("the display name comes from the OAuth-captured miscData, with no API call", async () => {
      const result: OnCreate<UserMicrosoftTeams> =
        await callOnBeforeCreate(createBy());

      expect(result.createBy.data.microsoftTeamsUserName).toBe("Alice Example");
    });

    test("a link with no captured display name still creates, just without a label", async () => {
      getUserAuth.mockResolvedValue({
        workspaceUserId: ENTRA_OBJECT_ID,
        miscData: { userId: USER_ID.toString() },
      } as unknown as WorkspaceUserAuthToken as never);

      const result: OnCreate<UserMicrosoftTeams> =
        await callOnBeforeCreate(createBy());

      expect(result.createBy.data.microsoftTeamsUserId).toBe(ENTRA_OBJECT_ID);
      expect(result.createBy.data.microsoftTeamsUserName).toBeUndefined();
    });

    test("a non-root caller supplying isVerified is refused", async () => {
      await expect(
        callOnBeforeCreate(createBy({ isVerified: true })),
      ).rejects.toThrow("isVerified cannot be set to true");
    });

    test("a non-root caller supplying microsoftTeamsUserId is refused - the address is never client input", async () => {
      await expect(
        callOnBeforeCreate(
          createBy({ microsoftTeamsUserId: "attacker-entra-id" }),
        ),
      ).rejects.toThrow("microsoftTeamsUserId cannot be set directly");
    });

    test("a project that is not connected to Microsoft Teams is refused with the settings pointer", async () => {
      getProjectAuth.mockResolvedValue(null as never);

      await expect(callOnBeforeCreate(createBy())).rejects.toThrow(
        "This project is not connected to Microsoft Teams. Please ask a project admin to connect Microsoft Teams in Project Settings > Microsoft Teams Integration.",
      );
    });

    test("a user who has not connected their Microsoft Teams account is refused with the settings pointer", async () => {
      getUserAuth.mockResolvedValue(null as never);

      await expect(callOnBeforeCreate(createBy())).rejects.toThrow(
        "Your Microsoft Teams account is not connected to OneUptime for this project. Please go to User Settings > Microsoft Teams Integration and connect your Microsoft Teams account first.",
      );
    });

    test("a second row for the same (user, project) is refused as a duplicate", async () => {
      countBy.mockResolvedValue(new PositiveNumber(1) as never);

      await expect(callOnBeforeCreate(createBy())).rejects.toThrow(
        "Microsoft Teams is already added as a notification method for this project.",
      );

      expect(getUserAuth).not.toHaveBeenCalled();
    });

    test("a missing projectId or userId is refused before anything is queried", async () => {
      await expect(
        callOnBeforeCreate({
          data: { userId: USER_ID } as UserMicrosoftTeams,
          props: { isRoot: false },
        } as CreateBy<UserMicrosoftTeams>),
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

    test("seeds default rules pointed at the new row via userMicrosoftTeamsId", async () => {
      const created: UserMicrosoftTeams = {
        id: METHOD_ID,
        projectId: PROJECT_ID,
        userId: USER_ID,
      } as unknown as UserMicrosoftTeams;

      await callOnCreateSuccess(
        {
          createBy: createBy(),
          carryForward: null,
        } as OnCreate<UserMicrosoftTeams>,
        created,
      );

      const arg: {
        notificationMethod: { userMicrosoftTeamsId: ObjectID };
      } = seedRules.mock.calls[0][0] as {
        notificationMethod: { userMicrosoftTeamsId: ObjectID };
      };
      expect(arg.notificationMethod.userMicrosoftTeamsId.toString()).toBe(
        METHOD_ID.toString(),
      );
    });

    test("a seeding failure is swallowed and logged - the method row is already real", async () => {
      seedRules.mockRejectedValue(new Error("severity read failed") as never);

      const created: UserMicrosoftTeams = {
        id: METHOD_ID,
        projectId: PROJECT_ID,
        userId: USER_ID,
      } as unknown as UserMicrosoftTeams;

      await expect(
        callOnCreateSuccess(
          {
            createBy: createBy(),
            carryForward: null,
          } as OnCreate<UserMicrosoftTeams>,
          created,
        ),
      ).resolves.toBe(created);

      expect(loggerError).toHaveBeenCalled();
    });
  });

  describe("onBeforeDelete", () => {
    test("deletes every notification rule pointing at each row being deleted", async () => {
      jest.spyOn(UserMicrosoftTeamsService, "findBy").mockResolvedValue([
        {
          id: METHOD_ID,
          projectId: PROJECT_ID,
        } as unknown as UserMicrosoftTeams,
      ] as never);

      const deleteRules: jest.SpyInstance = jest
        .spyOn(UserNotificationRuleService, "deleteBy")
        .mockResolvedValue([] as never);

      await callOnBeforeDelete({
        query: { _id: METHOD_ID },
        props: { isRoot: true },
      });

      const arg: {
        query: { userMicrosoftTeamsId: ObjectID; projectId: ObjectID };
        limit: number;
      } = deleteRules.mock.calls[0][0] as {
        query: { userMicrosoftTeamsId: ObjectID; projectId: ObjectID };
        limit: number;
      };
      expect(arg.query.userMicrosoftTeamsId.toString()).toBe(
        METHOD_ID.toString(),
      );
      expect(arg.query.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(arg.limit).toBe(LIMIT_MAX);
    });
  });

  describe("getDeletionImpact", () => {
    test("delegates to the shared preview with methodType Microsoft Teams", async () => {
      const getImpact: jest.SpyInstance = jest
        .spyOn(
          UserNotificationRuleService,
          "getNotificationMethodDeletionImpact",
        )
        .mockResolvedValue({} as never);

      await UserMicrosoftTeamsService.getDeletionImpact({
        itemId: METHOD_ID,
        projectId: PROJECT_ID,
      });

      const arg: { methodType: string } = getImpact.mock.calls[0][0] as {
        methodType: string;
      };
      expect(arg.methodType).toBe("Microsoft Teams");
    });
  });
});
