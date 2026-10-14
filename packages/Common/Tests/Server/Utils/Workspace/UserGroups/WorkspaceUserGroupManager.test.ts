import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import WorkspaceUserGroupManager, {
  NOT_FOUND_GROUP_MESSAGE,
  NOT_FOUND_SCHEDULE_MESSAGE,
} from "../../../../../Server/Utils/Workspace/UserGroups/WorkspaceUserGroupManager";
import { WorkspaceUserGroupError } from "../../../../../Server/Utils/Workspace/UserGroups/WorkspaceUserGroupProvider";
import WorkspaceUserGroupSync from "../../../../../Server/Utils/Workspace/UserGroups/WorkspaceUserGroupSync";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import NotFoundException from "../../../../../Types/Exception/NotFoundException";
import ObjectID from "../../../../../Types/ObjectID";
import {
  WorkspaceAvailableUserGroup,
  WorkspaceUserGroupLeftOutReason,
  WorkspaceUserGroupProblem,
  WorkspaceUserGroupTeam,
  WorkspaceUserGroupView,
} from "../../../../../Types/Workspace/WorkspaceUserGroup";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import UserGroupsWorld, {
  FakeSlackGroup,
  FakeTag,
  PROJECT_ID,
  SLACK_TEAM_ID,
  TEAM_PAYMENTS,
  WorldGroupRow,
  WorldPerson,
  WorldSchedule,
} from "./UserGroupsWorld";

/*
 * WHAT THE SCHEDULE PAGE'S CARD ASKS (WorkspaceUserGroupManager): the groups
 * that follow a schedule, drawn as they are; what the Connect form offers;
 * connecting a group - picked, or made now - and disconnecting it; Try
 * again. Driven against the same fake Slack and Graph as the syncs, with
 * the person's own permissions standing in as what they may read, and every
 * write checked to be made with their props.
 */

let world: UserGroupsWorld;
let ana: WorldPerson;
let bob: WorldPerson;
let primary: WorldSchedule;
let secondary: WorldSchedule;
let paymentsOnCall: FakeSlackGroup;

const PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: new ObjectID("d0000000-0000-4000-8000-000000000001"),
};

const ANA_AAD: string = "a0a0a0a0-0000-4000-8000-00000000a0a0";
const BOB_AAD: string = "b0b0b0b0-0000-4000-8000-00000000b0b0";

beforeEach(() => {
  world = new UserGroupsWorld();

  ana = world.addPerson("Ana Silva", "ana@acme.test");
  bob = world.addPerson("Bob Lee", "bob@acme.test");

  world.slack.addUser({ id: "U0ANA", email: "ana@acme.test", name: "ana" });
  world.slack.addUser({ id: "U0BOB", email: "bob@acme.test", name: "bob" });

  primary = world.addSchedule("Payments Primary", ana);
  secondary = world.addSchedule("Payments Secondary", bob);

  paymentsOnCall = world.slack.addGroup({
    name: "Payments on-call",
    handle: "payments-oncall",
    users: ["U0BOB"],
  });

  world.graph.addTeam(TEAM_PAYMENTS, [
    {
      aadObjectId: ANA_AAD,
      email: "ana@acme.test",
      userPrincipalName: "ana@acme.test",
      name: "Ana Silva",
    },
    {
      aadObjectId: BOB_AAD,
      email: "bob@acme.test",
      userPrincipalName: "bob@acme.test",
      name: "Bob Lee",
    },
  ]);

  world.install();
});

afterEach(() => {
  jest.restoreAllMocks();
  WorkspaceUserGroupSync.reset();
});

async function refusalOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }

  throw new Error("It was not refused.");
}

describe("connecting a Slack user group to a schedule", () => {
  test("an existing group: it is linked with the person's props, and holds whoever is on call at once", async () => {
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

    expect(world.writes).toEqual([
      {
        kind: "create",
        id: view.workspaceUserGroupId,
        props: PROPS,
        scheduleIds: [primary.id.toString()],
      },
    ]);
    expect(paymentsOnCall.users).toEqual(["U0ANA"]);
    expect(view).toEqual(
      expect.objectContaining({
        workspaceType: WorkspaceType.Slack,
        name: "Payments on-call",
        handle: "payments-oncall",
        teamName: null,
        isTurnedOff: false,
        problem: null,
      }),
    );
    expect(view.members).toEqual([
      { userId: ana.id.toString(), name: "Ana Silva", email: "ana@acme.test" },
    ]);
    expect(view.schedules).toEqual([
      {
        scheduleId: primary.id.toString(),
        name: "Payments Primary",
        onCallNow: {
          userId: ana.id.toString(),
          name: "Ana Silva",
          email: "ana@acme.test",
        },
      },
    ]);
    expect(view.syncedAt).not.toBeNull();
  });

  test("a group that follows Secondary already: Primary is added to it - one record, both schedules", async () => {
    const row: WorldGroupRow = world.addGroup({
      workspaceType: WorkspaceType.Slack,
      workspaceGroupId: paymentsOnCall.id,
      name: "Payments on-call",
      handle: "payments-oncall",
      schedules: [secondary],
    });

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

    expect(world.groups.size).toBe(1);
    expect(world.writes).toEqual([
      {
        kind: "update",
        id: row.id.toString(),
        props: PROPS,
        scheduleIds: [secondary.id.toString(), primary.id.toString()],
      },
    ]);
    expect(paymentsOnCall.users).toEqual(["U0ANA", "U0BOB"]);
    // This schedule first on the card, then the others it follows.
    expect(
      view.schedules.map((schedule: { name: string }): string => {
        return schedule.name;
      }),
    ).toEqual(["Payments Primary", "Payments Secondary"]);
  });

  test("a group that follows this schedule already: nothing is written, and it is looked at again", async () => {
    world.addGroup({
      workspaceType: WorkspaceType.Slack,
      workspaceGroupId: paymentsOnCall.id,
      schedules: [primary],
    });

    await WorkspaceUserGroupManager.connect({
      request: {
        onCallDutyPolicyScheduleId: primary.id.toString(),
        workspaceType: WorkspaceType.Slack,
        workspaceGroupId: paymentsOnCall.id,
      },
      projectId: PROJECT_ID,
      props: PROPS,
    });

    expect(world.writes).toEqual([]);
    expect(paymentsOnCall.users).toEqual(["U0ANA"]);
  });

  test("a group turned off in Slack: connecting turns it back on before it is linked, as the form says", async () => {
    const dormant: FakeSlackGroup = world.slack.addGroup({
      name: "Checkout on-call",
      handle: "checkout-oncall",
      users: ["U0BOB"],
      isTurnedOff: true,
    });

    const view: WorkspaceUserGroupView =
      await WorkspaceUserGroupManager.connect({
        request: {
          onCallDutyPolicyScheduleId: primary.id.toString(),
          workspaceType: WorkspaceType.Slack,
          workspaceGroupId: dormant.id,
        },
        projectId: PROJECT_ID,
        props: PROPS,
      });

    const methods: Array<string> = world.slack.methods();

    // Turned on first (with the workspace named), then linked and filled.
    expect(world.slack.calls("usergroups.enable")).toEqual([
      expect.objectContaining({
        usergroup: dormant.id,
        team_id: SLACK_TEAM_ID,
      }),
    ]);
    expect(methods.indexOf("usergroups.enable")).toBeLessThan(
      methods.indexOf("usergroups.users.update"),
    );
    expect(dormant.dateDelete).toBe(0);
    expect(dormant.users).toEqual(["U0ANA"]);
    expect(world.writes).toEqual([
      expect.objectContaining({ kind: "create", props: PROPS }),
    ]);
    expect(view.isTurnedOff).toBe(false);
    expect(view.problem).toBeNull();
  });

  test("a group Slack will not turn back on: refused in plain words, nothing linked", async () => {
    const dormant: FakeSlackGroup = world.slack.addGroup({
      name: "Checkout on-call",
      handle: "checkout-oncall",
      users: [],
      isTurnedOff: true,
    });
    world.slack.isAdminsOnly = true;

    const error: Error = await refusalOf(
      WorkspaceUserGroupManager.connect({
        request: {
          onCallDutyPolicyScheduleId: primary.id.toString(),
          workspaceType: WorkspaceType.Slack,
          workspaceGroupId: dormant.id,
        },
        projectId: PROJECT_ID,
        props: PROPS,
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toContain("workspace owners and admins");
    expect(world.writes).toEqual([]);
    expect(world.groups.size).toBe(0);
    expect(dormant.dateDelete).not.toBe(0);
  });

  test("a new group: made in Slack with the name and handle typed - '@' or not - and a description saying what keeps it", async () => {
    const view: WorkspaceUserGroupView =
      await WorkspaceUserGroupManager.connect({
        request: {
          onCallDutyPolicyScheduleId: primary.id.toString(),
          workspaceType: WorkspaceType.Slack,
          newGroupName: "  Checkout on-call ",
          newGroupHandle: "@Checkout-OnCall",
        },
        projectId: PROJECT_ID,
        props: PROPS,
      });

    expect(world.slack.calls("usergroups.create")).toEqual([
      {
        name: "Checkout on-call",
        handle: "checkout-oncall",
        description:
          "Whoever is on call right now. OneUptime keeps this group up to date.",
        include_count: true,
        team_id: "T0ACME",
      },
    ]);

    const made: FakeSlackGroup = Array.from(world.slack.groups.values()).find(
      (group: FakeSlackGroup): boolean => {
        return group.handle === "checkout-oncall";
      },
    )!;

    expect(made.users).toEqual(["U0ANA"]);
    expect(view.handle).toBe("checkout-oncall");
    expect(view.name).toBe("Checkout on-call");
  });

  test("a new group whose handle Slack already uses: refused in plain words, nothing linked", async () => {
    const error: Error = await refusalOf(
      WorkspaceUserGroupManager.connect({
        request: {
          onCallDutyPolicyScheduleId: primary.id.toString(),
          workspaceType: WorkspaceType.Slack,
          newGroupName: "Payments pager",
          newGroupHandle: "payments-oncall",
        },
        projectId: PROJECT_ID,
        props: PROPS,
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe(
      "Slack already uses @payments-oncall for a person, a channel or another user group. Pick another handle.",
    );
    expect(world.writes).toEqual([]);
  });

  test("a new group whose name Slack has already: refused, pointing at the list", async () => {
    const error: Error = await refusalOf(
      WorkspaceUserGroupManager.connect({
        request: {
          onCallDutyPolicyScheduleId: primary.id.toString(),
          workspaceType: WorkspaceType.Slack,
          newGroupName: "Payments on-call",
          newGroupHandle: "pay-oncall-2",
        },
        projectId: PROJECT_ID,
        props: PROPS,
      }),
    );

    expect(error.message).toBe(
      "Your Slack workspace has a user group called Payments on-call already. Pick it from the list, or choose another name.",
    );
  });

  test("a handle Slack could not take is refused before Slack is asked", async () => {
    for (const handle of ["", "payments oncall", "-oncall", "a".repeat(81)]) {
      const error: Error = await refusalOf(
        WorkspaceUserGroupManager.connect({
          request: {
            onCallDutyPolicyScheduleId: primary.id.toString(),
            workspaceType: WorkspaceType.Slack,
            newGroupName: "Checkout on-call",
            newGroupHandle: handle,
          },
          projectId: PROJECT_ID,
          props: PROPS,
        }),
      );

      expect(error.message).toBe(
        "Give the new user group a handle of lower-case letters, numbers and hyphens, such as payments-oncall.",
      );
    }

    expect(world.slack.calls("usergroups.create")).toEqual([]);
  });

  test("a new group needs a name", async () => {
    const error: Error = await refusalOf(
      WorkspaceUserGroupManager.connect({
        request: {
          onCallDutyPolicyScheduleId: primary.id.toString(),
          workspaceType: WorkspaceType.Slack,
          newGroupHandle: "checkout-oncall",
        },
        projectId: PROJECT_ID,
        props: PROPS,
      }),
    );

    expect(error.message).toBe("Give the new user group a name.");
  });

  test("a group no longer in Slack: refused, and nothing linked", async () => {
    world.slack.groups.delete(paymentsOnCall.id);

    const error: Error = await refusalOf(
      WorkspaceUserGroupManager.connect({
        request: {
          onCallDutyPolicyScheduleId: primary.id.toString(),
          workspaceType: WorkspaceType.Slack,
          workspaceGroupId: paymentsOnCall.id,
        },
        projectId: PROJECT_ID,
        props: PROPS,
      }),
    );

    expect(error.message).toBe(
      "This user group is not in your Slack workspace any more. Pick another one.",
    );
    expect(world.writes).toEqual([]);
  });

  test("a schedule the person may not read is answered like one that is not there - and Slack is not asked", async () => {
    world.unreadableSchedules.add(primary.id.toString());

    const error: Error = await refusalOf(
      WorkspaceUserGroupManager.connect({
        request: {
          onCallDutyPolicyScheduleId: primary.id.toString(),
          workspaceType: WorkspaceType.Slack,
          workspaceGroupId: paymentsOnCall.id,
        },
        projectId: PROJECT_ID,
        props: PROPS,
      }),
    );

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.message).toBe(NOT_FOUND_SCHEDULE_MESSAGE);
    expect(world.slack.requests).toEqual([]);
  });

  test("Slack not connected: the person is told where to connect it", async () => {
    world.isSlackConnected = false;

    const error: Error = await refusalOf(
      WorkspaceUserGroupManager.connect({
        request: {
          onCallDutyPolicyScheduleId: primary.id.toString(),
          workspaceType: WorkspaceType.Slack,
          workspaceGroupId: paymentsOnCall.id,
        },
        projectId: PROJECT_ID,
        props: PROPS,
      }),
    );

    expect(error.message).toBe(
      "Slack is not connected to this project. Connect it in Project Settings > Workspace > Slack first.",
    );
  });

  test("linked, but Slack refuses the change: the group is linked all the same, and the card says what to do", async () => {
    world.slack.isAdminsOnly = true;

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

    expect(world.groups.size).toBe(1);
    expect(view.problem).toBe(WorkspaceUserGroupProblem.AdminsOnly);
    expect(view.syncedAt).toBeNull();
  });

  test("a schedule id that is not one, or no workspace, is refused", async () => {
    expect(
      (
        await refusalOf(
          WorkspaceUserGroupManager.connect({
            request: {
              onCallDutyPolicyScheduleId: "not-an-id",
              workspaceType: WorkspaceType.Slack,
            },
            projectId: PROJECT_ID,
            props: PROPS,
          }),
        )
      ).message,
    ).toBe("Pick the on-call schedule to connect.");

    expect(
      (
        await refusalOf(
          WorkspaceUserGroupManager.connect({
            request: {
              onCallDutyPolicyScheduleId: primary.id.toString(),
              workspaceType: "Discord" as WorkspaceType,
            },
            projectId: PROJECT_ID,
            props: PROPS,
          }),
        )
      ).message,
    ).toBe("Pick Slack or Microsoft Teams.");
  });
});

describe("connecting a Microsoft Teams tag", () => {
  test("a tag the team has, picked: linked with its team, and it holds whoever is on call", async () => {
    const tag: FakeTag = world.graph.addTag(TEAM_PAYMENTS, "Payments on-call", [
      BOB_AAD,
    ]);

    const view: WorkspaceUserGroupView =
      await WorkspaceUserGroupManager.connect({
        request: {
          onCallDutyPolicyScheduleId: primary.id.toString(),
          workspaceType: WorkspaceType.MicrosoftTeams,
          workspaceTeamId: TEAM_PAYMENTS,
          workspaceGroupId: tag.id,
        },
        projectId: PROJECT_ID,
        props: PROPS,
      });

    const row: WorldGroupRow = world.groups.get(view.workspaceUserGroupId)!;
    expect(row.workspaceTeamId).toBe(TEAM_PAYMENTS);
    expect(row.workspaceGroupId).toBe(tag.id);
    expect(
      world.graph
        .tag(TEAM_PAYMENTS, tag.id)!
        .members.map((member: { userId: string }): string => {
          return member.userId;
        }),
    ).toEqual([ANA_AAD]);
    expect(view.teamName).toBe("Payments");
    expect(view.handle).toBeNull();
  });

  test("a tag name the team has already (in another case) is that tag - no second one is made", async () => {
    const tag: FakeTag = world.graph.addTag(TEAM_PAYMENTS, "Payments on-call", [
      BOB_AAD,
    ]);

    const view: WorkspaceUserGroupView =
      await WorkspaceUserGroupManager.connect({
        request: {
          onCallDutyPolicyScheduleId: primary.id.toString(),
          workspaceType: WorkspaceType.MicrosoftTeams,
          workspaceTeamId: TEAM_PAYMENTS,
          tagName: " payments ON-CALL ",
        },
        projectId: PROJECT_ID,
        props: PROPS,
      });

    expect(world.groups.get(view.workspaceUserGroupId)!.workspaceGroupId).toBe(
      tag.id,
    );
    expect(world.graph.teams.get(TEAM_PAYMENTS)!.size).toBe(1);
  });

  test("a new tag is made with whoever from the team is on call now - Teams makes no empty tag", async () => {
    const view: WorkspaceUserGroupView =
      await WorkspaceUserGroupManager.connect({
        request: {
          onCallDutyPolicyScheduleId: primary.id.toString(),
          workspaceType: WorkspaceType.MicrosoftTeams,
          workspaceTeamId: TEAM_PAYMENTS,
          tagName: "Payments on-call",
        },
        projectId: PROJECT_ID,
        props: PROPS,
      });

    const create: { body: unknown } | undefined = world.graph.requests.find(
      (request: { method: string; path: string }): boolean => {
        return (
          request.method === "POST" &&
          request.path === `/v1.0/teams/${TEAM_PAYMENTS}/tags`
        );
      },
    );

    expect(create?.body).toEqual({
      displayName: "Payments on-call",
      // What it is, in Teams' tag list - as a new Slack user group says it.
      description:
        "Whoever is on call right now. OneUptime keeps this tag up to date.",
      members: [{ userId: ANA_AAD }],
    });
    expect(view.name).toBe("Payments on-call");
  });

  test("a new tag when nobody from the team is on call: refused in plain words", async () => {
    world.handOff(primary, null);

    const error: Error = await refusalOf(
      WorkspaceUserGroupManager.connect({
        request: {
          onCallDutyPolicyScheduleId: primary.id.toString(),
          workspaceType: WorkspaceType.MicrosoftTeams,
          workspaceTeamId: TEAM_PAYMENTS,
          tagName: "Payments on-call",
        },
        projectId: PROJECT_ID,
        props: PROPS,
      }),
    );

    expect(error.message).toBe(
      "Microsoft Teams can't create an empty tag, and nobody on call in this schedule right now is in this team. Name a tag the team already has, or try again once somebody from the team is on call.",
    );
    expect(world.graph.paths("POST")).toEqual([]);
  });

  test("a team OneUptime's app is not in: refused before Graph is asked", async () => {
    world.teamsWithoutApp.add(TEAM_PAYMENTS);

    const error: Error = await refusalOf(
      WorkspaceUserGroupManager.connect({
        request: {
          onCallDutyPolicyScheduleId: primary.id.toString(),
          workspaceType: WorkspaceType.MicrosoftTeams,
          workspaceTeamId: TEAM_PAYMENTS,
          tagName: "Payments on-call",
        },
        projectId: PROJECT_ID,
        props: PROPS,
      }),
    );

    expect(error.message).toBe(
      "OneUptime's app isn't in this team. Add it to the team in Microsoft Teams first, or pick another team.",
    );
    expect(world.graph.requests).toEqual([]);
  });

  test("tags not allowed in the tenant: the person is told how to allow them", async () => {
    world.graph.isTagPermissionGranted = false;

    const error: Error = await refusalOf(
      WorkspaceUserGroupManager.connect({
        request: {
          onCallDutyPolicyScheduleId: primary.id.toString(),
          workspaceType: WorkspaceType.MicrosoftTeams,
          workspaceTeamId: TEAM_PAYMENTS,
          tagName: "Payments on-call",
        },
        projectId: PROJECT_ID,
        props: PROPS,
      }),
    );

    expect(error.message).toBe(
      "OneUptime isn't allowed to manage tags in your Microsoft 365 organization yet. A Microsoft 365 admin can allow it with Grant Admin Consent, in Project Settings > Workspace > Microsoft Teams.",
    );
  });

  test("a tag needs a name of 40 characters at most, and a team", async () => {
    expect(
      (
        await refusalOf(
          WorkspaceUserGroupManager.connect({
            request: {
              onCallDutyPolicyScheduleId: primary.id.toString(),
              workspaceType: WorkspaceType.MicrosoftTeams,
              workspaceTeamId: TEAM_PAYMENTS,
              tagName: "x".repeat(41),
            },
            projectId: PROJECT_ID,
            props: PROPS,
          }),
        )
      ).message,
    ).toBe("A tag's name holds 40 characters at most.");

    expect(
      (
        await refusalOf(
          WorkspaceUserGroupManager.connect({
            request: {
              onCallDutyPolicyScheduleId: primary.id.toString(),
              workspaceType: WorkspaceType.MicrosoftTeams,
              tagName: "Payments on-call",
            },
            projectId: PROJECT_ID,
            props: PROPS,
          }),
        )
      ).message,
    ).toBe("Pick the team the tag is in.");
  });
});

describe("disconnecting", () => {
  test("from one of two schedules: it keeps following the other, written with the person's props", async () => {
    const row: WorldGroupRow = world.addGroup({
      workspaceType: WorkspaceType.Slack,
      workspaceGroupId: paymentsOnCall.id,
      schedules: [primary, secondary],
    });

    await WorkspaceUserGroupManager.disconnect({
      workspaceUserGroupId: row.id,
      scheduleId: primary.id,
      projectId: PROJECT_ID,
      props: PROPS,
    });

    expect(world.writes).toEqual([
      {
        kind: "update",
        id: row.id.toString(),
        props: PROPS,
        scheduleIds: [secondary.id.toString()],
      },
    ]);
  });

  test("from its last schedule: OneUptime forgets it, and leaves it in Slack as it is", async () => {
    const row: WorldGroupRow = world.addGroup({
      workspaceType: WorkspaceType.Slack,
      workspaceGroupId: paymentsOnCall.id,
      schedules: [primary],
    });

    await WorkspaceUserGroupManager.disconnect({
      workspaceUserGroupId: row.id,
      scheduleId: primary.id,
      projectId: PROJECT_ID,
      props: PROPS,
    });

    expect(world.writes).toEqual([
      { kind: "delete", id: row.id.toString(), props: PROPS },
    ]);
    expect(world.slack.requests).toEqual([]);
    expect(paymentsOnCall.users).toEqual(["U0BOB"]);
  });

  test("from a schedule it does not follow: nothing changes", async () => {
    const row: WorldGroupRow = world.addGroup({
      workspaceType: WorkspaceType.Slack,
      workspaceGroupId: paymentsOnCall.id,
      schedules: [secondary],
    });

    await WorkspaceUserGroupManager.disconnect({
      workspaceUserGroupId: row.id,
      scheduleId: primary.id,
      projectId: PROJECT_ID,
      props: PROPS,
    });

    expect(world.writes).toEqual([]);
  });

  test("a group the person may not read is answered like one that is not there", async () => {
    const row: WorldGroupRow = world.addGroup({
      workspaceType: WorkspaceType.Slack,
      workspaceGroupId: paymentsOnCall.id,
      schedules: [primary],
    });
    world.unreadableGroups.add(row.id.toString());

    const error: Error = await refusalOf(
      WorkspaceUserGroupManager.disconnect({
        workspaceUserGroupId: row.id,
        scheduleId: primary.id,
        projectId: PROJECT_ID,
        props: PROPS,
      }),
    );

    expect(error.message).toBe(NOT_FOUND_GROUP_MESSAGE);
    expect(world.writes).toEqual([]);
  });
});

describe("the card's groups for a schedule", () => {
  test("the groups that follow it - Slack first, then Microsoft Teams - each with its people and how it went", async () => {
    world.slack.users.delete("U0BOB");
    const slackRow: WorldGroupRow = world.addGroup({
      workspaceType: WorkspaceType.Slack,
      workspaceGroupId: paymentsOnCall.id,
      name: "Payments on-call",
      handle: "payments-oncall",
      schedules: [secondary, primary],
    });
    const tag: FakeTag = world.graph.addTag(
      TEAM_PAYMENTS,
      "Payments on-call",
      [],
    );
    world.addGroup({
      workspaceType: WorkspaceType.MicrosoftTeams,
      workspaceGroupId: tag.id,
      workspaceTeamId: TEAM_PAYMENTS,
      name: "Payments on-call",
      schedules: [primary],
    });
    // Following Secondary only: not on Primary's card.
    world.addGroup({
      workspaceType: WorkspaceType.Slack,
      workspaceGroupId: "S0OTHER",
      schedules: [secondary],
    });
    await WorkspaceUserGroupSync.requestSync(
      Array.from(world.groups.values()).map((row: WorldGroupRow) => {
        return row.id;
      }),
    );

    const views: Array<WorkspaceUserGroupView> =
      await WorkspaceUserGroupManager.getViewsForSchedule({
        scheduleId: primary.id,
        projectId: PROJECT_ID,
        props: PROPS,
      });

    expect(
      views.map((view: WorkspaceUserGroupView): string => {
        return view.workspaceType;
      }),
    ).toEqual([WorkspaceType.Slack, WorkspaceType.MicrosoftTeams]);

    const slack: WorkspaceUserGroupView = views[0]!;
    expect(slack.workspaceUserGroupId).toBe(slackRow.id.toString());
    expect(
      slack.schedules.map((schedule: { name: string }): string => {
        return schedule.name;
      }),
    ).toEqual(["Payments Primary", "Payments Secondary"]);
    expect(slack.members).toEqual([
      { userId: ana.id.toString(), name: "Ana Silva", email: "ana@acme.test" },
    ]);
    expect(slack.leftOut).toEqual([
      {
        userId: bob.id.toString(),
        name: "Bob Lee",
        email: "bob@acme.test",
        reason: WorkspaceUserGroupLeftOutReason.NotFound,
      },
    ]);
    expect(views[1]!.teamName).toBe("Payments");
  });

  test("a schedule it follows that the person may not read is left off the card, not named", async () => {
    world.addGroup({
      workspaceType: WorkspaceType.Slack,
      workspaceGroupId: paymentsOnCall.id,
      schedules: [primary, secondary],
    });
    world.unreadableSchedules.add(secondary.id.toString());

    const views: Array<WorkspaceUserGroupView> =
      await WorkspaceUserGroupManager.getViewsForSchedule({
        scheduleId: primary.id,
        projectId: PROJECT_ID,
        props: PROPS,
      });

    expect(
      views[0]!.schedules.map((schedule: { name: string }): string => {
        return schedule.name;
      }),
    ).toEqual(["Payments Primary"]);
  });

  test("a schedule the person may not read: refused like one that is not there", async () => {
    world.unreadableSchedules.add(primary.id.toString());

    const error: Error = await refusalOf(
      WorkspaceUserGroupManager.getViewsForSchedule({
        scheduleId: primary.id,
        projectId: PROJECT_ID,
        props: PROPS,
      }),
    );

    expect(error.message).toBe(NOT_FOUND_SCHEDULE_MESSAGE);
  });

  test("a group never synced yet reads as such: no members, no problem, never synced", async () => {
    world.addGroup({
      workspaceType: WorkspaceType.Slack,
      workspaceGroupId: paymentsOnCall.id,
      schedules: [primary],
    });

    const views: Array<WorkspaceUserGroupView> =
      await WorkspaceUserGroupManager.getViewsForSchedule({
        scheduleId: primary.id,
        projectId: PROJECT_ID,
        props: PROPS,
      });

    expect(views[0]).toEqual(
      expect.objectContaining({
        members: [],
        leftOut: [],
        isTurnedOff: false,
        problem: null,
        syncedAt: null,
        checkedAt: null,
      }),
    );
  });
});

describe("what the Connect form offers", () => {
  test("Slack: the workspace's groups by handle, each with how many people, whether it is off, and the schedules it follows already", async () => {
    world.slack.addGroup({
      name: "All on-call",
      handle: "all-oncall",
      users: ["U0ANA", "U0BOB"],
      isTurnedOff: true,
    });
    const row: WorldGroupRow = world.addGroup({
      workspaceType: WorkspaceType.Slack,
      workspaceGroupId: paymentsOnCall.id,
      schedules: [secondary, primary],
    });

    const available: {
      groups: Array<WorkspaceAvailableUserGroup>;
      teams: Array<WorkspaceUserGroupTeam>;
    } = await WorkspaceUserGroupManager.getAvailable({
      workspaceType: WorkspaceType.Slack,
      projectId: PROJECT_ID,
      props: PROPS,
    });

    expect(available.teams).toEqual([]);
    expect(available.groups).toEqual([
      {
        workspaceGroupId: expect.any(String),
        name: "All on-call",
        handle: "all-oncall",
        userCount: 2,
        isTurnedOff: true,
        workspaceUserGroupId: null,
        followsScheduleNames: [],
      },
      {
        workspaceGroupId: paymentsOnCall.id,
        name: "Payments on-call",
        handle: "payments-oncall",
        userCount: 1,
        isTurnedOff: false,
        workspaceUserGroupId: row.id.toString(),
        followsScheduleNames: ["Payments Primary", "Payments Secondary"],
      },
    ]);
  });

  test("Slack on a free plan: the person is told user groups need a paid plan", async () => {
    world.slack.isPaidPlan = false;

    const error: Error = await refusalOf(
      WorkspaceUserGroupManager.getAvailable({
        workspaceType: WorkspaceType.Slack,
        projectId: PROJECT_ID,
        props: PROPS,
      }),
    );

    expect(error.message).toBe(
      "User groups need a paid Slack plan. Upgrade your Slack workspace to use them.",
    );
  });

  test("Microsoft Teams: the teams OneUptime's app is in, then a team's tags", async () => {
    world.graph.addTeam("bbbbbbbb-0000-4000-8000-0000000000bb", []);
    world.teamsWithoutApp.add("bbbbbbbb-0000-4000-8000-0000000000bb");
    world.graph.addTag(TEAM_PAYMENTS, "Payments on-call", [ANA_AAD]);
    world.graph.addTag(TEAM_PAYMENTS, "Database on-call", [BOB_AAD]);

    const first: {
      groups: Array<WorkspaceAvailableUserGroup>;
      teams: Array<WorkspaceUserGroupTeam>;
    } = await WorkspaceUserGroupManager.getAvailable({
      workspaceType: WorkspaceType.MicrosoftTeams,
      projectId: PROJECT_ID,
      props: PROPS,
    });

    expect(first.teams).toEqual([{ teamId: TEAM_PAYMENTS, name: "Payments" }]);
    expect(first.groups).toEqual([]);

    const second: {
      groups: Array<WorkspaceAvailableUserGroup>;
      teams: Array<WorkspaceUserGroupTeam>;
    } = await WorkspaceUserGroupManager.getAvailable({
      workspaceType: WorkspaceType.MicrosoftTeams,
      projectId: PROJECT_ID,
      teamId: TEAM_PAYMENTS,
      props: PROPS,
    });

    expect(
      second.groups.map((group: WorkspaceAvailableUserGroup): string => {
        return group.name;
      }),
    ).toEqual(["Database on-call", "Payments on-call"]);
  });
});

describe("Try again", () => {
  test("a problem fixed in Slack: the group is put right at once, and the card says so", async () => {
    world.slack.isAdminsOnly = true;
    const row: WorldGroupRow = world.addGroup({
      workspaceType: WorkspaceType.Slack,
      workspaceGroupId: paymentsOnCall.id,
      schedules: [primary],
    });
    await WorkspaceUserGroupSync.requestSync([row.id]);
    world.slack.isAdminsOnly = false;

    const view: WorkspaceUserGroupView =
      await WorkspaceUserGroupManager.syncAgain({
        workspaceUserGroupId: row.id,
        scheduleId: primary.id,
        projectId: PROJECT_ID,
        props: PROPS,
      });

    expect(view.problem).toBeNull();
    expect(paymentsOnCall.users).toEqual(["U0ANA"]);
  });
});

describe("the words for a refusal while connecting", () => {
  const text: (
    workspaceType: WorkspaceType,
    problem: WorkspaceUserGroupProblem,
    detail?: string,
  ) => string = (
    workspaceType: WorkspaceType,
    problem: WorkspaceUserGroupProblem,
    detail?: string,
  ): string => {
    return WorkspaceUserGroupManager.getConnectErrorText({
      workspaceType: workspaceType,
      error: new WorkspaceUserGroupError({ problem: problem, detail: detail }),
      handle: "payments-oncall",
      name: "Payments on-call",
    });
  };

  test("each says what it means and what to do", () => {
    expect(
      text(WorkspaceType.Slack, WorkspaceUserGroupProblem.MissingScope),
    ).toBe(
      "OneUptime's Slack app isn't allowed to manage user groups yet. Reconnect Slack in Project Settings > Workspace > Slack to allow it.",
    );
    expect(
      text(WorkspaceType.Slack, WorkspaceUserGroupProblem.AdminsOnly),
    ).toBe(
      "Slack lets only workspace owners and admins manage user groups in your workspace. Ask a Slack admin to let everyone manage user groups (in Slack's admin settings, Permissions > User Groups), then try again.",
    );
    expect(
      text(WorkspaceType.Slack, WorkspaceUserGroupProblem.NotConnected),
    ).toBe(
      "Slack is not connected to this project any more. Connect it again in Project Settings > Workspace > Slack.",
    );
    expect(
      text(WorkspaceType.MicrosoftTeams, WorkspaceUserGroupProblem.Unavailable),
    ).toBe("Microsoft Teams didn't answer. Try again in a minute.");
    expect(
      text(WorkspaceType.MicrosoftTeams, WorkspaceUserGroupProblem.Gone),
    ).toBe("This tag is not in the team any more. Pick another one.");
    expect(
      text(
        WorkspaceType.Slack,
        WorkspaceUserGroupProblem.Refused,
        "invalid_users",
      ),
    ).toBe("Slack refused: invalid_users.");
    expect(text(WorkspaceType.Slack, WorkspaceUserGroupProblem.Refused)).toBe(
      "Slack refused the change.",
    );
  });

  test("Slack's own words about a handle or a name become what to change", () => {
    expect(
      text(
        WorkspaceType.Slack,
        WorkspaceUserGroupProblem.Refused,
        "bad_handle",
      ),
    ).toBe(
      "Slack doesn't accept @payments-oncall as a handle. Use lower-case letters, numbers and hyphens.",
    );
    expect(
      text(
        WorkspaceType.Slack,
        WorkspaceUserGroupProblem.Refused,
        "name_too_long",
      ),
    ).toBe("That name is too long for Slack. Choose a shorter one.");
  });

  test("a product name a licence replaces is used where the product is named", async () => {
    const ProductBrandingText: typeof import("../../../../../Server/Utils/ProductBrandingText").default =
      (await import("../../../../../Server/Utils/ProductBrandingText")).default;
    jest
      .spyOn(ProductBrandingText, "getProductName")
      .mockReturnValue("Acme Ops");

    expect(
      text(WorkspaceType.Slack, WorkspaceUserGroupProblem.MissingScope),
    ).toBe(
      "Acme Ops's Slack app isn't allowed to manage user groups yet. Reconnect Slack in Project Settings > Workspace > Slack to allow it.",
    );
  });
});
