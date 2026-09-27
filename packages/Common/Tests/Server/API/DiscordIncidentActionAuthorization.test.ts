import DiscordAPI from "../../../Server/API/DiscordAPI";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import IncidentService from "../../../Server/Services/IncidentService";
import WorkspaceActionAuthorization from "../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceResourceUpdateAuthorization from "../../../Server/Utils/Workspace/WorkspaceResourceUpdateAuthorization";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";

/*
 * A Discord identity link proves who clicked, not what that person may do now.
 * These are the two ways a previously valid link can become unsafe:
 *
 * 1. Every accepted project membership is removed after account linking.
 * 2. Membership remains, but the actor cannot create the timeline row written
 *    by acknowledge/resolve, cannot see the incident, or cannot update it.
 *
 * The interaction path must rebuild current membership and permission props
 * for every click. A stored Discord link alone never authorizes a write.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const INCIDENT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

type DiscordIncidentAuthorization = typeof DiscordAPI & {
  authorizeIncidentActionActor: (data: {
    projectId: ObjectID;
    userId: ObjectID;
    incidentId: ObjectID;
    action: "acknowledge" | "resolve";
  }) => Promise<void>;
};

const authorize: (action?: "acknowledge" | "resolve") => Promise<void> = async (
  action: "acknowledge" | "resolve" = "acknowledge",
): Promise<void> => {
  await (
    DiscordAPI as DiscordIncidentAuthorization
  ).authorizeIncidentActionActor({
    projectId: PROJECT_ID,
    userId: USER_ID,
    incidentId: INCIDENT_ID,
    action,
  });
};

afterEach((): void => {
  jest.restoreAllMocks();
});

test("rejects a linked Discord user whose project membership was removed", async (): Promise<void> => {
  const removed: NotAuthorizedException = new NotAuthorizedException(
    WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE,
  );
  jest
    .spyOn(WorkspaceActionAuthorization, "authorize")
    .mockRejectedValue(removed);
  const updateGuard: jest.SpyInstance = jest.spyOn(
    WorkspaceResourceUpdateAuthorization,
    "assertCanUpdateIncident",
  );

  await expect(authorize()).rejects.toBe(removed);
  expect(updateGuard).not.toHaveBeenCalled();
});

test("checks timeline creation, scoped incident visibility, and incident update permission", async (): Promise<void> => {
  const props: DatabaseCommonInteractionProps = {
    userId: USER_ID,
    tenantId: PROJECT_ID,
  };
  const createAndScopeGuard: jest.SpyInstance = jest
    .spyOn(WorkspaceActionAuthorization, "authorize")
    .mockResolvedValue(props);
  const updateGuard: jest.SpyInstance = jest
    .spyOn(WorkspaceResourceUpdateAuthorization, "assertCanUpdateIncident")
    .mockResolvedValue();

  await expect(authorize("resolve")).resolves.toBeUndefined();
  expect(createAndScopeGuard).toHaveBeenCalledWith({
    userId: USER_ID,
    projectId: PROJECT_ID,
    modelType: IncidentStateTimeline,
    action: "resolve this incident",
    resources: [{ service: IncidentService, id: INCIDENT_ID }],
  });
  expect(updateGuard).toHaveBeenCalledWith({
    incidentId: INCIDENT_ID,
    projectId: PROJECT_ID,
    props,
  });
});

test("does not check update permission after scoped timeline authorization fails", async (): Promise<void> => {
  const denied: NotAuthorizedException = new NotAuthorizedException(
    "You do not have permission to acknowledge this incident.",
  );
  jest
    .spyOn(WorkspaceActionAuthorization, "authorize")
    .mockRejectedValue(denied);
  const updateGuard: jest.SpyInstance = jest.spyOn(
    WorkspaceResourceUpdateAuthorization,
    "assertCanUpdateIncident",
  );

  await expect(authorize()).rejects.toBe(denied);
  expect(updateGuard).not.toHaveBeenCalled();
});
