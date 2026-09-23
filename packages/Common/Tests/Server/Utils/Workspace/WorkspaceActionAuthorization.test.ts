import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentInternalNote from "../../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentPublicNote from "../../../../Models/DatabaseModels/IncidentPublicNote";
import IncidentStateTimeline from "../../../../Models/DatabaseModels/IncidentStateTimeline";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import AccessTokenService from "../../../../Server/Services/AccessTokenService";
import IncidentService from "../../../../Server/Services/IncidentService";
import OnCallDutyPolicyService from "../../../../Server/Services/OnCallDutyPolicyService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import WorkspaceActionAuthorization from "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";

/*
 * Slack and Microsoft Teams actions used to write as root for anyone whose
 * chat account was linked to a OneUptime user - a read-only member, or someone
 * already removed from the project. WorkspaceActionAuthorization is the gate
 * every chat write now goes through. These tests run its real permission
 * logic; only the database reads (TeamMember, the permission cache, the
 * resource lookup) are stubbed.
 */

type PermissionInput = {
  permission: Permission;
  isBlockPermission?: boolean;
};

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

function createTenantPermission(
  permissions: Array<PermissionInput>,
): UserTenantAccessPermission {
  return {
    _type: "UserTenantAccessPermission",
    projectId: projectId,
    permissions: permissions.map((input: PermissionInput): UserPermission => {
      return {
        _type: "UserPermission",
        permission: input.permission,
        isBlockPermission: input.isBlockPermission || false,
        labelIds: [],
      };
    }),
  };
}

function createProps(
  permissions: Array<PermissionInput>,
): DatabaseCommonInteractionProps {
  return {
    userId: userId,
    tenantId: projectId,
    userTeamIds: [],
    userTenantAccessPermission: {
      [projectId.toString()]: createTenantPermission(permissions),
    },
  };
}

function createMembership(teamId: ObjectID): TeamMember {
  const member: TeamMember = new TeamMember();
  member.teamId = teamId;
  return member;
}

function mockIncidentLookup(
  incident: Incident | null,
): SpyInstance<typeof IncidentService.findOneBy> {
  return jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(incident);
}

function createIncident(): Incident {
  const incident: Incident = new Incident();
  incident.id = ObjectID.generate();
  return incident;
}

afterEach((): void => {
  jest.restoreAllMocks();
});

describe("WorkspaceActionAuthorization.getProjectMemberProps", (): void => {
  test("refuses a linked user who no longer holds an accepted membership", async (): Promise<void> => {
    const membershipSpy: SpyInstance<typeof TeamMemberService.findBy> = jest
      .spyOn(TeamMemberService, "findBy")
      .mockResolvedValue([]);
    /*
     * The permission cache is exactly what must not decide this: it can still
     * hold the permissions the user had before they were removed.
     */
    const tenantPermissionSpy: SpyInstance<
      typeof AccessTokenService.getUserTenantAccessPermission
    > = jest
      .spyOn(AccessTokenService, "getUserTenantAccessPermission")
      .mockResolvedValue(
        createTenantPermission([{ permission: Permission.ProjectOwner }]),
      );

    await expect(
      WorkspaceActionAuthorization.getProjectMemberProps({
        userId: userId,
        projectId: projectId,
      }),
    ).rejects.toThrow(
      WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE,
    );

    expect(membershipSpy.mock.calls[0]![0]).toMatchObject({
      query: {
        userId: userId,
        projectId: projectId,
        hasAcceptedInvitation: true,
      },
      props: {
        isRoot: true,
      },
    });
    expect(tenantPermissionSpy).not.toHaveBeenCalled();
  });

  test("refuses a member with no tenant permission", async (): Promise<void> => {
    jest
      .spyOn(TeamMemberService, "findBy")
      .mockResolvedValue([createMembership(ObjectID.generate())]);
    jest
      .spyOn(AccessTokenService, "getUserGlobalAccessPermission")
      .mockResolvedValue(null);
    jest
      .spyOn(AccessTokenService, "getUserTenantAccessPermission")
      .mockResolvedValue(null);

    await expect(
      WorkspaceActionAuthorization.getProjectMemberProps({
        userId: userId,
        projectId: projectId,
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });

  test("builds a member's props with their tenant permission and accepted teams", async (): Promise<void> => {
    const teamA: ObjectID = ObjectID.generate();
    const teamB: ObjectID = ObjectID.generate();
    const tenantPermission: UserTenantAccessPermission = createTenantPermission(
      [{ permission: Permission.IncidentMember }],
    );
    jest
      .spyOn(TeamMemberService, "findBy")
      .mockResolvedValue([
        createMembership(teamA),
        createMembership(teamB),
        createMembership(teamA),
      ]);
    jest
      .spyOn(AccessTokenService, "getUserTenantAccessPermission")
      .mockResolvedValue(tenantPermission);
    jest
      .spyOn(AccessTokenService, "getUserGlobalAccessPermission")
      .mockResolvedValue(null);

    const props: DatabaseCommonInteractionProps =
      await WorkspaceActionAuthorization.getProjectMemberProps({
        userId: userId,
        projectId: projectId,
      });

    expect(props.userId).toBe(userId);
    expect(props.tenantId).toBe(projectId);
    expect(props.isRoot).toBeUndefined();
    expect(props.userTeamIds).toEqual([teamA, teamB]);
    expect(props.userTenantAccessPermission).toEqual({
      [projectId.toString()]: tenantPermission,
    });
  });

  test("isProjectMember reads accepted memberships", async (): Promise<void> => {
    const membershipSpy: SpyInstance<typeof TeamMemberService.findBy> = jest
      .spyOn(TeamMemberService, "findBy")
      .mockResolvedValueOnce([createMembership(ObjectID.generate())])
      .mockResolvedValueOnce([]);

    await expect(
      WorkspaceActionAuthorization.isProjectMember({ userId, projectId }),
    ).resolves.toBe(true);
    await expect(
      WorkspaceActionAuthorization.isProjectMember({ userId, projectId }),
    ).resolves.toBe(false);
    expect(membershipSpy.mock.calls[1]![0].query).toMatchObject({
      hasAcceptedInvitation: true,
    });
  });
});

describe("WorkspaceActionAuthorization.assertCanCreate", (): void => {
  test("refuses a read-only member who tries to acknowledge an incident", async (): Promise<void> => {
    const lookupSpy: SpyInstance<typeof IncidentService.findOneBy> =
      mockIncidentLookup(createIncident());

    const refusal: Promise<void> = WorkspaceActionAuthorization.assertCanCreate(
      {
        props: createProps([
          { permission: Permission.Viewer },
          { permission: Permission.IncidentViewer },
        ]),
        modelType: IncidentStateTimeline,
        action: "acknowledge this incident",
        resources: [{ service: IncidentService, id: ObjectID.generate() }],
      },
    );

    await expect(refusal).rejects.toBeInstanceOf(NotAuthorizedException);
    await expect(refusal).rejects.toThrow(
      "You do not have permission to acknowledge this incident.",
    );
    expect(lookupSpy).not.toHaveBeenCalled();
  });

  test("refuses an incident viewer who tries to post a public status-page note", async (): Promise<void> => {
    mockIncidentLookup(createIncident());

    await expect(
      WorkspaceActionAuthorization.assertCanCreate({
        props: createProps([{ permission: Permission.IncidentViewer }]),
        modelType: IncidentPublicNote,
        action: "add a public note to this incident",
        resources: [{ service: IncidentService, id: ObjectID.generate() }],
      }),
    ).rejects.toThrow("add a public note to this incident");
  });

  test("allows a project member to acknowledge an incident they can read", async (): Promise<void> => {
    const incidentId: ObjectID = ObjectID.generate();
    const props: DatabaseCommonInteractionProps = createProps([
      { permission: Permission.ProjectMember },
    ]);
    const lookupSpy: SpyInstance<typeof IncidentService.findOneBy> =
      mockIncidentLookup(createIncident());

    await expect(
      WorkspaceActionAuthorization.assertCanCreate({
        props: props,
        modelType: IncidentStateTimeline,
        action: "acknowledge this incident",
        resources: [{ service: IncidentService, id: incidentId }],
      }),
    ).resolves.toBeUndefined();

    /*
     * The incident is looked up with the user's own props - so their label,
     * owner and privacy scoping apply - and inside this project only.
     */
    expect(lookupSpy).toHaveBeenCalledTimes(1);
    expect(lookupSpy.mock.calls[0]![0].props).toBe(props);
    expect(lookupSpy.mock.calls[0]![0].query).toEqual({
      _id: incidentId.toString(),
      projectId: projectId,
    });
  });

  test("grants exactly what the dashboard grants: the fine-grained create permission is enough", async (): Promise<void> => {
    mockIncidentLookup(createIncident());

    await expect(
      WorkspaceActionAuthorization.assertCanCreate({
        props: createProps([
          { permission: Permission.CreateIncidentStateTimeline },
        ]),
        modelType: IncidentStateTimeline,
        action: "resolve this incident",
        resources: [{ service: IncidentService, id: ObjectID.generate() }],
      }),
    ).resolves.toBeUndefined();
  });

  test("honors a block permission even when a role would otherwise allow the note", async (): Promise<void> => {
    mockIncidentLookup(createIncident());

    await expect(
      WorkspaceActionAuthorization.assertCanCreate({
        props: createProps([
          { permission: Permission.ProjectMember },
          {
            permission: Permission.CreateIncidentPublicNote,
            isBlockPermission: true,
          },
        ]),
        modelType: IncidentPublicNote,
        action: "add a public note to this incident",
        resources: [{ service: IncidentService, id: ObjectID.generate() }],
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });

  test("refuses when the incident is not visible to the user in this project", async (): Promise<void> => {
    // A label-scoped, private or other-project incident comes back as null.
    mockIncidentLookup(null);

    await expect(
      WorkspaceActionAuthorization.assertCanCreate({
        props: createProps([{ permission: Permission.ProjectMember }]),
        modelType: IncidentInternalNote,
        action: "add a private note to this incident",
        resources: [{ service: IncidentService, id: ObjectID.generate() }],
      }),
    ).rejects.toThrow(
      "You do not have permission to add a private note to this incident: the incident was not found in this project, or you do not have access to it.",
    );
  });

  test("refuses when reading the incident is itself not permitted", async (): Promise<void> => {
    jest
      .spyOn(IncidentService, "findOneBy")
      .mockRejectedValue(new NotAuthorizedException("no read"));

    await expect(
      WorkspaceActionAuthorization.assertCanCreate({
        props: createProps([
          { permission: Permission.CreateIncidentStateTimeline },
        ]),
        modelType: IncidentStateTimeline,
        action: "acknowledge this incident",
        resources: [{ service: IncidentService, id: ObjectID.generate() }],
      }),
    ).rejects.toThrow("the incident was not found in this project");
  });

  test("the real read path refuses a user who may write timelines but not read incidents", async (): Promise<void> => {
    await expect(
      WorkspaceActionAuthorization.assertCanCreate({
        props: createProps([
          { permission: Permission.CreateIncidentStateTimeline },
        ]),
        modelType: IncidentStateTimeline,
        action: "acknowledge this incident",
        resources: [{ service: IncidentService, id: ObjectID.generate() }],
      }),
    ).rejects.toThrow("the incident was not found in this project");
  });

  test("every named resource must be readable: an on-call policy the user cannot see is refused", async (): Promise<void> => {
    mockIncidentLookup(createIncident());
    const policyLookupSpy: SpyInstance<
      typeof OnCallDutyPolicyService.findOneBy
    > = jest
      .spyOn(OnCallDutyPolicyService, "findOneBy")
      .mockResolvedValue(null);

    await expect(
      WorkspaceActionAuthorization.assertCanCreate({
        props: createProps([{ permission: Permission.ProjectMember }]),
        modelType: OnCallDutyPolicyExecutionLog,
        action: "execute an on-call policy for this incident",
        resources: [
          { service: IncidentService, id: ObjectID.generate() },
          { service: OnCallDutyPolicyService, id: ObjectID.generate() },
        ],
      }),
    ).rejects.toThrow("the on-call policy was not found in this project");
    expect(policyLookupSpy).toHaveBeenCalledTimes(1);
  });

  test("an on-call page needs the on-call execution permission, not just incident access", async (): Promise<void> => {
    mockIncidentLookup(createIncident());
    jest
      .spyOn(OnCallDutyPolicyService, "findOneBy")
      .mockResolvedValue(new OnCallDutyPolicy());

    await expect(
      WorkspaceActionAuthorization.assertCanCreate({
        props: createProps([
          { permission: Permission.IncidentMember },
          { permission: Permission.OnCallViewer },
        ]),
        modelType: OnCallDutyPolicyExecutionLog,
        action: "execute an on-call policy for this incident",
        resources: [
          { service: IncidentService, id: ObjectID.generate() },
          { service: OnCallDutyPolicyService, id: ObjectID.generate() },
        ],
      }),
    ).rejects.toThrow("execute an on-call policy for this incident");
  });

  test("a create with no resource checks only the create permission", async (): Promise<void> => {
    await expect(
      WorkspaceActionAuthorization.assertCanCreate({
        props: createProps([{ permission: Permission.Viewer }]),
        modelType: ScheduledMaintenance,
        action: "create a scheduled maintenance event",
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);

    await expect(
      WorkspaceActionAuthorization.assertCanCreate({
        props: createProps([
          { permission: Permission.ScheduledMaintenanceMember },
        ]),
        modelType: ScheduledMaintenance,
        action: "create a scheduled maintenance event",
      }),
    ).resolves.toBeUndefined();
  });

  test("refuses props without a user or a project", async (): Promise<void> => {
    await expect(
      WorkspaceActionAuthorization.assertCanCreate({
        props: { isRoot: true },
        modelType: IncidentStateTimeline,
        action: "acknowledge this incident",
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });

  test("does not swallow errors that are not refusals", async (): Promise<void> => {
    const failure: BadDataException = new BadDataException("database down");
    jest.spyOn(IncidentService, "findOneBy").mockRejectedValue(failure);

    await expect(
      WorkspaceActionAuthorization.assertCanCreate({
        props: createProps([{ permission: Permission.ProjectMember }]),
        modelType: IncidentStateTimeline,
        action: "acknowledge this incident",
        resources: [{ service: IncidentService, id: ObjectID.generate() }],
      }),
    ).rejects.toBe(failure);
  });
});

describe("WorkspaceActionAuthorization.authorize", (): void => {
  test("a removed member is refused before any permission is consulted", async (): Promise<void> => {
    jest.spyOn(TeamMemberService, "findBy").mockResolvedValue([]);
    const lookupSpy: SpyInstance<typeof IncidentService.findOneBy> =
      mockIncidentLookup(createIncident());

    await expect(
      WorkspaceActionAuthorization.authorize({
        userId: userId,
        projectId: projectId,
        modelType: IncidentStateTimeline,
        action: "resolve this incident",
        resources: [{ service: IncidentService, id: ObjectID.generate() }],
      }),
    ).rejects.toThrow(
      WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE,
    );
    expect(lookupSpy).not.toHaveBeenCalled();
  });

  test("returns the member's props once the action is allowed", async (): Promise<void> => {
    const teamId: ObjectID = ObjectID.generate();
    jest
      .spyOn(TeamMemberService, "findBy")
      .mockResolvedValue([createMembership(teamId)]);
    jest
      .spyOn(AccessTokenService, "getUserTenantAccessPermission")
      .mockResolvedValue(
        createTenantPermission([{ permission: Permission.IncidentMember }]),
      );
    jest
      .spyOn(AccessTokenService, "getUserGlobalAccessPermission")
      .mockResolvedValue(null);
    mockIncidentLookup(createIncident());

    const props: DatabaseCommonInteractionProps =
      await WorkspaceActionAuthorization.authorize({
        userId: userId,
        projectId: projectId,
        modelType: IncidentPublicNote,
        action: "add a public note to this incident",
        resources: [{ service: IncidentService, id: ObjectID.generate() }],
      });

    expect(props.userId).toBe(userId);
    expect(props.tenantId).toBe(projectId);
    expect(props.userTeamIds).toEqual([teamId]);
  });
});
