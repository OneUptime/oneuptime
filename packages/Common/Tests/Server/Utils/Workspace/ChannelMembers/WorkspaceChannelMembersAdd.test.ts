import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import WorkspaceNotificationLog from "../../../../../Models/DatabaseModels/WorkspaceNotificationLog";
import WorkspaceChannelMembers from "../../../../../Server/Utils/Workspace/WorkspaceChannelMembers";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../../../Types/Exception/NotFoundException";
import ObjectID from "../../../../../Types/ObjectID";
import { WorkspaceChannelRecordType } from "../../../../../Types/Workspace/WorkspaceChannelLink";
import {
  WorkspaceChannelAddAnswer,
  WorkspaceChannelAddOutcome,
  WorkspaceChannelState,
} from "../../../../../Types/Workspace/WorkspaceChannelMembers";
import WorkspaceNotificationActionType from "../../../../../Types/Workspace/WorkspaceNotificationActionType";
import WorkspaceNotificationStatus from "../../../../../Types/Workspace/WorkspaceNotificationStatus";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import ChannelMembersWorld, {
  ALICE,
  BOB,
  BOT_USER_ID,
  CAROL,
  DAN,
  ERIN,
  FeedEntry,
  GINA,
  INCIDENT_ID,
  MALLORY,
  OSCAR,
  OTHER_PROJECT_TEAM_ID,
  PAT,
  PLATFORM_TEAM_ID,
  PROJECT_ID,
  RECORD_IDS,
  SLACK_TEAM_ID,
  TEAMS_TEAM_ID,
  slackChannel,
  teamsChannel,
} from "./ChannelMembersWorld";

/*
 * ADDING PEOPLE TO A RECORD'S OWN CHANNEL FROM ITS PAGE.
 *
 * "If all users leave a private channel, can someone re-enter or invite
 * others without requiring assistance from a Slack workspace admin?" Yes:
 * the OneUptime app created the channel and is still in it, so a member who
 * may edit the record asks it to invite them - themselves (Join channel) or
 * anybody in the project, a person or a whole team. Each person is answered
 * on their own, and whoever was added is written to the record's feed and
 * its Notification Logs. Driven through the real WorkspaceChannelMembers,
 * SlackChannelMembers and WorkspaceNotificationLogService against a fake
 * Slack workspace (ChannelMembersWorld); every request Slack is sent is
 * asserted.
 */

let world: ChannelMembersWorld;

beforeEach(() => {
  world = new ChannelMembersWorld();
  world.install();
  // The customer's channel: everybody left; only the OneUptime app is in it.
  world.slackChannels["C0INC42"]!.members = [BOT_USER_ID];
});

afterEach(() => {
  jest.restoreAllMocks();
});

const add: (data: {
  userIds?: Array<ObjectID>;
  teamIds?: Array<ObjectID>;
  channelId?: string;
  recordType?: WorkspaceChannelRecordType;
}) => Promise<WorkspaceChannelAddAnswer> = async (data: {
  userIds?: Array<ObjectID>;
  teamIds?: Array<ObjectID>;
  channelId?: string;
  recordType?: WorkspaceChannelRecordType;
}): Promise<WorkspaceChannelAddAnswer> => {
  const recordType: WorkspaceChannelRecordType =
    data.recordType || WorkspaceChannelRecordType.Incident;

  return await WorkspaceChannelMembers.add({
    recordType: recordType,
    recordId: RECORD_IDS[recordType],
    props: world.props(),
    channelId: data.channelId || "C0INC42",
    userIds: data.userIds || [],
    teamIds: data.teamIds || [],
  });
};

const inviteRows: () => Array<WorkspaceNotificationLog> =
  (): Array<WorkspaceNotificationLog> => {
    return world.logRows.filter((row: WorkspaceNotificationLog) => {
      return row.actionType === WorkspaceNotificationActionType.InviteUser;
    });
  };

describe("joining the channel yourself", () => {
  test("re-enters a private channel everybody left: the app invites the viewer, by their connected account", async () => {
    const answer: WorkspaceChannelAddAnswer = await add({ userIds: [ALICE] });

    expect(answer).toEqual({
      results: [
        {
          userId: ALICE.toString(),
          name: "Alice Smith",
          outcome: WorkspaceChannelAddOutcome.Added,
        },
      ],
    });
    expect(world.slackRequests).toEqual([
      { method: "conversations.info", body: { channel: "C0INC42" } },
      {
        method: "conversations.members",
        body: { channel: "C0INC42", limit: 200 },
      },
      {
        method: "conversations.invite",
        body: { channel: "C0INC42", users: "U0ALICE" },
      },
    ]);
    expect(world.slackChannels["C0INC42"]!.members).toEqual([
      BOT_USER_ID,
      "U0ALICE",
    ]);
  });

  test("the feed says the viewer joined, with a link to the channel", async () => {
    await add({ userIds: [ALICE] });

    expect(world.feedEntries).toEqual([
      {
        recordType: WorkspaceChannelRecordType.Incident,
        recordId: INCIDENT_ID.toString(),
        eventType: "ChannelMemberAdded",
        markdown: `👥 Joined the Slack channel [#inc-42](https://slack.com/app_redirect?channel=C0INC42&team=${SLACK_TEAM_ID}).`,
        userId: ALICE.toString(),
      },
    ]);
  });

  test("the invitation is on the incident's Notification Logs, as the rules' invitations are", async () => {
    await add({ userIds: [ALICE] });

    const rows: Array<WorkspaceNotificationLog> = inviteRows();

    expect(rows.length).toBe(1);
    expect(rows[0]!.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(rows[0]!.incidentId?.toString()).toBe(INCIDENT_ID.toString());
    expect(rows[0]!.userId?.toString()).toBe(ALICE.toString());
    expect(rows[0]!.workspaceType).toBe(WorkspaceType.Slack);
    expect(rows[0]!.channelId).toBe("C0INC42");
    expect(rows[0]!.channelName).toBe("inc-42");
    expect(rows[0]!.status).toBe(WorkspaceNotificationStatus.Success);
  });

  test("a viewer who never connected Slack joins by the account with their email address", async () => {
    world.viewer = CAROL;

    const answer: WorkspaceChannelAddAnswer = await add({ userIds: [CAROL] });

    expect(answer.results[0]!.outcome).toBe(WorkspaceChannelAddOutcome.Added);
    expect(world.slackRequestsOf("users.lookupByEmail")).toEqual([
      { email: "carol@acme.test" },
    ]);
    expect(world.invites()).toEqual([{ channel: "C0INC42", users: "U0CAROL" }]);
  });

  test("a viewer nobody in Slack has the email address of is not found, and nobody is invited or written down", async () => {
    world.viewer = DAN;

    const answer: WorkspaceChannelAddAnswer = await add({ userIds: [DAN] });

    expect(answer.results).toEqual([
      {
        userId: DAN.toString(),
        name: "Dan Brown",
        outcome: WorkspaceChannelAddOutcome.NotFound,
      },
    ]);
    expect(world.invites()).toEqual([]);
    expect(world.feedEntries).toEqual([]);
    expect(inviteRows()).toEqual([]);
  });

  test("a viewer already in it is told so, and Slack is not asked to invite them again", async () => {
    world.slackChannels["C0INC42"]!.members.push("U0ALICE");

    const answer: WorkspaceChannelAddAnswer = await add({ userIds: [ALICE] });

    expect(answer.results[0]!.outcome).toBe(
      WorkspaceChannelAddOutcome.AlreadyIn,
    );
    expect(world.invites()).toEqual([]);
    expect(world.feedEntries).toEqual([]);
  });
});

describe("adding other people", () => {
  test("adds each one in a request of their own, and says each of them in one feed entry", async () => {
    const answer: WorkspaceChannelAddAnswer = await add({
      userIds: [BOB, CAROL],
    });

    expect(answer.results).toEqual([
      {
        userId: BOB.toString(),
        name: "Bob Jones",
        outcome: WorkspaceChannelAddOutcome.Added,
      },
      {
        userId: CAROL.toString(),
        name: "Carol Lee",
        outcome: WorkspaceChannelAddOutcome.Added,
      },
    ]);
    expect(world.invites()).toEqual([
      { channel: "C0INC42", users: "U0BOB" },
      { channel: "C0INC42", users: "U0CAROL" },
    ]);
    expect(world.feedEntries.length).toBe(1);
    expect(world.feedEntries[0]!.markdown).toBe(
      `👥 Added **[Bob Jones](https://oneuptime.test/users/${BOB.toString()})** and **[Carol Lee](https://oneuptime.test/users/${CAROL.toString()})** to the Slack channel [#inc-42](https://slack.com/app_redirect?channel=C0INC42&team=${SLACK_TEAM_ID}).`,
    );
    // By the person who added them.
    expect(world.feedEntries[0]!.userId).toBe(ALICE.toString());
    expect(
      inviteRows().map((row: WorkspaceNotificationLog) => {
        return row.userId?.toString();
      }),
    ).toEqual([BOB.toString(), CAROL.toString()]);
  });

  test("the viewer and others at once: joined, and added the others", async () => {
    await add({ userIds: [ALICE, BOB] });

    expect(world.feedEntries[0]!.markdown).toBe(
      `👥 Joined the Slack channel [#inc-42](https://slack.com/app_redirect?channel=C0INC42&team=${SLACK_TEAM_ID}) and added **[Bob Jones](https://oneuptime.test/users/${BOB.toString()})** to it.`,
    );
  });

  test("three or more read as a list", async () => {
    await add({ userIds: [BOB, CAROL, ERIN] });

    expect(world.feedEntries[0]!.markdown).toContain(
      `👥 Added **[Bob Jones](https://oneuptime.test/users/${BOB.toString()})**, **[Carol Lee](https://oneuptime.test/users/${CAROL.toString()})** and **[Erin Wu](https://oneuptime.test/users/${ERIN.toString()})** to the Slack channel`,
    );
  });

  test("only the people who were added are in the feed: one already in it and one not found are left out", async () => {
    world.slackChannels["C0INC42"]!.members.push("U0BOB");

    const answer: WorkspaceChannelAddAnswer = await add({
      userIds: [BOB, DAN, CAROL],
    });

    expect(
      answer.results.map((result: { outcome: WorkspaceChannelAddOutcome }) => {
        return result.outcome;
      }),
    ).toEqual([
      WorkspaceChannelAddOutcome.AlreadyIn,
      WorkspaceChannelAddOutcome.NotFound,
      WorkspaceChannelAddOutcome.Added,
    ]);
    expect(world.feedEntries[0]!.markdown).toBe(
      `👥 Added **[Carol Lee](https://oneuptime.test/users/${CAROL.toString()})** to the Slack channel [#inc-42](https://slack.com/app_redirect?channel=C0INC42&team=${SLACK_TEAM_ID}).`,
    );
  });

  test("somebody who is not a member of the project is not added, nor even looked up", async () => {
    const answer: WorkspaceChannelAddAnswer = await add({ userIds: [OSCAR] });

    expect(answer.results).toEqual([
      {
        userId: OSCAR.toString(),
        name: "Oscar Out",
        outcome: WorkspaceChannelAddOutcome.NotProjectMember,
      },
    ]);
    expect(world.invites()).toEqual([]);
    expect(world.slackRequestsOf("users.lookupByEmail")).toEqual([]);
  });

  test("a Slack guest Slack will not let into the channel", async () => {
    world.inviteRefusals["U0GINA"] = "user_is_restricted";

    const answer: WorkspaceChannelAddAnswer = await add({ userIds: [GINA] });

    expect(answer.results[0]!.outcome).toBe(WorkspaceChannelAddOutcome.Guest);
  });

  test("a single-channel guest already in their one channel", async () => {
    world.inviteRefusals["U0GINA"] = "ura_max_channels";

    const answer: WorkspaceChannelAddAnswer = await add({ userIds: [GINA] });

    expect(answer.results[0]!.outcome).toBe(WorkspaceChannelAddOutcome.Guest);
  });

  test("Slack refusing one person for a reason of its own does not stop the others", async () => {
    world.inviteRefusals["U0BOB"] = "cant_invite";

    const answer: WorkspaceChannelAddAnswer = await add({
      userIds: [BOB, CAROL],
    });

    expect(
      answer.results.map((result: { outcome: WorkspaceChannelAddOutcome }) => {
        return result.outcome;
      }),
    ).toEqual([
      WorkspaceChannelAddOutcome.Refused,
      WorkspaceChannelAddOutcome.Added,
    ]);
  });

  test("Slack limiting the rate for one person: try again, and the others are still tried", async () => {
    world.inviteRefusals["U0BOB"] = "ratelimited";

    const answer: WorkspaceChannelAddAnswer = await add({
      userIds: [BOB, CAROL],
    });

    expect(
      answer.results.map((result: { outcome: WorkspaceChannelAddOutcome }) => {
        return result.outcome;
      }),
    ).toEqual([
      WorkspaceChannelAddOutcome.TryAgain,
      WorkspaceChannelAddOutcome.Added,
    ]);
  });

  test("an invitation Slack answers already_in_channel (somebody joined meanwhile) is in it already", async () => {
    world.inviteRefusals["U0BOB"] = "already_in_channel";

    const answer: WorkspaceChannelAddAnswer = await add({ userIds: [BOB] });

    expect(answer.results[0]!.outcome).toBe(
      WorkspaceChannelAddOutcome.AlreadyIn,
    );
    expect(world.feedEntries).toEqual([]);
  });

  test("a name full of Markdown reads as typed in the feed: no bold, no link, no mention", async () => {
    await add({ userIds: [MALLORY] });

    const markdown: string = world.feedEntries[0]!.markdown;

    expect(markdown).not.toContain("[click](https://evil.test)");
    expect(markdown).not.toContain("<!here>");
    expect(markdown).toContain("\\*\\*Mal\\*\\*");
  });
});

describe("adding a team", () => {
  test("adds everybody in the project's team who accepted, each once, beside the people named", async () => {
    const answer: WorkspaceChannelAddAnswer = await add({
      userIds: [BOB],
      teamIds: [PLATFORM_TEAM_ID],
    });

    // Bob is named and in the team: once. Pat has not accepted: not at all.
    expect(
      answer.results.map((result: { userId: string }) => {
        return result.userId;
      }),
    ).toEqual([BOB.toString(), ERIN.toString()]);
    expect(
      answer.results.map((result: { userId: string }) => {
        return result.userId;
      }),
    ).not.toContain(PAT.toString());
    expect(world.invites()).toEqual([
      { channel: "C0INC42", users: "U0BOB" },
      { channel: "C0INC42", users: "U0ERIN" },
    ]);
  });

  test("another project's team adds nobody", async () => {
    await expect(
      add({ teamIds: [OTHER_PROJECT_TEAM_ID] }),
    ).rejects.toBeInstanceOf(BadDataException);
    expect(world.slackRequests).toEqual([]);
  });
});

describe("a channel that can take nobody", () => {
  test("archived: said so, and nobody is invited", async () => {
    world.slackChannels["C0INC42"]!.isArchived = true;

    const answer: WorkspaceChannelAddAnswer = await add({ userIds: [ALICE] });

    expect(answer).toEqual({
      channelState: WorkspaceChannelState.Archived,
      results: [],
    });
    expect(world.invites()).toEqual([]);
  });

  test("a private channel the OneUptime app was removed from: out of OneUptime's sight", async () => {
    world.slackChannels["C0INC42"]!.members = ["U0BOB"];

    const answer: WorkspaceChannelAddAnswer = await add({ userIds: [ALICE] });

    expect(answer).toEqual({
      channelState: WorkspaceChannelState.Unreachable,
      results: [],
    });
    expect(world.slackMethods()).toEqual(["conversations.info"]);
  });

  test("a public channel the app was removed from: it joins first, once, then invites everybody", async () => {
    world.recordChannels[WorkspaceChannelRecordType.Alert] = [
      slackChannel("C0ALT7", "alt-7"),
    ];
    world.slackChannels["C0ALT7"]!.members = [];

    const answer: WorkspaceChannelAddAnswer = await add({
      recordType: WorkspaceChannelRecordType.Alert,
      channelId: "C0ALT7",
      userIds: [ALICE, BOB],
    });

    expect(
      answer.results.map((result: { outcome: WorkspaceChannelAddOutcome }) => {
        return result.outcome;
      }),
    ).toEqual([
      WorkspaceChannelAddOutcome.Added,
      WorkspaceChannelAddOutcome.Added,
    ]);
    expect(world.slackMethods()).toEqual([
      "conversations.info",
      "conversations.members",
      "conversations.invite",
      "conversations.join",
      "conversations.invite",
      "conversations.invite",
    ]);
    expect(world.slackRequestsOf("conversations.join")).toEqual([
      { channel: "C0ALT7" },
    ]);
  });

  test("archived between reading it and inviting: the people added before are kept, and the channel's state is said", async () => {
    world.inviteRefusals["U0CAROL"] = "is_archived";

    const answer: WorkspaceChannelAddAnswer = await add({
      userIds: [BOB, CAROL, ERIN],
    });

    expect(answer.channelState).toBe(WorkspaceChannelState.Archived);
    expect(answer.results).toEqual([
      {
        userId: BOB.toString(),
        name: "Bob Jones",
        outcome: WorkspaceChannelAddOutcome.Added,
      },
    ]);
    // Erin is not tried once the channel refused.
    expect(world.invites().length).toBe(2);
    expect(world.feedEntries.length).toBe(1);
  });

  test("Slack disconnected from the project", async () => {
    world.slackConnected = false;

    expect(await add({ userIds: [ALICE] })).toEqual({
      channelState: WorkspaceChannelState.NotConnected,
      results: [],
    });
    expect(world.slackRequests).toEqual([]);
  });

  test("a revoked token", async () => {
    world.slackRefuses["conversations.info"] = "invalid_auth";

    expect((await add({ userIds: [ALICE] })).channelState).toBe(
      WorkspaceChannelState.NotConnected,
    );
  });

  test("Slack down", async () => {
    world.slackHttpStatus["conversations.members"] = 500;

    expect((await add({ userIds: [ALICE] })).channelState).toBe(
      WorkspaceChannelState.Unavailable,
    );
    expect(world.invites()).toEqual([]);
  });
});

describe("who may add people, and to which channel", () => {
  test("not somebody who may only read the record: refused before anything is asked of Slack", async () => {
    world.canEdit = false;

    await expect(add({ userIds: [ALICE] })).rejects.toBeInstanceOf(
      NotAuthorizedException,
    );
    await expect(add({ userIds: [ALICE] })).rejects.toThrow(
      "You do not have permission to add people to this incident's channel: it needs permission to edit the incident.",
    );
    expect(world.slackRequests).toEqual([]);
  });

  test("not when the permission check itself refuses", async () => {
    world.editCheckThrows = true;

    await expect(add({ userIds: [ALICE] })).rejects.toBeInstanceOf(
      NotAuthorizedException,
    );
  });

  test("not a project API key: a person adds people", async () => {
    world.isApiKey = true;

    await expect(add({ userIds: [ALICE] })).rejects.toBeInstanceOf(
      NotAuthorizedException,
    );
  });

  test("a record the caller cannot read is not found", async () => {
    world.canRead = false;

    await expect(add({ userIds: [ALICE] })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(world.slackRequests).toEqual([]);
  });

  test("only into the record's own channel: any other channel id is not found, and nobody is invited anywhere", async () => {
    await expect(
      add({ userIds: [ALICE], channelId: "C0GENERAL" }),
    ).rejects.toThrow("This channel is not one of this incident's channels.");
    expect(world.slackRequests).toEqual([]);
  });

  test("not into a Microsoft Teams channel: Teams decides who can open it", async () => {
    world.recordChannels[WorkspaceChannelRecordType.Incident] = [
      teamsChannel("19:acme@thread.tacv2", "inc-42", TEAMS_TEAM_ID),
    ];

    await expect(
      add({ userIds: [ALICE], channelId: "19:acme@thread.tacv2" }),
    ).rejects.toBeInstanceOf(BadDataException);
  });

  test("nobody to add is refused", async () => {
    await expect(add({})).rejects.toBeInstanceOf(BadDataException);
  });
});

describe("every kind of record", () => {
  test.each([
    [WorkspaceChannelRecordType.Alert, "C0ALT7", "alt-7", "alertId"],
    [
      WorkspaceChannelRecordType.IncidentEpisode,
      "C0IE3",
      "ie-3",
      "incidentEpisodeId",
    ],
    [
      WorkspaceChannelRecordType.AlertEpisode,
      "C0AE5",
      "ae-5",
      "alertEpisodeId",
    ],
    [
      WorkspaceChannelRecordType.ScheduledMaintenance,
      "C0SM5",
      "sm-5",
      "scheduledMaintenanceId",
    ],
  ] as Array<[WorkspaceChannelRecordType, string, string, string]>)(
    "the %s's own feed and Notification Logs say who was added",
    async (
      recordType: WorkspaceChannelRecordType,
      channelId: string,
      channelName: string,
      logColumn: string,
    ) => {
      await add({ recordType, channelId, userIds: [BOB] });

      expect(world.feedEntries).toEqual([
        {
          recordType: recordType,
          recordId: RECORD_IDS[recordType].toString(),
          eventType: "ChannelMemberAdded",
          markdown: `👥 Added **[Bob Jones](https://oneuptime.test/users/${BOB.toString()})** to the Slack channel [#${channelName}](https://slack.com/app_redirect?channel=${channelId}&team=${SLACK_TEAM_ID}).`,
          userId: ALICE.toString(),
        } as FeedEntry,
      ]);

      const row: WorkspaceNotificationLog = inviteRows()[0]!;

      expect(
        (row as unknown as Record<string, ObjectID | undefined>)[
          logColumn
        ]?.toString(),
      ).toBe(RECORD_IDS[recordType].toString());
      expect(row.incidentId).toBeUndefined();
    },
  );
});

describe("the feed sentence", () => {
  test("a channel without a link is named, not linked", () => {
    expect(
      WorkspaceChannelMembers.getFeedMarkdown({
        channelName: "inc-42",
        channelUrl: null,
        actorJoined: true,
        others: [],
      }).toString(),
    ).toBe("👥 Joined the Slack channel #inc-42.");
  });

  test("a channel name is written once with its #, whatever was stored", () => {
    expect(WorkspaceChannelMembers.getSlackChannelLabel("#inc-42")).toBe(
      "#inc-42",
    );
    expect(WorkspaceChannelMembers.getSlackChannelLabel("  inc-42 ")).toBe(
      "#inc-42",
    );
    expect(WorkspaceChannelMembers.getSlackChannelLabel("")).toBe("#channel");
  });
});
