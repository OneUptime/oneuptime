import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import WorkspaceChannelMembers, {
  WORKSPACE_CHANNEL_NAME_LOOKUP_LIMIT,
} from "../../../../../Server/Utils/Workspace/WorkspaceChannelMembers";
import NotFoundException from "../../../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../../../Types/JSON";
import { WorkspaceChannelRecordType } from "../../../../../Types/Workspace/WorkspaceChannelLink";
import {
  WorkspaceChannelPerson,
  WorkspaceChannelState,
  WorkspaceChannelViewerStatus,
  WorkspaceRecordChannel,
  WorkspaceRecordChannels,
} from "../../../../../Types/Workspace/WorkspaceChannelMembers";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import ChannelMembersWorld, {
  ALICE,
  BOB,
  BOT_USER_ID,
  CAROL,
  DAN,
  INCIDENT_ID,
  RECORD_IDS,
  SLACK_TEAM_ID,
  TEAMS_TEAM_ID,
  TEAMS_TENANT_ID,
  slackChannel,
  teamsChannel,
} from "./ChannelMembersWorld";

/*
 * WHO IS IN A RECORD'S OWN CHANNEL, AS ITS PAGE SHOWS IT.
 *
 * The customer: "As project admins/owners, we couldn't find an option in
 * the UI to manage Slack channel membership ... if all users leave a
 * private channel, can someone re-enter or invite others without requiring
 * assistance from a Slack workspace admin?" The record's page first shows
 * the record's channels and the people in them, and whether the person
 * looking is one of them. Driven through the real WorkspaceChannelMembers
 * and SlackChannelMembers against a fake Slack workspace (ChannelMembersWorld),
 * with every request Slack is sent asserted.
 */

let world: ChannelMembersWorld;

beforeEach(() => {
  world = new ChannelMembersWorld();
  world.install();
});

afterEach(() => {
  jest.restoreAllMocks();
});

const read: (
  recordType?: WorkspaceChannelRecordType,
) => Promise<WorkspaceRecordChannels> = async (
  recordType: WorkspaceChannelRecordType = WorkspaceChannelRecordType.Incident,
): Promise<WorkspaceRecordChannels> => {
  return await WorkspaceChannelMembers.read({
    recordType: recordType,
    recordId: RECORD_IDS[recordType],
    props: world.props(),
  });
};

const names: (channel: WorkspaceRecordChannel) => Array<string> = (
  channel: WorkspaceRecordChannel,
): Array<string> => {
  return channel.people.map((person: WorkspaceChannelPerson) => {
    return person.name;
  });
};

describe("the people in a record's Slack channel", () => {
  test("a private incident channel everybody left: nobody is listed, the viewer is not in it, and they may add people", async () => {
    // Only the OneUptime app is still in the channel.
    world.slackChannels["C0INC42"]!.members = [BOT_USER_ID];

    const answer: WorkspaceRecordChannels = await read();

    expect(answer.canAddPeople).toBe(true);
    expect(answer.channels).toEqual([
      {
        channelId: "C0INC42",
        workspaceType: WorkspaceType.Slack,
        name: "inc-42",
        url: `https://slack.com/app_redirect?channel=C0INC42&team=${SLACK_TEAM_ID}`,
        isPrivate: true,
        state: WorkspaceChannelState.Members,
        people: [],
        peopleCount: 0,
        viewer: WorkspaceChannelViewerStatus.NotIn,
      },
    ]);
  });

  test("names each person: OneUptime's name for a connected account, Slack's for anybody else, the viewer first", async () => {
    world.slackChannels["C0INC42"]!.members = [
      BOT_USER_ID,
      "U0SAM",
      "U0BOB",
      "U0ALICE",
    ];

    const channel: WorkspaceRecordChannel = (await read()).channels[0]!;

    expect(channel.people).toEqual([
      {
        key: "U0ALICE",
        name: "Alice Smith",
        userId: ALICE.toString(),
        hasProfilePicture: true,
        isViewer: true,
      },
      { key: "U0BOB", name: "Bob Jones", userId: BOB.toString() },
      { key: "U0SAM", name: "Sam from Support" },
    ]);
    expect(channel.peopleCount).toBe(3);
    expect(channel.viewer).toBe(WorkspaceChannelViewerStatus.In);
  });

  test("an account that is not connected but has a project member's email address is that member", async () => {
    world.slackChannels["C0INC42"]!.members = [BOT_USER_ID, "U0CAROL"];

    const channel: WorkspaceRecordChannel = (await read()).channels[0]!;

    // Carol's OneUptime email differs from Slack's in case only.
    expect(channel.people).toEqual([
      { key: "U0CAROL", name: "Carol Lee", userId: CAROL.toString() },
    ]);
  });

  test("apps and bots - OneUptime's own among them - and deactivated accounts are not people", async () => {
    world.slackChannels["C0INC42"]!.members = [
      BOT_USER_ID,
      "U0STATUSBOT",
      "U0GONE",
      "USLACKBOT",
      "U0BOB",
    ];

    const channel: WorkspaceRecordChannel = (await read()).channels[0]!;

    expect(names(channel)).toEqual(["Bob Jones"]);
    expect(channel.peopleCount).toBe(1);
    // The app and Slackbot are never asked about; the other two are.
    expect(world.slackRequestsOf("users.info")).toEqual([
      { user: "U0STATUSBOT" },
      { user: "U0GONE" },
    ]);
  });

  test("asks Slack exactly what it needs: the channel, who is in it, and the names it does not know", async () => {
    await read();

    expect(world.slackRequests).toEqual([
      // The viewer, Alice, is connected: no lookup by email.
      { method: "conversations.info", body: { channel: "C0INC42" } },
      {
        method: "conversations.members",
        body: { channel: "C0INC42", limit: 200 },
      },
      // Bob is connected; Sam is not a OneUptime user.
      { method: "users.info", body: { user: "U0SAM" } },
    ]);
  });

  test("reads a big channel page by page", async () => {
    world.membersPageSize = 2;
    world.slackChannels["C0INC42"]!.members = [
      BOT_USER_ID,
      "U0BOB",
      "U0SAM",
      "U0ALICE",
      "U0CAROL",
    ];

    const channel: WorkspaceRecordChannel = (await read()).channels[0]!;

    expect(world.slackRequestsOf("conversations.members")).toEqual([
      { channel: "C0INC42", limit: 200 },
      { channel: "C0INC42", limit: 200, cursor: "2" },
      { channel: "C0INC42", limit: 200, cursor: "4" },
    ]);
    expect(channel.peopleCount).toBe(4);
  });

  test("names at most a budget of unknown accounts a read; the rest are counted, and named on a later read from the cache", async () => {
    const extra: number = WORKSPACE_CHANNEL_NAME_LOOKUP_LIMIT + 5;

    for (let index: number = 0; index < extra; index++) {
      const id: string = `U0X${String(index).padStart(3, "0")}`;
      world.slackAccounts.push({
        id: id,
        name: `person${index}`,
        email: "",
      });
      world.slackChannels["C0INC42"]!.members.push(id);
    }

    const first: WorkspaceRecordChannel = (await read()).channels[0]!;

    expect(world.slackRequestsOf("users.info").length).toBe(
      WORKSPACE_CHANNEL_NAME_LOOKUP_LIMIT,
    );
    // Bob and Sam, and every extra account, are counted.
    expect(first.peopleCount).toBe(extra + 2);
    expect(first.people.length).toBe(WORKSPACE_CHANNEL_NAME_LOOKUP_LIMIT + 1);

    world.slackRequests = [];

    const second: WorkspaceRecordChannel = (await read()).channels[0]!;

    // Only the ones not named yet are asked about.
    expect(world.slackRequestsOf("users.info").length).toBe(6);
    expect(second.people.length).toBe(extra + 2);
  });

  test("names come from the cache on the next read: no users.info at all", async () => {
    await read();
    world.slackRequests = [];

    const channel: WorkspaceRecordChannel = (await read()).channels[0]!;

    expect(world.slackMethods()).toEqual([
      "conversations.info",
      "conversations.members",
    ]);
    expect(names(channel)).toEqual(["Bob Jones", "Sam from Support"]);
  });

  test("without the cache (no Valkey) everything is asked of Slack, and the page still gets its answer", async () => {
    world.cacheDown = true;

    const channel: WorkspaceRecordChannel = (await read()).channels[0]!;

    expect(names(channel)).toEqual(["Bob Jones", "Sam from Support"]);
    expect(world.slackRequestsOf("users.info")).toEqual([{ user: "U0SAM" }]);
  });

  test("Slack's rate limit on names: the people it could not name are counted, not listed, and the read still answers", async () => {
    world.slackHttpStatus["users.info"] = 429;

    const channel: WorkspaceRecordChannel = (await read()).channels[0]!;

    expect(names(channel)).toEqual(["Bob Jones"]);
    expect(channel.peopleCount).toBe(2);
    expect(channel.state).toBe(WorkspaceChannelState.Members);
  });
});

describe("whether the person looking is in the channel", () => {
  test("a viewer with a connected account who is in it", async () => {
    world.slackChannels["C0INC42"]!.members.push("U0ALICE");

    const channel: WorkspaceRecordChannel = (await read()).channels[0]!;

    expect(channel.viewer).toBe(WorkspaceChannelViewerStatus.In);
    expect(world.slackRequestsOf("users.lookupByEmail")).toEqual([]);
  });

  test("a viewer who never connected Slack is found by their email address, once, then from the cache", async () => {
    world.viewer = CAROL;

    const channel: WorkspaceRecordChannel = (await read()).channels[0]!;

    expect(channel.viewer).toBe(WorkspaceChannelViewerStatus.NotIn);
    expect(world.slackRequestsOf("users.lookupByEmail")).toEqual([
      { email: "carol@acme.test" },
    ]);

    world.slackRequests = [];
    world.slackChannels["C0INC42"]!.members.push("U0CAROL");

    const again: WorkspaceRecordChannel = (await read()).channels[0]!;

    expect(again.viewer).toBe(WorkspaceChannelViewerStatus.In);
    expect(again.people[0]).toEqual({
      key: "U0CAROL",
      name: "Carol Lee",
      userId: CAROL.toString(),
      isViewer: true,
    });
    expect(world.slackRequestsOf("users.lookupByEmail")).toEqual([]);
  });

  test("a viewer nobody in Slack has the email address of is not found - and that is remembered for a while", async () => {
    world.viewer = DAN;

    const channel: WorkspaceRecordChannel = (await read()).channels[0]!;

    expect(channel.viewer).toBe(WorkspaceChannelViewerStatus.NotFound);

    world.slackRequests = [];
    await read();

    expect(world.slackRequestsOf("users.lookupByEmail")).toEqual([]);
  });

  test("an app installed before it could read email addresses finds nobody by email", async () => {
    world.viewer = CAROL;
    world.lookupByEmailMissingScope = true;

    const channel: WorkspaceRecordChannel = (await read()).channels[0]!;

    expect(channel.viewer).toBe(WorkspaceChannelViewerStatus.NotFound);
    expect(channel.state).toBe(WorkspaceChannelState.Members);
  });

  test("a project API key looks at it as nobody: not found, and may not add people", async () => {
    world.isApiKey = true;

    const answer: WorkspaceRecordChannels = await read();

    expect(answer.canAddPeople).toBe(false);
    expect(answer.channels[0]!.viewer).toBe(
      WorkspaceChannelViewerStatus.NotFound,
    );
  });
});

describe("whether the viewer may add people", () => {
  test("not without permission to edit the record", async () => {
    world.canEdit = false;

    expect((await read()).canAddPeople).toBe(false);
  });

  test("not when the permission check refuses: it is a no, not an error", async () => {
    world.editCheckThrows = true;

    const answer: WorkspaceRecordChannels = await read();

    expect(answer.canAddPeople).toBe(false);
    expect(answer.channels.length).toBe(1);
  });
});

describe("a channel OneUptime cannot list", () => {
  test("archived: named as such, with its people", async () => {
    world.slackChannels["C0INC42"]!.isArchived = true;

    const channel: WorkspaceRecordChannel = (await read()).channels[0]!;

    expect(channel.state).toBe(WorkspaceChannelState.Archived);
    expect(names(channel)).toEqual(["Bob Jones", "Sam from Support"]);
  });

  test("a private channel the OneUptime app was removed from is out of sight - Slack answers as for a deleted one", async () => {
    world.slackChannels["C0INC42"]!.members = ["U0BOB"];

    const channel: WorkspaceRecordChannel = (await read()).channels[0]!;

    expect(channel).toEqual({
      channelId: "C0INC42",
      workspaceType: WorkspaceType.Slack,
      name: "inc-42",
      url: `https://slack.com/app_redirect?channel=C0INC42&team=${SLACK_TEAM_ID}`,
      isPrivate: null,
      state: WorkspaceChannelState.Unreachable,
      people: [],
      peopleCount: 0,
      viewer: WorkspaceChannelViewerStatus.NotFound,
    });
    expect(world.slackMethods()).toEqual(["conversations.info"]);
  });

  test("a deleted channel is out of sight too", async () => {
    delete world.slackChannels["C0INC42"];

    expect((await read()).channels[0]!.state).toBe(
      WorkspaceChannelState.Unreachable,
    );
  });

  test("a public channel the app left is still listed: anybody may read a public channel's people", async () => {
    world.recordChannels[WorkspaceChannelRecordType.Alert] = [
      slackChannel("C0ALT7", "alt-7"),
    ];
    world.slackChannels["C0ALT7"]!.members = ["U0BOB"];

    const channel: WorkspaceRecordChannel = (
      await read(WorkspaceChannelRecordType.Alert)
    ).channels[0]!;

    expect(channel.state).toBe(WorkspaceChannelState.Members);
    expect(channel.isPrivate).toBe(false);
    expect(names(channel)).toEqual(["Bob Jones"]);
  });

  test("Slack disconnected from the project: not connected, and Slack is not asked", async () => {
    world.slackConnected = false;

    const channel: WorkspaceRecordChannel = (await read()).channels[0]!;

    expect(channel.state).toBe(WorkspaceChannelState.NotConnected);
    expect(channel.url).toBeUndefined();
    expect(world.slackRequests).toEqual([]);
  });

  test("a revoked token: not connected", async () => {
    world.slackRefuses["conversations.info"] = "token_revoked";

    expect((await read()).channels[0]!.state).toBe(
      WorkspaceChannelState.NotConnected,
    );
  });

  test("Slack down or limiting the rate: unavailable, to ask again later", async () => {
    world.slackHttpStatus["conversations.info"] = 429;

    expect((await read()).channels[0]!.state).toBe(
      WorkspaceChannelState.Unavailable,
    );

    world.slackHttpStatus = { "conversations.members": 503 };

    expect((await read()).channels[0]!.state).toBe(
      WorkspaceChannelState.Unavailable,
    );
  });
});

describe("Microsoft Teams channels", () => {
  test("a standard channel is managed in Teams: its team is named, nobody is listed, and its link opens it", async () => {
    world.recordChannels[WorkspaceChannelRecordType.Incident] = [
      teamsChannel(
        "19:acme0001acme0001acme0001acme0001@thread.tacv2",
        "inc-42",
        TEAMS_TEAM_ID,
      ),
    ];
    world.teamsMembershipTypes[
      "19:acme0001acme0001acme0001acme0001@thread.tacv2"
    ] = "standard";

    const answer: WorkspaceRecordChannels = await read();

    expect(answer.channels).toEqual([
      {
        channelId: "19:acme0001acme0001acme0001acme0001@thread.tacv2",
        workspaceType: WorkspaceType.MicrosoftTeams,
        name: "inc-42",
        url: `https://teams.microsoft.com/l/channel/19%3Aacme0001acme0001acme0001acme0001%40thread.tacv2/inc-42?groupId=${TEAMS_TEAM_ID}&tenantId=${TEAMS_TENANT_ID}`,
        isPrivate: false,
        state: WorkspaceChannelState.ManagedInTeams,
        people: [],
        peopleCount: 0,
        viewer: WorkspaceChannelViewerStatus.NotFound,
        teamName: "Ops",
      },
    ]);
    // Nothing is asked of Slack for a Teams channel.
    expect(world.slackRequests).toEqual([]);
  });

  test("a private Teams channel says so; one Microsoft Graph cannot tell about is neither", async () => {
    world.recordChannels[WorkspaceChannelRecordType.Incident] = [
      teamsChannel("19:private0@thread.tacv2", "inc-42", TEAMS_TEAM_ID),
      teamsChannel("19:unknown0@thread.tacv2", "inc-43", TEAMS_TEAM_ID),
    ];
    world.teamsMembershipTypes["19:private0@thread.tacv2"] = "private";
    world.teamsMembershipTypes["19:unknown0@thread.tacv2"] = new Error(
      "Forbidden",
    );

    const channels: Array<WorkspaceRecordChannel> = (await read()).channels;

    expect(
      channels.map((channel: WorkspaceRecordChannel) => {
        return channel.isPrivate;
      }),
    ).toEqual([true, null]);
  });

  test("Teams disconnected: not connected", async () => {
    world.teamsConnected = false;
    world.recordChannels[WorkspaceChannelRecordType.Incident] = [
      teamsChannel("19:acme@thread.tacv2", "inc-42", TEAMS_TEAM_ID),
    ];

    expect((await read()).channels[0]!.state).toBe(
      WorkspaceChannelState.NotConnected,
    );
  });

  test("a record with channels in both: Slack's first, each as its product tells it", async () => {
    world.recordChannels[WorkspaceChannelRecordType.Incident] = [
      teamsChannel("19:acme@thread.tacv2", "inc-42", TEAMS_TEAM_ID),
      slackChannel("C0INC42", "inc-42"),
    ];

    const channels: Array<WorkspaceRecordChannel> = (await read()).channels;

    expect(
      channels.map((channel: WorkspaceRecordChannel) => {
        return [channel.workspaceType, channel.state];
      }),
    ).toEqual([
      [WorkspaceType.Slack, WorkspaceChannelState.Members],
      [WorkspaceType.MicrosoftTeams, WorkspaceChannelState.ManagedInTeams],
    ]);
  });
});

describe("which records, and which of their channels", () => {
  test.each(Object.values(WorkspaceChannelRecordType))(
    "the %s page reads its own record's channel",
    async (recordType: WorkspaceChannelRecordType) => {
      const answer: WorkspaceRecordChannels = await read(recordType);

      expect(answer.channels.length).toBe(1);
      expect(answer.channels[0]!.workspaceType).toBe(WorkspaceType.Slack);
    },
  );

  test("a record the viewer may not read is not found, and nothing is asked of Slack", async () => {
    world.canRead = false;

    await expect(read()).rejects.toBeInstanceOf(NotFoundException);
    expect(world.slackRequests).toEqual([]);
  });

  test("a record without a channel of its own answers none, without a word to Slack", async () => {
    world.recordChannels[WorkspaceChannelRecordType.Incident] = [];

    expect(await read()).toEqual({ channels: [], canAddPeople: false });
    expect(world.slackRequests).toEqual([]);
  });

  test("the stored list is JSON: entries that are not channels are skipped, and a channel stored twice is listed once", async () => {
    world.recordChannels[WorkspaceChannelRecordType.Incident] = [
      null,
      "C0INC42",
      { name: "no-id", workspaceType: WorkspaceType.Slack },
      { id: "C0INC42", name: "inc-42", workspaceType: "Discord" },
      slackChannel("C0INC42", "inc-42"),
      slackChannel("C0INC42", "inc-42"),
    ] as unknown as JSONObject;

    const channels: Array<WorkspaceRecordChannel> = (await read()).channels;

    expect(
      channels.map((channel: WorkspaceRecordChannel) => {
        return channel.channelId;
      }),
    ).toEqual(["C0INC42"]);
  });

  test("a record that holds no list at all answers none", async () => {
    world.recordChannels[WorkspaceChannelRecordType.Incident] = undefined;

    expect((await read()).channels).toEqual([]);
  });

  test("reads the incident with the caller's own props, and its channels as OneUptime", async () => {
    const IncidentService: {
      findOneById: unknown;
    } = (await import("../../../../../Server/Services/IncidentService"))
      .default as unknown as { findOneById: unknown };
    const calls: Array<Array<unknown>> = (
      IncidentService.findOneById as unknown as {
        mock: { calls: Array<Array<unknown>> };
      }
    ).mock.calls;

    await read();

    const first: JSONObject = calls[0]![0] as JSONObject;
    const second: JSONObject = calls[1]![0] as JSONObject;

    expect(String(first["id"])).toBe(INCIDENT_ID.toString());
    expect(first["props"]).toEqual(world.props());
    expect(first["select"]).toEqual({ _id: true, projectId: true });
    expect(second["props"]).toEqual({ isRoot: true });
    expect(second["select"]).toEqual({ postUpdatesToWorkspaceChannels: true });
  });
});
