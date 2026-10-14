import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import MicrosoftTeamsTags, {
  MicrosoftTeamsTagInfo,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsTags";
import WorkspaceUserGroupSync from "../../../../../Server/Utils/Workspace/UserGroups/WorkspaceUserGroupSync";
import { JSONObject } from "../../../../../Types/JSON";
import {
  MICROSOFT_TEAMS_TAG_MAX_MEMBERS_ON_CREATE,
  WorkspaceUserGroupLeftOutReason,
  WorkspaceUserGroupProblem,
  WorkspaceUserGroupSyncState,
} from "../../../../../Types/Workspace/WorkspaceUserGroup";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import UserGroupsWorld, {
  FakeTag,
  GRAPH_TOKEN,
  GraphRequest,
  START,
  TEAM_PAYMENTS,
  WorldGroupRow,
  WorldPerson,
  WorldSchedule,
} from "./UserGroupsWorld";

/*
 * THE SAME, IN MICROSOFT TEAMS: a tag (@Payments on-call) in the Payments
 * team, kept equal to whoever is on call by the real WorkspaceUserGroupSync
 * and MicrosoftTeamsTags, against a fake Microsoft Graph that answers its
 * teamwork tag endpoints as Graph does, and the team's roster as the team's
 * bot reads it. A tag holds only the team's members, so the people on call
 * are found in the roster: by the account they connected, or their email.
 */

let world: UserGroupsWorld;
let ana: WorldPerson;
let bob: WorldPerson;
let carol: WorldPerson;
let primary: WorldSchedule;
let secondary: WorldSchedule;
let tag: FakeTag;

const ANA_AAD: string = "a0a0a0a0-0000-4000-8000-00000000a0a0";
const BOB_AAD: string = "b0b0b0b0-0000-4000-8000-00000000b0b0";
const CAROL_AAD: string = "c0c0c0c0-0000-4000-8000-00000000c0c0";

function groupFor(schedules: Array<WorldSchedule>): WorldGroupRow {
  return world.addGroup({
    workspaceType: WorkspaceType.MicrosoftTeams,
    workspaceGroupId: tag.id,
    workspaceTeamId: TEAM_PAYMENTS,
    name: tag.displayName,
    schedules: schedules,
  });
}

function tagMembers(): Array<string> {
  return (world.graph.tag(TEAM_PAYMENTS, tag.id)?.members || []).map(
    (member: { userId: string }): string => {
      return member.userId;
    },
  );
}

beforeEach(() => {
  world = new UserGroupsWorld();

  ana = world.addPerson("Ana Silva", "ana@acme.test");
  bob = world.addPerson("Bob Lee", "bob@acme.test");
  carol = world.addPerson("Carol Diaz", "carol@acme.test");

  world.graph.addTeam(TEAM_PAYMENTS, [
    {
      aadObjectId: ANA_AAD,
      email: "ana.silva@acme.test",
      userPrincipalName: "ana.silva@acme.test",
      name: "Ana Silva",
    },
    {
      aadObjectId: BOB_AAD,
      email: "BOB@acme.test",
      userPrincipalName: "bob@acme.test",
      name: "Bob Lee",
    },
    {
      aadObjectId: CAROL_AAD,
      email: "",
      userPrincipalName: "carol@acme.test",
      name: "Carol Diaz",
    },
  ]);

  // Ana connected her Teams account (her email there differs).
  world.connect(ana, WorkspaceType.MicrosoftTeams, ANA_AAD);

  primary = world.addSchedule("Payments Primary", ana);
  secondary = world.addSchedule("Payments Secondary", bob);

  tag = world.graph.addTag(TEAM_PAYMENTS, "Payments on-call", [CAROL_AAD]);

  world.install();
});

afterEach(() => {
  jest.restoreAllMocks();
  WorkspaceUserGroupSync.reset();
});

describe("who an on-call tag holds", () => {
  test("a tag that follows Primary holds whoever is on call there - the one in it before is taken out", async () => {
    const row: WorldGroupRow = groupFor([primary]);

    const state: WorkspaceUserGroupSyncState = await world.sync(row);

    expect(tagMembers()).toEqual([ANA_AAD]);
    expect(state.members).toEqual([
      { userId: ana.id.toString(), workspaceUserId: ANA_AAD },
    ]);
    expect(state.problem).toBeNull();
  });

  test("the requests Graph is sent: the team's tags, the tag's people, one added, one removed", async () => {
    const row: WorldGroupRow = groupFor([primary]);

    await world.sync(row);

    expect(
      world.graph.requests.map((request: GraphRequest): string => {
        return `${request.method} ${request.path}`;
      }),
    ).toEqual([
      `GET /v1.0/teams/${TEAM_PAYMENTS}/tags`,
      `GET /v1.0/teams/${TEAM_PAYMENTS}/tags/${tag.id}/members`,
      `POST /v1.0/teams/${TEAM_PAYMENTS}/tags/${tag.id}/members`,
      expect.stringMatching(
        `^DELETE /v1.0/teams/${TEAM_PAYMENTS}/tags/${tag.id}/members/MEMBER`,
      ),
    ]);
    expect(world.graph.requests[2]!.body).toEqual({ userId: ANA_AAD });
  });

  test("primary + secondary: both people, Bob found by his email address (whatever its case)", async () => {
    const row: WorldGroupRow = groupFor([primary, secondary]);

    await world.sync(row);

    expect(tagMembers().sort()).toEqual([ANA_AAD, BOB_AAD].sort());
  });

  test("somebody whose roster entry has no email is found by their sign-in name", async () => {
    world.handOff(primary, carol);
    const row: WorldGroupRow = groupFor([primary]);

    await world.sync(row);

    expect(tagMembers()).toEqual([CAROL_AAD]);
  });

  test("somebody who is not in the team is left out - a tag holds only the team's members", async () => {
    const dave: WorldPerson = world.addPerson("Dave Kim", "dave@acme.test");
    world.handOff(secondary, dave);
    const row: WorldGroupRow = groupFor([primary, secondary]);

    const state: WorkspaceUserGroupSyncState = await world.sync(row);

    expect(tagMembers()).toEqual([ANA_AAD]);
    expect(state.leftOut).toEqual([
      {
        userId: dave.id.toString(),
        reason: WorkspaceUserGroupLeftOutReason.NotInTeam,
      },
    ]);
  });

  test("somebody Teams refuses to add is left out, and the rest still go in", async () => {
    world.graph.refusedUsers.add(BOB_AAD);
    const row: WorldGroupRow = groupFor([primary, secondary]);

    const state: WorkspaceUserGroupSyncState = await world.sync(row);

    expect(tagMembers()).toEqual([ANA_AAD]);
    expect(state.leftOut).toEqual([
      {
        userId: bob.id.toString(),
        reason: WorkspaceUserGroupLeftOutReason.NotInTeam,
      },
    ]);
    expect(state.members).toEqual([
      { userId: ana.id.toString(), workspaceUserId: ANA_AAD },
    ]);
  });

  test("nothing changed: nothing is written to Graph", async () => {
    const row: WorldGroupRow = groupFor([primary]);
    await world.sync(row);
    world.graph.requests = [];

    await world.sync(row);

    expect(world.graph.paths("POST")).toEqual([]);
    expect(world.graph.paths("DELETE")).toEqual([]);
  });

  test("a hand-off: Bob added, Ana removed", async () => {
    const row: WorldGroupRow = groupFor([primary]);
    await world.sync(row);
    world.graph.requests = [];

    world.handOff(primary, bob);
    await WorkspaceUserGroupSync.requestSyncForSchedules([primary.id]);

    expect(tagMembers()).toEqual([BOB_AAD]);
    expect(world.graph.paths("POST").length).toBe(1);
    expect(world.graph.paths("DELETE").length).toBe(1);
  });

  test("every Graph request carries the project's Graph token", async () => {
    const row: WorldGroupRow = groupFor([primary]);
    const API: typeof import("../../../../../Utils/API").default = (
      await import("../../../../../Utils/API")
    ).default;
    const seen: Array<string> = [];

    jest.spyOn(API, "get").mockImplementation((async (options: {
      url: { toString: () => string };
      headers: Record<string, string>;
    }) => {
      seen.push(options.headers["Authorization"] || "");
      return world.graph.answer("GET", options.url.toString(), null);
    }) as never);

    await world.sync(row);

    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen)).toEqual(new Set([`Bearer ${GRAPH_TOKEN}`]));
  });
});

describe("Graph's answers over several pages", () => {
  // The paths of the reads of the team's tags.
  function tagListReads(): Array<string> {
    return world.graph.paths("GET").filter((path: string): boolean => {
      return path === `/v1.0/teams/${TEAM_PAYMENTS}/tags`;
    });
  }

  test("the tag on a team's last page of tags is found: every page is read, by the address Graph names", async () => {
    world.graph.addTag(TEAM_PAYMENTS, "Payments escalation", [BOB_AAD]);
    world.graph.addTag(TEAM_PAYMENTS, "Payments leads", [BOB_AAD]);
    // The tag the group follows goes last.
    const tags: Map<string, FakeTag> = world.graph.teams.get(TEAM_PAYMENTS)!;
    tags.delete(tag.id);
    tags.set(tag.id, tag);
    world.graph.pageSize = 1;
    const row: WorldGroupRow = groupFor([primary]);

    const state: WorkspaceUserGroupSyncState = await world.sync(row);

    expect(state.problem).toBeNull();
    expect(tagMembers()).toEqual([ANA_AAD]);
    expect(tagListReads().length).toBe(3);
  });

  test("a tag with more people than a page holds: all of them are read, and everybody who should not be in it is taken out", async () => {
    const strangers: Array<string> = [
      "e1e1e1e1-0000-4000-8000-0000000000e1",
      "e2e2e2e2-0000-4000-8000-0000000000e2",
      "e3e3e3e3-0000-4000-8000-0000000000e3",
    ];

    for (const stranger of strangers) {
      world.graph.tag(TEAM_PAYMENTS, tag.id)!.members.push({
        id: `MEMBER-${stranger}`,
        userId: stranger,
      });
    }

    world.graph.pageSize = 2;
    const row: WorldGroupRow = groupFor([primary]);

    const state: WorkspaceUserGroupSyncState = await world.sync(row);

    expect(state.problem).toBeNull();
    expect(tagMembers()).toEqual([ANA_AAD]);
    // Carol and the three put in by hand: one request each.
    expect(world.graph.paths("DELETE").length).toBe(4);
  });

  test.each([
    ["another host", "https://graph.example.net"],
    ["plain http", "http://graph.microsoft.com"],
    [
      "a host that only starts like Graph's",
      "https://graph.microsoft.com.example.net",
    ],
    ["Graph's name before an @", "https://graph.microsoft.com@example.net"],
    ["another port", "https://graph.microsoft.com:8443"],
  ])(
    "a next page at %s is not asked for: the token goes to Graph only",
    async (_: string, base: string) => {
      world.graph.addTag(TEAM_PAYMENTS, "Payments escalation", [BOB_AAD]);
      world.graph.pageSize = 1;
      world.graph.nextLinkBase = base;
      const row: WorldGroupRow = groupFor([primary]);

      const state: WorkspaceUserGroupSyncState = await world.sync(row);

      // The tag is on the first page: the group is kept in step regardless.
      expect(state.problem).toBeNull();
      expect(tagMembers()).toEqual([ANA_AAD]);
      expect(tagListReads().length).toBe(1);
      expect(world.elsewhere).toEqual([]);
    },
  );

  test("a team that names page after page: at most 20 are read for one answer", async () => {
    for (let index: number = 0; index < 30; index++) {
      world.graph.addTag(TEAM_PAYMENTS, `Old tag ${index}`, [BOB_AAD]);
    }

    world.graph.pageSize = 1;
    const row: WorldGroupRow = groupFor([primary]);

    const state: WorkspaceUserGroupSyncState = await world.sync(row);

    expect(tagListReads().length).toBe(20);
    // The tag the group follows came first.
    expect(state.problem).toBeNull();
    expect(tagMembers()).toEqual([ANA_AAD]);
  });

  test("a new tag for more people than Teams takes with a new one: made with the first 25, the rest added after", async () => {
    const people: Array<string> = [];

    for (let index: number = 0; index < 30; index++) {
      people.push(`d0d0d0d0-0000-4000-8000-${String(index).padStart(12, "0")}`);
    }

    const made: MicrosoftTeamsTagInfo = await MicrosoftTeamsTags.create({
      accessToken: GRAPH_TOKEN,
      teamId: TEAM_PAYMENTS,
      name: "Payments everyone",
      aadObjectIds: people,
    });

    expect(
      world.graph
        .tag(TEAM_PAYMENTS, made.id)!
        .members.map((member: { userId: string }): string => {
          return member.userId;
        }),
    ).toEqual(people);

    const posts: Array<GraphRequest> = world.graph.requests.filter(
      (request: GraphRequest): boolean => {
        return request.method === "POST";
      },
    );

    expect(MICROSOFT_TEAMS_TAG_MAX_MEMBERS_ON_CREATE).toBe(25);
    expect(posts[0]!.path).toBe(`/v1.0/teams/${TEAM_PAYMENTS}/tags`);
    expect((posts[0]!.body!["members"] as Array<JSONObject>).length).toBe(25);
    expect(
      posts.slice(1).map((request: GraphRequest): string => {
        return request.path;
      }),
    ).toEqual(
      new Array<string>(5).fill(
        `/v1.0/teams/${TEAM_PAYMENTS}/tags/${made.id}/members`,
      ),
    );
  });
});

describe("nobody on call: a tag has no 'off', so it is emptied", () => {
  test("everybody is taken out of it", async () => {
    const row: WorldGroupRow = groupFor([primary]);
    await world.sync(row);

    world.handOff(primary, null);
    const state: WorkspaceUserGroupSyncState = await world.sync(row);

    expect(tagMembers()).toEqual([]);
    expect(state.isTurnedOff).toBe(true);
    expect(state.problem).toBeNull();
  });

  test("Teams deletes a tag left empty: OneUptime makes it again under its name once somebody is on call", async () => {
    world.graph.deletesEmptyTags = true;
    const row: WorldGroupRow = groupFor([primary]);
    await world.sync(row);
    world.handOff(primary, null);
    await world.sync(row);
    expect(world.graph.tag(TEAM_PAYMENTS, tag.id)).toBeUndefined();

    world.handOff(primary, bob);
    const state: WorkspaceUserGroupSyncState = await world.sync(row);

    const madeAgainId: string = world.groups.get(
      row.id.toString(),
    )!.workspaceGroupId;
    expect(madeAgainId).not.toBe(tag.id);
    expect(world.graph.tag(TEAM_PAYMENTS, madeAgainId)?.displayName).toBe(
      "Payments on-call",
    );
    expect(
      world.graph
        .tag(TEAM_PAYMENTS, madeAgainId)!
        .members.map((member: { userId: string }): string => {
          return member.userId;
        }),
    ).toEqual([BOB_AAD]);
    expect(state.isTurnedOff).toBe(false);
    expect(state.problem).toBeNull();
  });

  test("still nobody on call after Teams deleted the emptied tag: nothing to make", async () => {
    world.graph.deletesEmptyTags = true;
    const row: WorldGroupRow = groupFor([primary]);
    await world.sync(row);
    world.handOff(primary, null);
    await world.sync(row);
    world.graph.requests = [];

    const state: WorkspaceUserGroupSyncState = await world.sync(row);

    expect(world.graph.paths("POST")).toEqual([]);
    expect(state.isTurnedOff).toBe(true);
    expect(state.problem).toBeNull();
  });
});

describe("when Teams refuses, the admin is told plainly", () => {
  test("a tag somebody deleted (one OneUptime did not empty) is gone - not made again", async () => {
    world.graph.teams.get(TEAM_PAYMENTS)!.delete(tag.id);
    const row: WorldGroupRow = groupFor([primary]);

    const state: WorkspaceUserGroupSyncState = await world.sync(row);

    expect(state.problem).toBe(WorkspaceUserGroupProblem.Gone);
    expect(world.graph.paths("POST")).toEqual([]);
  });

  test("the tenant has not granted TeamworkTag.ReadWrite.All: admin consent is needed", async () => {
    world.graph.isTagPermissionGranted = false;
    const row: WorldGroupRow = groupFor([primary]);

    const state: WorkspaceUserGroupSyncState = await world.sync(row);

    expect(state.problem).toBe(WorkspaceUserGroupProblem.MissingPermission);
    expect(state.problemDetail).toBe("Forbidden");
    expect(world.groups.get(row.id.toString())!.nextSyncAt).toEqual(
      new Date(Date.parse(START) + 60 * 60 * 1000),
    );
  });

  test("OneUptime's app is not in the team: its roster cannot be read", async () => {
    world.teamsWithoutApp.add(TEAM_PAYMENTS);
    const row: WorldGroupRow = groupFor([primary]);

    const state: WorkspaceUserGroupSyncState = await world.sync(row);

    expect(state.problem).toBe(WorkspaceUserGroupProblem.TeamGone);
    expect(world.graph.requests).toEqual([]);
  });

  test("the team is gone from the tenant", async () => {
    world.graph.teams.delete(TEAM_PAYMENTS);
    world.graph.rosters.set(TEAM_PAYMENTS, []);
    const row: WorldGroupRow = groupFor([primary]);

    const state: WorkspaceUserGroupSyncState = await world.sync(row);

    expect(state.problem).toBe(WorkspaceUserGroupProblem.TeamGone);
  });

  test("Graph limits the rate: tried again when it says", async () => {
    world.graph.rateLimitOnce = true;
    const row: WorldGroupRow = groupFor([primary]);

    const state: WorkspaceUserGroupSyncState = await world.sync(row);

    expect(state.problem).toBe(WorkspaceUserGroupProblem.Unavailable);
    expect(world.groups.get(row.id.toString())!.nextSyncAt).toEqual(
      new Date(Date.parse(START) + 2 * 60 * 1000),
    );
  });

  test("the project is not connected to Microsoft Teams: Graph is not asked", async () => {
    world.isTeamsConnected = false;
    const row: WorldGroupRow = groupFor([primary]);

    const state: WorkspaceUserGroupSyncState = await world.sync(row);

    expect(state.problem).toBe(WorkspaceUserGroupProblem.NotConnected);
    expect(world.graph.requests).toEqual([]);
  });
});
