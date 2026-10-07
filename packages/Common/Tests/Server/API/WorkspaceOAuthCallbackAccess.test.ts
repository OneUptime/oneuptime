import CommonAPI from "../../../Server/API/CommonAPI";
import WorkspaceOAuthCallbackAccess from "../../../Server/API/WorkspaceOAuthCallbackAccess";
import WorkspaceActionAuthorization from "../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceOAuthState, {
  WorkspaceOAuthFlow,
  WorkspaceOAuthStateRecord,
} from "../../../Server/Utils/Workspace/WorkspaceOAuthState";
import UserService from "../../../Server/Services/UserService";
import logger from "../../../Server/Utils/Logger";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadRequestException from "../../../Types/Exception/BadRequestException";
import Exception from "../../../Types/Exception/Exception";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ServerException from "../../../Types/Exception/ServerException";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * What a Slack, Microsoft Teams or GitHub App connect callback asks before it
 * writes: the start's question again, of the person the spent state names,
 * as they are now - their membership read from the database, their
 * permissions by the rule every check follows (a block row never grants, a
 * block with no labels takes its permission away), a server admin let
 * through where the start lets one through.
 */

jest.mock("../../../Server/Utils/Logger");

const REFUSAL: string = "You may not finish this connection.";

interface Membership {
  allow: Array<Permission>;
  block?: Array<Permission> | undefined;
}

describe("WorkspaceOAuthCallbackAccess", () => {
  let record: WorkspaceOAuthStateRecord;
  let memberships: Map<string, Membership>;
  let masterAdmins: Set<string>;
  let membershipRead: jest.SpyInstance;
  let serverAdminRead: jest.SpyInstance;

  beforeEach(() => {
    record = {
      flow: WorkspaceOAuthFlow.SlackInstall,
      projectId: ObjectID.generate(),
      userId: ObjectID.generate(),
    };

    memberships = new Map<string, Membership>();
    masterAdmins = new Set<string>();

    membershipRead = jest
      .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
      .mockImplementation(
        async (data: {
          userId: ObjectID;
          projectId: ObjectID;
        }): Promise<DatabaseCommonInteractionProps> => {
          const membership: Membership | undefined = memberships.get(
            `${data.userId.toString()}:${data.projectId.toString()}`,
          );

          if (!membership) {
            throw new NotAuthorizedException(
              WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE,
            );
          }

          const rows: Array<UserPermission> = [
            ...membership.allow.map(
              (permission: Permission): UserPermission => {
                return {
                  _type: "UserPermission",
                  permission: permission,
                  labelIds: [],
                  isBlockPermission: false,
                };
              },
            ),
            ...(membership.block || []).map(
              (permission: Permission): UserPermission => {
                return {
                  _type: "UserPermission",
                  permission: permission,
                  labelIds: [],
                  isBlockPermission: true,
                };
              },
            ),
          ];

          return {
            userId: data.userId,
            tenantId: data.projectId,
            userTenantAccessPermission: {
              [data.projectId.toString()]: {
                _type: "UserTenantAccessPermission",
                projectId: data.projectId,
                permissions: rows,
              },
            },
            userTeamIds: [],
          };
        },
      );

    serverAdminRead = jest
      .spyOn(UserService, "findOneById")
      .mockImplementation(async (data: any): Promise<any> => {
        return { isMasterAdmin: masterAdmins.has(data.id.toString()) };
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function grant(membership: Membership): void {
    memberships.set(
      `${record.userId.toString()}:${record.projectId.toString()}`,
      membership,
    );
  }

  async function refusalOf(check: () => Promise<unknown>): Promise<unknown> {
    try {
      await check();
    } catch (err) {
      return err;
    }

    return undefined;
  }

  describe("getStartedByProps", () => {
    test("reads the membership of the state's person in the state's project", async () => {
      grant({ allow: [Permission.ProjectMember] });

      const props: DatabaseCommonInteractionProps =
        await WorkspaceOAuthCallbackAccess.getStartedByProps({
          record,
          errorMessage: REFUSAL,
        });

      const read: { userId: ObjectID; projectId: ObjectID } = membershipRead
        .mock.calls[0]![0] as { userId: ObjectID; projectId: ObjectID };

      expect(read.userId.toString()).toBe(record.userId.toString());
      expect(read.projectId.toString()).toBe(record.projectId.toString());
      expect(props.userId?.toString()).toBe(record.userId.toString());
      expect(props.tenantId?.toString()).toBe(record.projectId.toString());
    });

    test("acts as a person in one project, never as a read across projects", async () => {
      grant({ allow: [Permission.ProjectMember] });

      const props: DatabaseCommonInteractionProps =
        await WorkspaceOAuthCallbackAccess.getStartedByProps({
          record,
          errorMessage: REFUSAL,
        });

      expect(props.userType).toBe(UserType.User);
      expect(props.isMasterAdmin).toBe(false);
      expect(props.isMultiTenantRequest).toBe(false);
      expect(props.isRoot).toBeUndefined();
    });

    test("someone who is no longer a member is refused with the callback's own sentence", async () => {
      const refusal: unknown = await refusalOf(() => {
        return WorkspaceOAuthCallbackAccess.getStartedByProps({
          record,
          errorMessage: REFUSAL,
        });
      });

      expect(refusal).toBeInstanceOf(NotAuthorizedException);
      expect((refusal as Error).message).toBe(REFUSAL);
    });

    test("a membership read that fails is an error, not a refusal", async () => {
      membershipRead.mockImplementation(async () => {
        throw new Error("database unavailable");
      });

      const refusal: unknown = await refusalOf(() => {
        return WorkspaceOAuthCallbackAccess.getStartedByProps({
          record,
          errorMessage: REFUSAL,
        });
      });

      expect(refusal).not.toBeInstanceOf(NotAuthorizedException);
      expect((refusal as Error).message).toBe("database unavailable");
    });

    test("a server-admin read that fails is an error, not a refusal", async () => {
      grant({ allow: [Permission.ProjectMember] });
      serverAdminRead.mockImplementation(async () => {
        throw new Error("database unavailable");
      });

      const refusal: unknown = await refusalOf(() => {
        return WorkspaceOAuthCallbackAccess.getStartedByProps({
          record,
          errorMessage: REFUSAL,
        });
      });

      expect(refusal).not.toBeInstanceOf(NotAuthorizedException);
      expect((refusal as Error).message).toBe("database unavailable");
    });

    test("whether they are a server admin is read as it is now", async () => {
      grant({ allow: [Permission.Viewer] });
      masterAdmins.add(record.userId.toString());

      const props: DatabaseCommonInteractionProps =
        await WorkspaceOAuthCallbackAccess.getStartedByProps({
          record,
          errorMessage: REFUSAL,
        });

      expect(props.isMasterAdmin).toBe(true);
      expect(props.userType).toBe(UserType.MasterAdmin);
    });
  });

  describe("assertStartedByIsMember (signing in with Slack or Microsoft Teams)", () => {
    test.each([
      Permission.Viewer,
      Permission.ProjectMember,
      Permission.ProjectOwner,
    ])("any member may finish: %s", async (permission: Permission) => {
      grant({ allow: [permission] });

      await expect(
        WorkspaceOAuthCallbackAccess.assertStartedByIsMember({ record }),
      ).resolves.toBeUndefined();
    });

    test("someone who left the project is told they are not a member", async () => {
      const refusal: unknown = await refusalOf(() => {
        return WorkspaceOAuthCallbackAccess.assertStartedByIsMember({ record });
      });

      expect(refusal).toBeInstanceOf(NotAuthorizedException);
      expect((refusal as Error).message).toBe(
        WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE,
      );
    });

    test("asks membership alone: whether they are a server admin is not read", async () => {
      grant({ allow: [Permission.Viewer] });

      await WorkspaceOAuthCallbackAccess.assertStartedByIsMember({ record });

      expect(membershipRead).toHaveBeenCalledTimes(1);
      expect(serverAdminRead).not.toHaveBeenCalled();
    });

    test("a server admin who left the project is not a member either", async () => {
      masterAdmins.add(record.userId.toString());

      const refusal: unknown = await refusalOf(() => {
        return WorkspaceOAuthCallbackAccess.assertStartedByIsMember({ record });
      });

      expect(refusal).toBeInstanceOf(NotAuthorizedException);
    });
  });

  describe("assertStartedByMayManageConnection (connecting Slack, Teams admin consent)", () => {
    test("asks the rule the start asks, with the callback's sentence", async () => {
      grant({ allow: [Permission.ProjectAdmin] });

      const startRule: jest.SpyInstance = jest.spyOn(
        CommonAPI,
        "assertPermittedInProject",
      );

      await WorkspaceOAuthCallbackAccess.assertStartedByMayManageConnection({
        record,
        errorMessage: REFUSAL,
      });

      expect(startRule).toHaveBeenCalledTimes(1);

      const asked: {
        databaseProps: DatabaseCommonInteractionProps;
        allowedPermissions: Array<Permission>;
        errorMessage?: string | undefined;
      } = startRule.mock.calls[0]![0] as {
        databaseProps: DatabaseCommonInteractionProps;
        allowedPermissions: Array<Permission>;
        errorMessage?: string | undefined;
      };

      expect(asked.allowedPermissions).toEqual(
        WorkspaceOAuthState.MANAGE_CONNECTION_PERMISSIONS,
      );
      expect(asked.errorMessage).toBe(REFUSAL);
      expect(asked.databaseProps.userId?.toString()).toBe(
        record.userId.toString(),
      );
      expect(asked.databaseProps.tenantId?.toString()).toBe(
        record.projectId.toString(),
      );
    });

    test.each(WorkspaceOAuthState.MANAGE_CONNECTION_PERMISSIONS)(
      "%s may finish connecting the project",
      async (permission: Permission) => {
        grant({ allow: [permission] });

        await expect(
          WorkspaceOAuthCallbackAccess.assertStartedByMayManageConnection({
            record,
            errorMessage: REFUSAL,
          }),
        ).resolves.toBeUndefined();
      },
    );

    test.each([
      Permission.Viewer,
      Permission.IncidentMember,
      Permission.SettingsAdmin,
    ])(
      "a member who is only %s by now is refused with the callback's sentence",
      async (permission: Permission) => {
        grant({ allow: [permission] });

        const refusal: unknown = await refusalOf(() => {
          return WorkspaceOAuthCallbackAccess.assertStartedByMayManageConnection(
            { record, errorMessage: REFUSAL },
          );
        });

        expect(refusal).toBeInstanceOf(NotAuthorizedException);
        expect((refusal as Error).message).toBe(REFUSAL);
      },
    );

    test("a team's block with no labels takes the role away", async () => {
      grant({
        allow: [Permission.ProjectMember],
        block: [Permission.ProjectMember],
      });

      const refusal: unknown = await refusalOf(() => {
        return WorkspaceOAuthCallbackAccess.assertStartedByMayManageConnection({
          record,
          errorMessage: REFUSAL,
        });
      });

      expect(refusal).toBeInstanceOf(NotAuthorizedException);
    });

    test("a block row is no grant", async () => {
      grant({ allow: [Permission.Viewer], block: [Permission.ProjectAdmin] });

      const refusal: unknown = await refusalOf(() => {
        return WorkspaceOAuthCallbackAccess.assertStartedByMayManageConnection({
          record,
          errorMessage: REFUSAL,
        });
      });

      expect(refusal).toBeInstanceOf(NotAuthorizedException);
    });

    test("a server admin who is a member may finish, as the start lets them", async () => {
      grant({ allow: [Permission.Viewer] });
      masterAdmins.add(record.userId.toString());

      await expect(
        WorkspaceOAuthCallbackAccess.assertStartedByMayManageConnection({
          record,
          errorMessage: REFUSAL,
        }),
      ).resolves.toBeUndefined();
    });

    test("someone who left the project is refused with the callback's sentence, server admin or not", async () => {
      masterAdmins.add(record.userId.toString());

      const refusal: unknown = await refusalOf(() => {
        return WorkspaceOAuthCallbackAccess.assertStartedByMayManageConnection({
          record,
          errorMessage: REFUSAL,
        });
      });

      expect(refusal).toBeInstanceOf(NotAuthorizedException);
      expect((refusal as Error).message).toBe(REFUSAL);
    });
  });

  describe("answerFor (what a callback answers when it was not let through)", () => {
    test("a refusal is answered as it is, with its own sentence and status", () => {
      const refusal: NotAuthorizedException = new NotAuthorizedException(
        REFUSAL,
      );

      expect(WorkspaceOAuthCallbackAccess.answerFor(refusal)).toBe(refusal);

      const badRequest: BadRequestException = new BadRequestException(
        "This link has already been used.",
      );

      expect(WorkspaceOAuthCallbackAccess.answerFor(badRequest)).toBe(
        badRequest,
      );
    });

    test("anything else is logged and answered plainly, never with its own message", () => {
      const failure: Error = new Error(
        'relation "TeamMember" does not exist at character 15',
      );

      const answer: Exception = WorkspaceOAuthCallbackAccess.answerFor(failure);

      expect(answer).toBeInstanceOf(ServerException);
      expect(answer.message).toBe(
        WorkspaceOAuthCallbackAccess.COULD_NOT_CHECK_MESSAGE,
      );
      expect(answer.message).not.toContain("TeamMember");
      expect(logger.error).toHaveBeenCalledWith(failure);
    });

    test("something thrown that is not even an Error is answered plainly too", () => {
      const answer: Exception =
        WorkspaceOAuthCallbackAccess.answerFor("connection reset");

      expect(answer).toBeInstanceOf(ServerException);
      expect(answer.message).toBe(
        WorkspaceOAuthCallbackAccess.COULD_NOT_CHECK_MESSAGE,
      );
    });
  });
});
