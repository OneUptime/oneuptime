import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
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
import ModelPermission from "../../../../Server/Types/Database/Permissions/Index";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ExceptionMessages from "../../../../Types/Exception/ExceptionMessages";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import ProjectService from "../../../../Server/Services/ProjectService";
import UserService from "../../../../Server/Services/UserService";
import { PlanType } from "../../../../Types/Billing/SubscriptionPlan";
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

beforeEach((): void => {
  // Not a blocked project: that refusal has suites of its own (BlockedProject*).
  jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
  // Nor a blocked person (WorkspaceActionAuthorization asks that too).
  jest.spyOn(UserService, "isUserBlocked").mockResolvedValue(false);
  // The project's plan, as the action's checks read it where a plan decides (CallerPlan).
  jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
    plan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
  });
});

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

  /*
   * Blocking a person ends their sessions; their memberships and chat links
   * stay. A member a master admin blocked acted from Slack and Microsoft
   * Teams all the same - acknowledging incidents, paging on-call - until the
   * chat path asked what an MCP client's path asks.
   */
  test("refuses a member a master admin blocked, before reading what they hold", async (): Promise<void> => {
    jest
      .spyOn(TeamMemberService, "findBy")
      .mockResolvedValue([createMembership(ObjectID.generate())]);
    jest.spyOn(UserService, "isUserBlocked").mockResolvedValue(true);
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
    ).rejects.toThrow(ExceptionMessages.UserBlocked);

    expect(UserService.isUserBlocked).toHaveBeenCalledWith(userId);
    expect(tenantPermissionSpy).not.toHaveBeenCalled();
  });

  test("tells somebody who is not a member only that, blocked or not", async (): Promise<void> => {
    jest.spyOn(TeamMemberService, "findBy").mockResolvedValue([]);
    jest.spyOn(UserService, "isUserBlocked").mockResolvedValue(true);

    await expect(
      WorkspaceActionAuthorization.getProjectMemberProps({
        userId: userId,
        projectId: projectId,
      }),
    ).rejects.toThrow(
      WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE,
    );
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

  /*
   * A record the member may not read is refused with what is actually
   * wrong - never "not found" for a record that is there. The chat showed
   * them the record's message, so that it is there is nothing new to them;
   * nothing else about it is read out.
   */
  test("an incident their access does not include: so, and who to ask - not 'not found'", async (): Promise<void> => {
    const incidentId: ObjectID = ObjectID.generate();
    const props: DatabaseCommonInteractionProps = createProps([
      { permission: Permission.ProjectMember },
    ]);
    // Their own read finds nothing (labels, owners); OneUptime's finds it.
    const lookupSpy: SpyInstance<typeof IncidentService.findOneBy> = jest
      .spyOn(IncidentService, "findOneBy")
      .mockImplementation((async (findOneBy: {
        props: DatabaseCommonInteractionProps;
      }) => {
        return findOneBy.props.isRoot ? createIncident() : null;
      }) as never);

    await expect(
      WorkspaceActionAuthorization.assertCanCreate({
        props: props,
        modelType: IncidentInternalNote,
        action: "add a private note to this incident",
        resources: [{ service: IncidentService, id: incidentId }],
      }),
    ).rejects.toThrow(
      "You do not have permission to add a private note to this incident: your access in this project does not include this incident. Ask a project admin for access to it.",
    );

    // The member's read, then OneUptime's: is it there, is it private to them.
    expect(lookupSpy).toHaveBeenCalledTimes(3);
    expect(lookupSpy.mock.calls[1]![0]).toEqual({
      query: { _id: incidentId.toString(), projectId: projectId },
      select: { _id: true },
      props: { isRoot: true },
    });
    expect(lookupSpy.mock.calls[2]![0].props).toEqual({ isRoot: true });
    expect(Object.keys(lookupSpy.mock.calls[2]![0].query).sort()).toEqual([
      "_id",
      "isPrivate",
      "projectId",
    ]);
  });

  test("a private incident they do not own: that it is private, and who can add them", async (): Promise<void> => {
    jest
      .spyOn(IncidentService, "findOneBy")
      .mockImplementation((async (findOneBy: {
        query: Record<string, unknown>;
        props: DatabaseCommonInteractionProps;
      }) => {
        if (!findOneBy.props.isRoot) {
          return null;
        }

        // OneUptime finds it - but not under the member's rule for private ones.
        return findOneBy.query["isPrivate"] === undefined
          ? createIncident()
          : null;
      }) as never);

    await expect(
      WorkspaceActionAuthorization.assertCanCreate({
        props: createProps([{ permission: Permission.ProjectMember }]),
        modelType: IncidentStateTimeline,
        action: "acknowledge this incident",
        resources: [{ service: IncidentService, id: ObjectID.generate() }],
      }),
    ).rejects.toThrow(
      "You do not have permission to acknowledge this incident: this incident is private, so only its owners and the project's owners and admins can see it. Ask one of them to add you as an owner.",
    );
  });

  test("a project admin, who sees every private incident, is not told it is private", async (): Promise<void> => {
    const lookupSpy: SpyInstance<typeof IncidentService.findOneBy> = jest
      .spyOn(IncidentService, "findOneBy")
      .mockImplementation((async (findOneBy: {
        props: DatabaseCommonInteractionProps;
      }) => {
        return findOneBy.props.isRoot ? createIncident() : null;
      }) as never);

    await expect(
      WorkspaceActionAuthorization.assertCanCreate({
        props: createProps([{ permission: Permission.ProjectAdmin }]),
        modelType: IncidentStateTimeline,
        action: "acknowledge this incident",
        resources: [{ service: IncidentService, id: ObjectID.generate() }],
      }),
    ).rejects.toThrow(
      "your access in this project does not include this incident",
    );
    // No read under the rule for private records: it does not hold them.
    expect(lookupSpy).toHaveBeenCalledTimes(2);
  });

  test("an incident that is gone: not found - it may have been deleted", async (): Promise<void> => {
    mockIncidentLookup(null);

    const refusal: Promise<void> = WorkspaceActionAuthorization.assertCanCreate(
      {
        props: createProps([{ permission: Permission.ProjectMember }]),
        modelType: IncidentStateTimeline,
        action: "acknowledge this incident",
        resources: [{ service: IncidentService, id: ObjectID.generate() }],
      },
    );

    await expect(refusal).rejects.toBeInstanceOf(NotAuthorizedException);
    await expect(refusal).rejects.toThrow(
      "Could not acknowledge this incident: the incident was not found. It may have been deleted.",
    );
  });

  test("a read refused for its permission says which permission, after what they pressed", async (): Promise<void> => {
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
    ).rejects.toThrow(
      "You do not have permission to acknowledge this incident. no read",
    );
  });

  test("the real read path names the permissions that read incidents, for a user who may write timelines but not read incidents", async (): Promise<void> => {
    const refusal: Promise<void> = WorkspaceActionAuthorization.assertCanCreate(
      {
        props: createProps([
          { permission: Permission.CreateIncidentStateTimeline },
        ]),
        modelType: IncidentStateTimeline,
        action: "acknowledge this incident",
        resources: [{ service: IncidentService, id: ObjectID.generate() }],
      },
    );

    await expect(refusal).rejects.toThrow(
      "You do not have permission to acknowledge this incident. You do not have permissions to read Incident. You need one of these permissions:",
    );
    await expect(refusal).rejects.not.toThrow("not found");
  });

  test("every named resource must be readable: an on-call policy the user cannot read is refused for it", async (): Promise<void> => {
    mockIncidentLookup(createIncident());
    const policyLookupSpy: SpyInstance<
      typeof OnCallDutyPolicyService.findOneBy
    > = jest
      .spyOn(OnCallDutyPolicyService, "findOneBy")
      .mockImplementation((async (findOneBy: {
        props: DatabaseCommonInteractionProps;
      }) => {
        return findOneBy.props.isRoot ? new OnCallDutyPolicy() : null;
      }) as never);

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
    ).rejects.toThrow(
      "You do not have permission to execute an on-call policy for this incident: your access in this project does not include this on-call policy. Ask a project admin for access to it.",
    );
    // A policy has no private ones: the member's read, then OneUptime's.
    expect(policyLookupSpy).toHaveBeenCalledTimes(2);
  });

  test("an on-call policy that is gone is not found", async (): Promise<void> => {
    mockIncidentLookup(createIncident());
    jest.spyOn(OnCallDutyPolicyService, "findOneBy").mockResolvedValue(null);

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
    ).rejects.toThrow(
      "Could not execute an on-call policy for this incident: the on-call policy was not found. It may have been deleted.",
    );
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

/*
 * The incident card's menu in Slack and Microsoft Teams changes an incident's
 * severity and its custom fields: an update of the incident, which a member
 * may make only where the dashboard's same save would be allowed. Asked
 * before the form opens - so nobody fills one in for nothing - and again
 * when it is submitted; the update itself holds them to their labels and
 * owners.
 */
describe("WorkspaceActionAuthorization.assertCanUpdate", (): void => {
  test("refuses a viewer who tries to change an incident's severity, in the chat's words", async (): Promise<void> => {
    const refusal: Promise<void> = WorkspaceActionAuthorization.assertCanUpdate(
      {
        props: createProps([
          { permission: Permission.Viewer },
          { permission: Permission.IncidentViewer },
        ]),
        modelType: Incident,
        data: { incidentSeverityId: ObjectID.generate() },
        action: "change the severity of this incident",
      },
    );

    await expect(refusal).rejects.toBeInstanceOf(NotAuthorizedException);
    await expect(refusal).rejects.toThrow(
      /^You do not have permission to change the severity of this incident\. /,
    );
  });

  test("refuses a viewer who tries to edit an incident's custom fields", async (): Promise<void> => {
    await expect(
      WorkspaceActionAuthorization.assertCanUpdate({
        props: createProps([{ permission: Permission.IncidentViewer }]),
        modelType: Incident,
        data: { customFields: {} },
        action: "edit the custom fields of this incident",
      }),
    ).rejects.toThrow(
      "You do not have permission to edit the custom fields of this incident.",
    );
  });

  test.each([
    ["a project member", [Permission.ProjectMember]],
    ["an incident member", [Permission.IncidentMember]],
    ["an incident admin", [Permission.IncidentAdmin]],
    [
      "the fine-grained Read and Edit Incident permissions",
      [Permission.ReadProjectIncident, Permission.EditProjectIncident],
    ],
  ])(
    "allows %s to change the severity and the custom fields, as the dashboard does",
    async (_name: string, permissions: Array<Permission>): Promise<void> => {
      for (const data of [
        { incidentSeverityId: ObjectID.generate() },
        { customFields: { Ticket: "OPS-1" } },
      ]) {
        await expect(
          WorkspaceActionAuthorization.assertCanUpdate({
            props: createProps(
              permissions.map((permission: Permission): PermissionInput => {
                return { permission: permission };
              }),
            ),
            modelType: Incident,
            data: data,
            action: "change this incident",
          }),
        ).resolves.toBeUndefined();
      }
    },
  );

  test("Edit Incident without reading incidents is refused: nobody changes an incident they cannot see", async (): Promise<void> => {
    await expect(
      WorkspaceActionAuthorization.assertCanUpdate({
        props: createProps([{ permission: Permission.EditProjectIncident }]),
        modelType: Incident,
        data: { customFields: {} },
        action: "edit the custom fields of this incident",
      }),
    ).rejects.toThrow(
      "You do not have permission to edit the custom fields of this incident.",
    );
  });

  test("checks the columns it is given: one nobody may change is refused as a permission they lack, not as bad data", async (): Promise<void> => {
    const refusal: Promise<void> = WorkspaceActionAuthorization.assertCanUpdate(
      {
        props: createProps([{ permission: Permission.ProjectMember }]),
        modelType: Incident,
        data: { aiInvestigationDecision: {} },
        action: "change this incident",
      },
    );

    await expect(refusal).rejects.toBeInstanceOf(NotAuthorizedException);
    await expect(refusal).rejects.toThrow(
      /^You do not have permission to change this incident\. /,
    );
  });

  test("refuses props without a user or a project", async (): Promise<void> => {
    for (const props of [
      { isRoot: true },
      { userId: userId },
      { tenantId: projectId },
    ] as Array<DatabaseCommonInteractionProps>) {
      await expect(
        WorkspaceActionAuthorization.assertCanUpdate({
          props: props,
          modelType: Incident,
          data: { incidentSeverityId: ObjectID.generate() },
          action: "change the severity of this incident",
        }),
      ).rejects.toThrow(
        new NotAuthorizedException(
          "You do not have permission to change the severity of this incident.",
        ),
      );
    }
  });

  test("does not swallow errors that are not refusals", async (): Promise<void> => {
    const failure: Error = new Error("connect ECONNREFUSED 10.0.0.5:5432");
    jest
      .spyOn(ModelPermission, "checkUpdateQueryPermissions")
      .mockRejectedValue(failure as never);

    await expect(
      WorkspaceActionAuthorization.assertCanUpdate({
        props: createProps([{ permission: Permission.ProjectMember }]),
        modelType: Incident,
        data: { customFields: {} },
        action: "edit the custom fields of this incident",
      }),
    ).rejects.toBe(failure);
  });

  test("asks the update's own check, for the project, with exactly the columns given and the member's props", async (): Promise<void> => {
    const check: SpyInstance<
      typeof ModelPermission.checkUpdateQueryPermissions
    > = jest.spyOn(ModelPermission, "checkUpdateQueryPermissions");
    const props: DatabaseCommonInteractionProps = createProps([
      { permission: Permission.ProjectMember },
    ]);
    const severityId: ObjectID = ObjectID.generate();

    await WorkspaceActionAuthorization.assertCanUpdate({
      props: props,
      modelType: Incident,
      data: { incidentSeverityId: severityId },
      action: "change the severity of this incident",
    });

    expect(check).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledWith(
      Incident,
      { projectId: projectId },
      { incidentSeverityId: severityId },
      props,
    );
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
