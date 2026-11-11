import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import WorkspaceProjectAuthToken, {
  SlackMiscData,
  SlackOrganizationWorkspace,
} from "../../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceProjectAuthTokenService from "../../../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserGroupService from "../../../../../Server/Services/WorkspaceUserGroupService";
import WorkspaceUserGroupManager from "../../../../../Server/Utils/Workspace/UserGroups/WorkspaceUserGroupManager";
import WorkspaceUserGroupSync from "../../../../../Server/Utils/Workspace/UserGroups/WorkspaceUserGroupSync";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../../../Types/Date";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  WorkspaceAvailableUserGroup,
  WorkspaceUserGroupProblem,
  WorkspaceUserGroupSyncState,
  WorkspaceUserGroupTeam,
  WorkspaceUserGroupView,
} from "../../../../../Types/Workspace/WorkspaceUserGroup";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import UserGroupsWorld, {
  FakeSlackGroup,
  PROJECT_ID,
  SLACK_TEAM_ID,
  WorldGroupRow,
  WorldPerson,
  WorldSchedule,
} from "./UserGroupsWorld";

/*
 * ON-CALL USER GROUPS IN A SLACK ENTERPRISE ORGANIZATION.
 *
 * Slack user groups are per workspace, and the organization's bot token is
 * told which with team_id. A group picked or made for a project connected
 * to a whole organization is in its default workspace and remembers it
 * (workspaceTeamId), so it is kept in step there whichever workspace is
 * the default later. A group linked while the project was connected to
 * one workspace - before it moved to its organization's installation -
 * says none: it is kept in step in the default workspace (the one the
 * project was connected to), never with the organization's own id, and
 * keeps that workspace once it is in step there.
 *
 * Driven against the same fake Slack Web API as the other user group
 * suites (UserGroupsWorld), with the project's connection an
 * organization's.
 */

const ORGANIZATION_ID: string = "E0ACME";
const ORGANIZATION_TOKEN: string = "xoxb-acme-organization";

// The default workspace: the one the project was connected to before.
const WEST: SlackOrganizationWorkspace = { id: "T0WEST", name: "Acme West" };
const EAST: SlackOrganizationWorkspace = { id: "T0EAST", name: "Acme East" };

const PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: new ObjectID("d6000000-0000-4000-8000-000000000001"),
};

let world: UserGroupsWorld;
let ana: WorldPerson;
let primary: WorldSchedule;
let paymentsOnCall: FakeSlackGroup;

// The project's connection, as stored: whose, and its default workspace.
let isOrganization: boolean;
let defaultWorkspaceId: string | undefined;
let workspaces: Array<SlackOrganizationWorkspace>;

function connection(): WorkspaceProjectAuthToken {
  const auth: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
  auth.projectId = PROJECT_ID;
  auth.workspaceType = WorkspaceType.Slack;
  auth.authToken = ORGANIZATION_TOKEN;
  auth.workspaceProjectId = ORGANIZATION_ID;

  const miscData: SlackMiscData = {
    teamId: ORGANIZATION_ID,
    teamName: "Acme Corp",
    botUserId: "U0BOT",
    isEnterpriseInstall: true,
    enterpriseId: ORGANIZATION_ID,
    enterpriseName: "Acme Corp",
    workspaces: workspaces,
    // Listed a minute ago: Slack is not asked for them again.
    workspacesReadAt: OneUptimeDate.toString(
      OneUptimeDate.addRemoveMinutes(world.now(), -1),
    ),
    defaultWorkspaceId: defaultWorkspaceId,
  };

  auth.miscData = miscData as never;
  return auth;
}

// The team_id of each user group call Slack was sent, in order.
function userGroupTeamIds(): Array<unknown> {
  return world.slack.requests
    .filter((request: { method: string }): boolean => {
      return request.method.startsWith("usergroups.");
    })
    .map((request: { body: JSONObject }): unknown => {
      return request.body["team_id"];
    });
}

// The workspaces the sync wrote a group was found in, in order.
function workspacesKept(): Array<unknown> {
  return jest
    .mocked(WorkspaceUserGroupService.updateOneById)
    .mock.calls.filter((call: Array<unknown>): boolean => {
      return (
        (call[0] as { data: JSONObject }).data["workspaceTeamId"] !== undefined
      );
    })
    .map((call: Array<unknown>): unknown => {
      return (call[0] as { data: JSONObject }).data["workspaceTeamId"];
    });
}

function legacyGroup(): WorldGroupRow {
  return world.addGroup({
    workspaceType: WorkspaceType.Slack,
    workspaceGroupId: paymentsOnCall.id,
    name: paymentsOnCall.name,
    handle: paymentsOnCall.handle,
    schedules: [primary],
  });
}

beforeEach(() => {
  world = new UserGroupsWorld();
  isOrganization = true;
  defaultWorkspaceId = WEST.id;
  workspaces = [EAST, WEST];

  ana = world.addPerson("Ana Silva", "ana@acme.test");
  world.slack.addUser({ id: "U0ANA", email: "ana@acme.test", name: "ana" });
  world.connect(ana, WorkspaceType.Slack, "U0ANA");

  primary = world.addSchedule("Payments Primary", ana);

  paymentsOnCall = world.slack.addGroup({
    name: "Payments on-call",
    handle: "payments-oncall",
    users: [],
  });

  world.install();

  // The world's connection is one workspace's; this project's is the organization's.
  const workspaceConnection: ((...args: Array<never>) => unknown) | undefined =
    jest
      .mocked(WorkspaceProjectAuthTokenService.getProjectAuth)
      .getMockImplementation() as
      | ((...args: Array<never>) => unknown)
      | undefined;

  jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
    .mockImplementation((async (options: { workspaceType: WorkspaceType }) => {
      if (options.workspaceType === WorkspaceType.Slack && isOrganization) {
        return connection();
      }

      return await workspaceConnection!(options as never);
    }) as never);

  // The world keeps the workspace the sync writes a group is in.
  const update: ((...args: Array<never>) => unknown) | undefined = jest
    .mocked(WorkspaceUserGroupService.updateOneById)
    .getMockImplementation() as
    | ((...args: Array<never>) => unknown)
    | undefined;

  jest
    .spyOn(WorkspaceUserGroupService, "updateOneById")
    .mockImplementation((async (options: {
      id: ObjectID;
      data: JSONObject;
    }) => {
      const row: WorldGroupRow | undefined = world.groups.get(
        options.id.toString(),
      );

      if (row && typeof options.data["workspaceTeamId"] === "string") {
        row.workspaceTeamId = options.data["workspaceTeamId"] as string;
      }

      return await update!(options as never);
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  WorkspaceUserGroupSync.reset();
});

describe("a project connected to a whole Slack Enterprise organization", () => {
  test("the Connect form offers the default workspace's user groups - asked with its team_id", async () => {
    const available: {
      groups: Array<WorkspaceAvailableUserGroup>;
      teams: Array<WorkspaceUserGroupTeam>;
    } = await WorkspaceUserGroupManager.getAvailable({
      workspaceType: WorkspaceType.Slack,
      projectId: PROJECT_ID,
      props: PROPS,
    });

    expect(world.slack.calls("usergroups.list")).toEqual([
      { include_disabled: true, include_count: true, team_id: WEST.id },
    ]);
    expect(
      available.groups.map(
        (group: WorkspaceAvailableUserGroup): string | null => {
          return group.handle;
        },
      ),
    ).toEqual(["payments-oncall"]);
    expect(available.teams).toEqual([]);
  });

  test("an existing group is linked with the default workspace, and kept in step there", async () => {
    const view: WorkspaceUserGroupView =
      await WorkspaceUserGroupManager.connect({
        request: {
          onCallDutyPolicyScheduleId: primary.id.toString(),
          workspaceType: WorkspaceType.Slack,
          workspaceGroupId: paymentsOnCall.id,
        },
        projectId: PROJECT_ID,
        props: PROPS,
      });

    expect(world.groups.get(view.workspaceUserGroupId)!.workspaceTeamId).toBe(
      WEST.id,
    );
    expect(paymentsOnCall.users).toEqual(["U0ANA"]);
    expect(userGroupTeamIds().length).toBeGreaterThan(0);
    expect(
      userGroupTeamIds().every((teamId: unknown): boolean => {
        return teamId === WEST.id;
      }),
    ).toBe(true);
  });

  test("a new group is made in the default workspace, and linked with it", async () => {
    const view: WorkspaceUserGroupView =
      await WorkspaceUserGroupManager.connect({
        request: {
          onCallDutyPolicyScheduleId: primary.id.toString(),
          workspaceType: WorkspaceType.Slack,
          newGroupName: "Checkout on-call",
          newGroupHandle: "checkout-oncall",
        },
        projectId: PROJECT_ID,
        props: PROPS,
      });

    expect(world.slack.calls("usergroups.create")).toHaveLength(1);
    expect(world.slack.calls("usergroups.create")[0]!["team_id"]).toBe(WEST.id);
    expect(world.groups.get(view.workspaceUserGroupId)!.workspaceTeamId).toBe(
      WEST.id,
    );
  });

  test("a group picked in another workspace is kept in step there, whatever the default", async () => {
    const row: WorldGroupRow = world.addGroup({
      workspaceType: WorkspaceType.Slack,
      workspaceGroupId: paymentsOnCall.id,
      schedules: [primary],
      workspaceTeamId: EAST.id,
    });

    const state: WorkspaceUserGroupSyncState = await world.sync(row);

    expect(state.problem).toBeNull();
    expect(paymentsOnCall.users).toEqual(["U0ANA"]);
    expect(new Set(userGroupTeamIds())).toEqual(new Set([EAST.id]));
    // It says its workspace already: nothing to keep.
    expect(workspacesKept()).toEqual([]);
  });

  test("a group linked before the project moved to its organization is kept in step in the default workspace - never asked for with the organization's id", async () => {
    const row: WorldGroupRow = legacyGroup();

    const state: WorkspaceUserGroupSyncState = await world.sync(row);

    expect(state.problem).toBeNull();
    expect(paymentsOnCall.users).toEqual(["U0ANA"]);
    expect(userGroupTeamIds().length).toBeGreaterThan(0);
    expect(new Set(userGroupTeamIds())).toEqual(new Set([WEST.id]));
    expect(
      world.slack.requests.some((request: { body: JSONObject }): boolean => {
        return JSON.stringify(request.body).includes(ORGANIZATION_ID);
      }),
    ).toBe(false);
  });

  test("... once in step there it keeps that workspace: a default chosen later does not move it", async () => {
    const row: WorldGroupRow = legacyGroup();

    await world.sync(row);

    expect(workspacesKept()).toEqual([WEST.id]);
    expect(row.workspaceTeamId).toBe(WEST.id);

    // Another default is chosen; the group is in West still.
    defaultWorkspaceId = EAST.id;
    world.slack.requests = [];
    world.handOff(primary, null);
    world.minutesPass(20);

    const state: WorkspaceUserGroupSyncState = await world.sync(row);

    expect(state.problem).toBeNull();
    expect(new Set(userGroupTeamIds())).toEqual(new Set([WEST.id]));
  });

  test("a group Slack does not find in the default workspace is not tied to it", async () => {
    const row: WorldGroupRow = world.addGroup({
      workspaceType: WorkspaceType.Slack,
      workspaceGroupId: "S0GONE",
      schedules: [primary],
    });

    const state: WorkspaceUserGroupSyncState = await world.sync(row);

    expect(state.problem).toBe(WorkspaceUserGroupProblem.Gone);
    expect(workspacesKept()).toEqual([]);
    expect(row.workspaceTeamId).toBeNull();
  });

  test("OneUptime added to no workspace of the organization yet: the group is tied to none", async () => {
    defaultWorkspaceId = undefined;
    workspaces = [];

    const row: WorldGroupRow = legacyGroup();

    await world.sync(row);

    expect(workspacesKept()).toEqual([]);
    expect(row.workspaceTeamId).toBeNull();
    // No workspace to name: nothing is sent as one.
    expect(
      userGroupTeamIds().every((teamId: unknown): boolean => {
        return teamId === undefined;
      }),
    ).toBe(true);
  });
});

describe("a project connected to one Slack workspace (as before)", () => {
  beforeEach(() => {
    isOrganization = false;
  });

  test("a group is linked without a workspace, and its calls name the project's own", async () => {
    const view: WorkspaceUserGroupView =
      await WorkspaceUserGroupManager.connect({
        request: {
          onCallDutyPolicyScheduleId: primary.id.toString(),
          workspaceType: WorkspaceType.Slack,
          workspaceGroupId: paymentsOnCall.id,
        },
        projectId: PROJECT_ID,
        props: PROPS,
      });

    expect(
      world.groups.get(view.workspaceUserGroupId)!.workspaceTeamId,
    ).toBeNull();
    expect(new Set(userGroupTeamIds())).toEqual(new Set([SLACK_TEAM_ID]));
  });

  test("a group kept in step is never tied to a workspace", async () => {
    const row: WorldGroupRow = legacyGroup();

    const state: WorkspaceUserGroupSyncState = await world.sync(row);

    expect(state.problem).toBeNull();
    expect(workspacesKept()).toEqual([]);
    expect(new Set(userGroupTeamIds())).toEqual(new Set([SLACK_TEAM_ID]));
  });
});
