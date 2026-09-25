import DiscordAPI from "../../../Server/API/DiscordAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import Incident from "../../../Models/DatabaseModels/Incident";
import WorkspaceActionAuthorization from "../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";

/*
 * A Discord identity link proves who clicked, not what that person may do now.
 * These are the two ways a previously valid link can become unsafe:
 *
 * 1. Every accepted project membership is removed after account linking.
 * 2. Membership remains, but the actor's current team grants no Incident
 *    update permission or explicitly blocks it.
 *
 * The interaction path must rebuild current membership and permission props
 * for every click. A stored Discord link alone never authorizes a write.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

type DiscordIncidentAuthorization = typeof DiscordAPI & {
  authorizeIncidentActionActor: (
    projectId: ObjectID,
    userId: ObjectID,
  ) => Promise<void>;
};

const authorize: () => Promise<void> = async (): Promise<void> => {
  await (
    DiscordAPI as DiscordIncidentAuthorization
  ).authorizeIncidentActionActor(PROJECT_ID, USER_ID);
};

afterEach((): void => {
  jest.restoreAllMocks();
});

test("rejects a linked Discord user whose project membership was removed", async (): Promise<void> => {
  const removed: NotAuthorizedException = new NotAuthorizedException(
    WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE,
  );
  jest
    .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
    .mockRejectedValue(removed);
  const permissionGuard: jest.SpyInstance = jest.spyOn(
    CommonAPI,
    "assertPermittedInProject",
  );

  await expect(authorize()).rejects.toBe(removed);
  expect(permissionGuard).not.toHaveBeenCalled();
});

test("checks the linked member's current Incident update permissions", async (): Promise<void> => {
  const props: DatabaseCommonInteractionProps = {
    userId: USER_ID,
    tenantId: PROJECT_ID,
  };
  jest
    .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
    .mockResolvedValue(props);
  const denied: NotAuthorizedException = new NotAuthorizedException(
    "You do not have permission to update incidents from Discord.",
  );
  const permissionGuard: jest.SpyInstance = jest
    .spyOn(CommonAPI, "assertPermittedInProject")
    .mockImplementation((): void => {
      throw denied;
    });

  await expect(authorize()).rejects.toBe(denied);
  expect(permissionGuard).toHaveBeenCalledWith({
    databaseProps: props,
    allowedPermissions: new Incident().getUpdatePermissions(),
    errorMessage:
      "You do not have permission to update incidents from Discord.",
  });
});
