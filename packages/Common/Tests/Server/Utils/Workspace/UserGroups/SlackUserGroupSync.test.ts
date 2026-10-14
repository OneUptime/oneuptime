import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import WorkspaceUserGroupSync from "../../../../../Server/Utils/Workspace/UserGroups/WorkspaceUserGroupSync";
import WorkspaceUserGroupService from "../../../../../Server/Services/WorkspaceUserGroupService";
import ObjectID from "../../../../../Types/ObjectID";
import {
  WORKSPACE_USER_GROUP_CHECK_EVERY_MINUTES,
  WorkspaceUserGroupLeftOutReason,
  WorkspaceUserGroupProblem,
  WorkspaceUserGroupSyncState,
} from "../../../../../Types/Workspace/WorkspaceUserGroup";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import UserGroupsWorld, {
  FakeSlackGroup,
  SLACK_TEAM_ID,
  SLACK_TOKEN,
  START,
  until,
  WorldGroupRow,
  WorldPerson,
  WorldSchedule,
} from "./UserGroupsWorld";

/*
 * "We have a number of @teamname-oncall user group in Slack that is always
 * updated with the on-call person(s) - usually primary and sometimes
 * primary + secondary oncall." (customer feedback #3)
 *
 * A Slack user group that follows on-call schedules, kept in step by the
 * real WorkspaceUserGroupSync and SlackUserGroups against a fake Slack
 * workspace that answers Slack's Web API as Slack does - its rules
 * included: no empty user groups, guests kept out, paid plans only, and
 * only admins may change groups unless Slack's settings let everyone. The
 * requests OneUptime sends are pinned, not only what the group ends up as.
 */

let world: UserGroupsWorld;

// The people of the Payments team, and who they are in Slack.
let ana: WorldPerson;
let bob: WorldPerson;
let carol: WorldPerson;

let primary: WorldSchedule;
let secondary: WorldSchedule;

let paymentsOnCall: FakeSlackGroup;

function groupFor(schedules: Array<WorldSchedule>): WorldGroupRow {
  return world.addGroup({
    workspaceType: WorkspaceType.Slack,
    workspaceGroupId: paymentsOnCall.id,
    name: paymentsOnCall.name,
    handle: paymentsOnCall.handle,
    schedules: schedules,
  });
}

beforeEach(() => {
  world = new UserGroupsWorld();

  ana = world.addPerson("Ana Silva", "ana@acme.test");
  bob = world.addPerson("Bob Lee", "bob@acme.test");
  carol = world.addPerson("Carol Diaz", "carol@acme.test");

  world.slack.addUser({ id: "U0ANA", email: "ana@acme.test", name: "ana" });
  world.slack.addUser({ id: "U0BOB", email: "bob@acme.test", name: "bob" });
  world.slack.addUser({
    id: "U0CAROL",
    email: "carol@acme.test",
    name: "carol",
  });

  // Ana connected her Slack account; Bob and Carol never did.
  world.connect(ana, WorkspaceType.Slack, "U0ANA");

  primary = world.addSchedule("Payments Primary", ana);
  secondary = world.addSchedule("Payments Secondary", bob);

  paymentsOnCall = world.slack.addGroup({
    name: "Payments on-call",
    handle: "payments-oncall",
    users: ["U0CAROL"],
  });

  world.install();
});

afterEach(() => {
  jest.restoreAllMocks();
  WorkspaceUserGroupSync.reset();
});

describe("who an on-call user group holds", () => {
  test("a group that follows Primary holds whoever is on call in Primary - replacing who was in it", async () => {
    const row: WorldGroupRow = groupFor([primary]);

    const state: WorkspaceUserGroupSyncState = await world.sync(row);

    expect(paymentsOnCall.users).toEqual(["U0ANA"]);
    expect(state.members).toEqual([
      { userId: ana.id.toString(), workspaceUserId: "U0ANA" },
    ]);
    expect(state.leftOut).toEqual([]);
    expect(state.problem).toBeNull();
    expect(state.isTurnedOff).toBe(false);
  });

  test("the requests Slack is sent: the groups, the person, who the group holds, then the change", async () => {
    const row: WorldGroupRow = groupFor([primary]);

    await world.sync(row);

    expect(world.slack.methods()).toEqual([
      "usergroups.list",
      "users.info",
      "usergroups.users.list",
      "usergroups.users.update",
    ]);
    expect(world.slack.calls("usergroups.list")[0]).toEqual({
      include_disabled: true,
      include_count: true,
      team_id: SLACK_TEAM_ID,
    });
    expect(world.slack.calls("users.info")[0]).toEqual({ user: "U0ANA" });
    expect(world.slack.calls("usergroups.users.list")[0]).toEqual({
      usergroup: paymentsOnCall.id,
      include_disabled: true,
      team_id: SLACK_TEAM_ID,
    });
    expect(world.slack.calls("usergroups.users.update")[0]).toEqual({
      usergroup: paymentsOnCall.id,
      users: "U0ANA",
      include_count: true,
      team_id: SLACK_TEAM_ID,
    });
  });

  test("every request carries the project's bot token, form-encoded", async () => {
    const row: WorldGroupRow = groupFor([primary]);

    await world.sync(row);

    expect(world.slack.requests.length).toBe(4);

    for (const request of world.slack.requests) {
      expect(request.headers["Authorization"]).toBe(`Bearer ${SLACK_TOKEN}`);
      expect(request.headers["Content-Type"]).toBe(
        "application/x-www-form-urlencoded",
      );
    }
  });

  test("primary + secondary: a group that follows both holds both people on call, in the schedules' order", async () => {
    const row: WorldGroupRow = groupFor([secondary, primary]);

    const state: WorkspaceUserGroupSyncState = await world.sync(row);

    expect(paymentsOnCall.users).toEqual(["U0ANA", "U0BOB"]);
    expect(
      state.members.map((member: { workspaceUserId: string }): string => {
        return member.workspaceUserId;
      }),
    ).toEqual(["U0ANA", "U0BOB"]);
  });

  test("somebody on call in both schedules is in the group once", async () => {
    world.handOff(secondary, ana);
    const row: WorldGroupRow = groupFor([primary, secondary]);

    const state: WorkspaceUserGroupSyncState = await world.sync(row);

    expect(paymentsOnCall.users).toEqual(["U0ANA"]);
    expect(state.members.length).toBe(1);
    expect(world.slack.calls("users.info").length).toBe(1);
  });

  test("somebody not connected to OneUptime is found in Slack by their email address", async () => {
    const row: WorldGroupRow = groupFor([secondary]);

    await world.sync(row);

    expect(world.slack.calls("users.lookupByEmail")).toEqual([
      { email: "bob@acme.test" },
    ]);
    expect(paymentsOnCall.users).toEqual(["U0BOB"]);
  });

  test("a connected account that is gone from Slack: found by email instead", async () => {
    world.connections = [];
    world.connect(ana, WorkspaceType.Slack, "U0GONE");
    const row: WorldGroupRow = groupFor([primary]);

    await world.sync(row);

    expect(world.slack.calls("users.info")).toEqual([{ user: "U0GONE" }]);
    expect(world.slack.calls("users.lookupByEmail")).toEqual([
      { email: "ana@acme.test" },
    ]);
    expect(paymentsOnCall.users).toEqual(["U0ANA"]);
  });

  test("an app installed before it could read email addresses still keeps connected people in step", async () => {
    world.slack.scopes.delete("users:read.email");
    const row: WorldGroupRow = groupFor([primary, secondary]);

    const state: WorkspaceUserGroupSyncState = await world.sync(row);

    expect(paymentsOnCall.users).toEqual(["U0ANA"]);
    expect(state.leftOut).toEqual([
      {
        userId: bob.id.toString(),
        reason: WorkspaceUserGroupLeftOutReason.NotFound,
      },
    ]);
    expect(state.problem).toBeNull();
  });
});

describe("whoever cannot be in the group is left out, and the card says why", () => {
  test("nobody Slack knows: left out, the others still in", async () => {
    world.slack.users.delete("U0BOB");
    const row: WorldGroupRow = groupFor([primary, secondary]);

    const state: WorkspaceUserGroupSyncState = await world.sync(row);

    expect(paymentsOnCall.users).toEqual(["U0ANA"]);
    expect(state.leftOut).toEqual([
      {
        userId: bob.id.toString(),
        reason: WorkspaceUserGroupLeftOutReason.NotFound,
      },
    ]);
  });

  test("a guest: Slack keeps guests out of user groups", async () => {
    world.slack.users.get("U0BOB")!.isGuest = true;
    const row: WorldGroupRow = groupFor([primary, secondary]);

    const state: WorkspaceUserGroupSyncState = await world.sync(row);

    expect(paymentsOnCall.users).toEqual(["U0ANA"]);
    expect(state.leftOut).toEqual([
      {
        userId: bob.id.toString(),
        reason: WorkspaceUserGroupLeftOutReason.Guest,
      },
    ]);
  });

  test("a deactivated account: said so, not 'not found'", async () => {
    world.slack.users.get("U0ANA")!.deleted = true;
    const row: WorldGroupRow = groupFor([primary, secondary]);

    const state: WorkspaceUserGroupSyncState = await world.sync(row);

    expect(paymentsOnCall.users).toEqual(["U0BOB"]);
    expect(state.leftOut).toEqual([
      {
        userId: ana.id.toString(),
        reason: WorkspaceUserGroupLeftOutReason.Deactivated,
      },
    ]);
  });

  test("a bot account is nobody to reach", async () => {
    world.slack.users.get("U0BOB")!.isBot = true;
    const row: WorldGroupRow = groupFor([secondary]);

    const state: WorkspaceUserGroupSyncState = await world.sync(row);

    expect(state.leftOut[0]?.reason).toBe(
      WorkspaceUserGroupLeftOutReason.NotFound,
    );
  });
});

describe("hand-offs, overrides and skips: the group follows the schedule's roster", () => {
  test("a hand-off swaps the person: Bob in, Ana out, in one change", async () => {
    const row: WorldGroupRow = groupFor([primary]);
    await world.sync(row);
    world.slack.requests = [];

    // The roster refresh found Bob on call in Primary now.
    world.handOff(primary, bob);
    await WorkspaceUserGroupSync.requestSyncForSchedules([primary.id]);

    expect(paymentsOnCall.users).toEqual(["U0BOB"]);
    expect(world.slack.calls("usergroups.users.update")).toEqual([
      {
        usergroup: paymentsOnCall.id,
        users: "U0BOB",
        include_count: true,
        team_id: SLACK_TEAM_ID,
      },
    ]);
  });

  test("an override: whoever covers for Ana is in it while she is away, and Ana is back after", async () => {
    const row: WorldGroupRow = groupFor([primary]);
    await world.sync(row);

    // Carol covers for Ana: the roster names Carol.
    world.handOff(primary, carol);
    await WorkspaceUserGroupSync.requestSyncForSchedules([primary.id]);
    expect(paymentsOnCall.users).toEqual(["U0CAROL"]);

    // The override ended.
    world.handOff(primary, ana);
    await WorkspaceUserGroupSync.requestSyncForSchedules([primary.id]);
    expect(paymentsOnCall.users).toEqual(["U0ANA"]);
  });

  test("only the groups that follow the changed schedule are looked at", async () => {
    const other: FakeSlackGroup = world.slack.addGroup({
      name: "Database on-call",
      handle: "db-oncall",
    });
    const database: WorldSchedule = world.addSchedule("Database", carol);
    const payments: WorldGroupRow = groupFor([primary]);
    world.addGroup({
      workspaceType: WorkspaceType.Slack,
      workspaceGroupId: other.id,
      schedules: [database],
    });

    await WorkspaceUserGroupSync.requestSyncForSchedules([primary.id]);

    expect(world.state(payments).members.length).toBe(1);
    expect(other.users).toEqual([]);
  });

  test("a change of no group's schedule asks Slack nothing", async () => {
    groupFor([primary]);
    const unrelated: WorldSchedule = world.addSchedule("Unrelated", carol);

    await WorkspaceUserGroupSync.requestSyncForSchedules([unrelated.id]);

    expect(world.slack.requests).toEqual([]);
  });

  test("nothing changed: nothing is written to Slack", async () => {
    const row: WorldGroupRow = groupFor([primary]);
    await world.sync(row);
    world.slack.requests = [];

    await world.sync(row);

    expect(world.slack.methods()).toEqual([
      "usergroups.list",
      "users.info",
      "usergroups.users.list",
    ]);
  });
});

describe("nobody on call: Slack cannot hold an empty user group", () => {
  test("the group is turned off, not emptied - no update with nobody in it", async () => {
    const row: WorldGroupRow = groupFor([primary]);
    await world.sync(row);
    world.slack.requests = [];

    world.handOff(primary, null);
    const state: WorkspaceUserGroupSyncState = await world.sync(row);

    expect(world.slack.methods()).toEqual([
      "usergroups.list",
      "usergroups.disable",
    ]);
    expect(world.slack.calls("usergroups.disable")[0]).toEqual({
      usergroup: paymentsOnCall.id,
      team_id: SLACK_TEAM_ID,
    });
    expect(paymentsOnCall.dateDelete).toBeGreaterThan(0);
    expect(state.isTurnedOff).toBe(true);
    expect(state.members).toEqual([]);
    expect(state.problem).toBeNull();
  });

  test("somebody on call again: OneUptime turns it back on, then puts them in", async () => {
    const row: WorldGroupRow = groupFor([primary]);
    await world.sync(row);
    world.handOff(primary, null);
    await world.sync(row);
    world.slack.requests = [];

    world.handOff(primary, bob);
    const state: WorkspaceUserGroupSyncState = await world.sync(row);

    expect(world.slack.methods()).toEqual([
      "usergroups.list",
      "users.lookupByEmail",
      "usergroups.enable",
      "usergroups.users.list",
      "usergroups.users.update",
    ]);
    expect(paymentsOnCall.dateDelete).toBe(0);
    expect(paymentsOnCall.users).toEqual(["U0BOB"]);
    expect(state.isTurnedOff).toBe(false);
  });

  test("still nobody on call: a group OneUptime turned off is left off, and Slack is not asked again", async () => {
    const row: WorldGroupRow = groupFor([primary]);
    world.handOff(primary, null);
    await world.sync(row);
    world.slack.requests = [];

    const state: WorkspaceUserGroupSyncState = await world.sync(row);

    expect(world.slack.methods()).toEqual(["usergroups.list"]);
    expect(state.isTurnedOff).toBe(true);
  });

  test("everybody on call left out is nobody to reach: the group is turned off too", async () => {
    world.slack.users.delete("U0BOB");
    const row: WorldGroupRow = groupFor([secondary]);

    const state: WorkspaceUserGroupSyncState = await world.sync(row);

    expect(world.slack.methods()).toContain("usergroups.disable");
    expect(state.isTurnedOff).toBe(true);
    expect(state.leftOut.length).toBe(1);
  });

  test("a group somebody turned off in Slack keeps its members in step but stays off, and says so", async () => {
    paymentsOnCall.dateDelete = 1760400000;
    const row: WorldGroupRow = groupFor([primary]);

    const state: WorkspaceUserGroupSyncState = await world.sync(row);

    expect(world.slack.methods()).not.toContain("usergroups.enable");
    expect(paymentsOnCall.users).toEqual(["U0ANA"]);
    expect(paymentsOnCall.dateDelete).toBeGreaterThan(0);
    expect(state.problem).toBe(WorkspaceUserGroupProblem.TurnedOffInWorkspace);
    // The people are right: it is in step, for when it is turned on.
    expect(world.groups.get(row.id.toString())!.syncedAt).not.toBeNull();
  });
});

describe("the check every 15 minutes", () => {
  test("a change made to the group by hand in Slack is undone", async () => {
    const row: WorldGroupRow = groupFor([primary]);
    await world.sync(row);

    // Somebody adds Carol to @payments-oncall in Slack.
    paymentsOnCall.users = ["U0ANA", "U0CAROL"];
    world.minutesPass(WORKSPACE_USER_GROUP_CHECK_EVERY_MINUTES);

    const looked: number = await WorkspaceUserGroupSync.syncDueGroups();

    expect(looked).toBe(1);
    expect(paymentsOnCall.users).toEqual(["U0ANA"]);
  });

  test("a group checked a minute ago is not due", async () => {
    const row: WorldGroupRow = groupFor([primary]);
    await world.sync(row);
    world.slack.requests = [];
    world.minutesPass(1);

    expect(await WorkspaceUserGroupSync.syncDueGroups()).toBe(0);
    expect(world.slack.requests).toEqual([]);
  });

  test("a group in step is looked at again 15 minutes later", async () => {
    const row: WorldGroupRow = groupFor([primary]);

    await world.sync(row);

    expect(world.groups.get(row.id.toString())!.nextSyncAt).toEqual(
      new Date(Date.parse(START) + 15 * 60 * 1000),
    );
    expect(world.groups.get(row.id.toString())!.syncedAt).toEqual(
      new Date(START),
    );
  });

  test("the groups of one workspace share one usergroups.list in a round", async () => {
    const database: FakeSlackGroup = world.slack.addGroup({
      name: "Database on-call",
      handle: "db-oncall",
    });
    groupFor([primary]);
    world.addGroup({
      workspaceType: WorkspaceType.Slack,
      workspaceGroupId: database.id,
      schedules: [secondary],
    });

    expect(await WorkspaceUserGroupSync.syncDueGroups()).toBe(2);
    expect(world.slack.calls("usergroups.list").length).toBe(1);
    expect(database.users).toEqual(["U0BOB"]);
    expect(paymentsOnCall.users).toEqual(["U0ANA"]);
  });

  test("somebody who connects their Slack account later is put in at the next check", async () => {
    world.slack.scopes.delete("users:read.email");
    const row: WorldGroupRow = groupFor([secondary]);
    expect((await world.sync(row)).leftOut.length).toBe(1);

    world.connect(bob, WorkspaceType.Slack, "U0BOB");
    world.minutesPass(WORKSPACE_USER_GROUP_CHECK_EVERY_MINUTES);
    await WorkspaceUserGroupSync.syncDueGroups();

    expect(paymentsOnCall.users).toEqual(["U0BOB"]);
    expect(world.state(row).leftOut).toEqual([]);
  });

  test("the group renamed in Slack is renamed in OneUptime", async () => {
    const row: WorldGroupRow = groupFor([primary]);
    paymentsOnCall.name = "Payments - whoever is on call";
    paymentsOnCall.handle = "pay-oncall";

    await world.sync(row);

    expect(world.groups.get(row.id.toString())!.name).toBe(
      "Payments - whoever is on call",
    );
    expect(world.groups.get(row.id.toString())!.handle).toBe("pay-oncall");
  });
});

describe("when Slack refuses, the admin is told plainly, and OneUptime tries again", () => {
  test("a free Slack plan: user groups need a paid plan", async () => {
    world.slack.isPaidPlan = false;
    const row: WorldGroupRow = groupFor([primary]);

    const state: WorkspaceUserGroupSyncState = await world.sync(row);

    expect(state.problem).toBe(WorkspaceUserGroupProblem.PaidPlanNeeded);
    expect(state.problemDetail).toBe("plan_upgrade_required");
    expect(world.groups.get(row.id.toString())!.syncedAt).toBeNull();
    expect(world.groups.get(row.id.toString())!.nextSyncAt).toEqual(
      new Date(Date.parse(START) + 60 * 60 * 1000),
    );
  });

  test("an app installed before it asked to manage user groups: reconnect Slack", async () => {
    world.slack.scopes.delete("usergroups:read");
    world.slack.scopes.delete("usergroups:write");
    const row: WorldGroupRow = groupFor([primary]);

    const state: WorkspaceUserGroupSyncState = await world.sync(row);

    expect(state.problem).toBe(WorkspaceUserGroupProblem.MissingScope);
    expect(paymentsOnCall.users).toEqual(["U0CAROL"]);
  });

  test("Slack's default - only owners and admins change user groups: said so", async () => {
    world.slack.isAdminsOnly = true;
    const row: WorldGroupRow = groupFor([primary]);

    const state: WorkspaceUserGroupSyncState = await world.sync(row);

    expect(state.problem).toBe(WorkspaceUserGroupProblem.AdminsOnly);
    expect(state.problemDetail).toBe("permission_denied");
    expect(paymentsOnCall.users).toEqual(["U0CAROL"]);
  });

  test("fixed in Slack: the next check puts it right, and the problem is gone", async () => {
    world.slack.isAdminsOnly = true;
    const row: WorldGroupRow = groupFor([primary]);
    await world.sync(row);

    world.slack.isAdminsOnly = false;
    world.minutesPass(60);
    await WorkspaceUserGroupSync.syncDueGroups();

    expect(world.state(row).problem).toBeNull();
    expect(paymentsOnCall.users).toEqual(["U0ANA"]);
  });

  test("a group deleted from Slack is gone, and nothing is changed", async () => {
    world.slack.groups.delete(paymentsOnCall.id);
    const row: WorldGroupRow = groupFor([primary]);

    const state: WorkspaceUserGroupSyncState = await world.sync(row);

    expect(state.problem).toBe(WorkspaceUserGroupProblem.Gone);
    expect(world.slack.methods()).toEqual(["usergroups.list"]);
  });

  test("Slack no longer takes the project's token: the project must connect Slack again", async () => {
    world.slack.refusals.set("usergroups.list", "token_revoked");
    const row: WorldGroupRow = groupFor([primary]);

    const state: WorkspaceUserGroupSyncState = await world.sync(row);

    expect(state.problem).toBe(WorkspaceUserGroupProblem.NotConnected);
  });

  test("the project is not connected to Slack: nothing is asked of Slack", async () => {
    world.isSlackConnected = false;
    const row: WorldGroupRow = groupFor([primary]);

    const state: WorkspaceUserGroupSyncState = await world.sync(row);

    expect(state.problem).toBe(WorkspaceUserGroupProblem.NotConnected);
    expect(world.slack.requests).toEqual([]);
  });

  test("Slack limits the rate: tried again once Slack says, the group kept as it was", async () => {
    const row: WorldGroupRow = groupFor([primary]);
    await world.sync(row);
    world.handOff(primary, bob);
    world.slack.rateLimitOnce.set("usergroups.users.update", 300);

    const state: WorkspaceUserGroupSyncState = await world.sync(row);

    expect(state.problem).toBe(WorkspaceUserGroupProblem.Unavailable);
    expect(state.members).toEqual([
      { userId: ana.id.toString(), workspaceUserId: "U0ANA" },
    ]);
    expect(world.groups.get(row.id.toString())!.nextSyncAt).toEqual(
      new Date(Date.parse(START) + 5 * 60 * 1000),
    );

    world.minutesPass(5);
    await WorkspaceUserGroupSync.syncDueGroups();

    expect(paymentsOnCall.users).toEqual(["U0BOB"]);
    expect(world.state(row).problem).toBeNull();
  });

  test("Slack cannot be reached: tried again two minutes later", async () => {
    world.slack.isDown = true;
    const row: WorldGroupRow = groupFor([primary]);

    const state: WorkspaceUserGroupSyncState = await world.sync(row);

    expect(state.problem).toBe(WorkspaceUserGroupProblem.Unavailable);
    expect(world.groups.get(row.id.toString())!.nextSyncAt).toEqual(
      new Date(Date.parse(START) + 2 * 60 * 1000),
    );
  });

  test("anything else Slack refuses is said in Slack's own words", async () => {
    world.slack.refusals.set("usergroups.users.update", "subteam_max_users_exceeded");
    const row: WorldGroupRow = groupFor([primary]);

    const state: WorkspaceUserGroupSyncState = await world.sync(row);

    expect(state.problem).toBe(WorkspaceUserGroupProblem.Refused);
    expect(state.problemDetail).toBe("subteam_max_users_exceeded");
  });
});

describe("the sync itself", () => {
  test("a group whose last schedule was deleted is no longer kept in step - and left in Slack as it is", async () => {
    const row: WorldGroupRow = groupFor([primary]);
    world.schedules.delete(primary.id.toString());

    await WorkspaceUserGroupSync.requestSync([row.id]);

    expect(world.groups.has(row.id.toString())).toBe(false);
    expect(world.slack.requests).toEqual([]);
    expect(paymentsOnCall.users).toEqual(["U0CAROL"]);
  });

  test("a group that is gone from OneUptime is nothing to do", async () => {
    await WorkspaceUserGroupSync.requestSync([
      new ObjectID("c0000000-0000-4000-8000-999999999999"),
    ]);

    expect(world.slack.requests).toEqual([]);
  });

  test("Valkey away: the sync goes ahead without its lock", async () => {
    world.isLockUnavailable = true;
    const row: WorldGroupRow = groupFor([primary]);

    await world.sync(row);

    expect(paymentsOnCall.users).toEqual(["U0ANA"]);
  });

  test("an unexpected failure never escapes, and is logged", async () => {
    const row: WorldGroupRow = groupFor([primary]);
    jest
      .spyOn(WorkspaceUserGroupService, "findOneById")
      .mockRejectedValue(new Error("the database went away") as never);

    await expect(
      WorkspaceUserGroupSync.requestSync([row.id]),
    ).resolves.toBeUndefined();
    expect(world.errors.join("\n")).toContain("could not be looked at");
  });

  test("syncs of one group never overlap: one asked for while another runs runs once more, after it, with what is on call then", async () => {
    const row: WorldGroupRow = groupFor([primary]);

    let release: () => void = (): void => {};
    world.slack.gates.set(
      "usergroups.users.update",
      new Promise<void>((resolve: () => void) => {
        release = resolve;
      }),
    );

    const first: Promise<void> = WorkspaceUserGroupSync.requestSync([row.id]);

    // While the first sync waits on Slack, Bob takes over - twice asked.
    await until(() => {
      return world.slack.methods().includes("usergroups.users.update");
    });
    world.handOff(primary, bob);
    const second: Promise<void> = WorkspaceUserGroupSync.requestSync([row.id]);
    const third: Promise<void> = WorkspaceUserGroupSync.requestSync([row.id]);

    world.slack.gates.delete("usergroups.users.update");
    release();
    await Promise.all([first, second, third]);

    // Two runs: the first, then one more for both requests.
    expect(world.slack.calls("usergroups.list").length).toBe(1);
    expect(world.slack.calls("usergroups.users.update")).toEqual([
      expect.objectContaining({ users: "U0ANA" }),
      expect.objectContaining({ users: "U0BOB" }),
    ]);
    expect(paymentsOnCall.users).toEqual(["U0BOB"]);
    expect(WorkspaceUserGroupSync.isIdle()).toBe(true);
  });

  test("syncNow waits for the group and answers its state", async () => {
    const row: WorldGroupRow = groupFor([primary]);

    const state: WorkspaceUserGroupSyncState | null =
      await WorkspaceUserGroupSync.syncNow(row.id);

    expect(state?.members).toEqual([
      { userId: ana.id.toString(), workspaceUserId: "U0ANA" },
    ]);
  });
});
