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
  MATTERMOST_BOT_ID,
  MATTERMOST_SERVER,
  MM_AE5,
  MM_ALICE,
  MM_ALT7,
  MM_BOB,
  MM_CAROL,
  MM_ERIN,
  MM_GINA,
  MM_IE3,
  MM_INC42,
  MM_SM5,
  OSCAR,
  OTHER_PROJECT_TEAM_ID,
  PAT,
  PLATFORM_TEAM_ID,
  PROJECT_ID,
  RECORD_IDS,
  SLACK_TEAM_ID,
  TEAMS_TEAM_ID,
  mattermostChannel,
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
 * SlackChannelMembers, MattermostUtil and WorkspaceNotificationLogService
 * against a fake Slack workspace and a fake Mattermost server
 * (ChannelMembersWorld); every request each is sent is asserted.
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

  /*
   * Add people shows the server's words under its list: a team picked with
   * nobody in it yet is said so, not "choose someone" - somebody just did.
   */
  test("a team with nobody in it yet is said so, not taken for an empty request", async () => {
    world.platformTeam = world.platformTeam.map(
      (member: { userId: ObjectID; accepted: boolean }) => {
        return { ...member, accepted: false };
      },
    );

    await expect(add({ teamIds: [PLATFORM_TEAM_ID] })).rejects.toThrow(
      new BadDataException("The team you picked has nobody in it yet."),
    );
    await expect(
      add({ teamIds: [PLATFORM_TEAM_ID, OTHER_PROJECT_TEAM_ID] }),
    ).rejects.toThrow(
      new BadDataException("The teams you picked have nobody in them yet."),
    );
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

  /*
   * #6749: Slack installed for a whole Enterprise organization, removed from
   * the workspace the channel is in. Slack answers team_access_not_granted
   * there, while the organization's other workspaces still work: the
   * channel's workspace is said, not the project's connection.
   */
  test("the channel's workspace no longer has OneUptime (an Enterprise organization's): said so - not that Slack is not connected - and nobody is invited", async () => {
    world.slackRefuses["conversations.info"] = "team_access_not_granted";

    expect(await add({ userIds: [ALICE] })).toEqual({
      channelState: WorkspaceChannelState.WorkspaceNotAdded,
      results: [],
    });
    expect(world.invites()).toEqual([]);
  });

  test("removed from the channel's workspace between reading it and inviting: the people added before are kept, and the workspace is said", async () => {
    world.inviteRefusals["U0CAROL"] = "team_access_not_granted";

    const answer: WorkspaceChannelAddAnswer = await add({
      userIds: [BOB, CAROL, ERIN],
    });

    expect(answer.channelState).toBe(WorkspaceChannelState.WorkspaceNotAdded);
    expect(answer.results).toEqual([
      {
        userId: BOB.toString(),
        name: "Bob Jones",
        outcome: WorkspaceChannelAddOutcome.Added,
      },
    ]);
    // Erin is not tried once the workspace refused.
    expect(world.invites().length).toBe(2);
  });

  test("Slack answering a lookup by email so: the same, and nobody is invited", async () => {
    world.slackRefuses["users.lookupByEmail"] = "team_access_not_granted";

    expect((await add({ userIds: [CAROL] })).channelState).toBe(
      WorkspaceChannelState.WorkspaceNotAdded,
    );
    expect(world.invites()).toEqual([]);
  });

  test("a revoked token at a lookup by email: not connected, as before", async () => {
    world.slackRefuses["users.lookupByEmail"] = "invalid_auth";

    expect((await add({ userIds: [CAROL] })).channelState).toBe(
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

  // A record of Scheduled Maintenance is a maintenance event (#6817).
  test("on a maintenance event, the refusal calls it one", async () => {
    world.canEdit = false;

    await expect(
      add({
        recordType: WorkspaceChannelRecordType.ScheduledMaintenance,
        channelId: "C0SM5",
        userIds: [ALICE],
      }),
    ).rejects.toThrow(
      "You do not have permission to add people to this maintenance event's channel: it needs permission to edit the maintenance event.",
    );
    expect(world.slackRequests).toEqual([]);
  });

  test("on a maintenance event, another channel id is not one of its channels", async () => {
    await expect(
      add({
        recordType: WorkspaceChannelRecordType.ScheduledMaintenance,
        channelId: "C0GENERAL",
        userIds: [ALICE],
      }),
    ).rejects.toThrow(
      "This channel is not one of this maintenance event's channels.",
    );
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
    await expect(add({})).rejects.toThrow(
      new BadDataException("Choose at least one person or team to add."),
    );
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

describe("adding people to a Mattermost channel", () => {
  const CHANNEL_URL: string = `${MATTERMOST_SERVER}/acme/channels/inc-42`;
  const addHere: (data: {
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
    return await add({ channelId: MM_INC42, ...data });
  };

  beforeEach(() => {
    world.recordChannels[WorkspaceChannelRecordType.Incident] = [
      mattermostChannel(MM_INC42, "inc-42"),
    ];
    // Everybody left the private channel: only the bot is in it.
    world.mattermostChannels[MM_INC42]!.members = [MATTERMOST_BOT_ID];
  });

  describe("joining the channel yourself", () => {
    test("re-enters a private channel everybody left: the bot adds the viewer, by their connected account", async () => {
      const answer: WorkspaceChannelAddAnswer = await addHere({
        userIds: [ALICE],
      });

      expect(answer).toEqual({
        results: [
          {
            userId: ALICE.toString(),
            name: "Alice Smith",
            outcome: WorkspaceChannelAddOutcome.Added,
          },
        ],
      });
      expect(world.mattermostRequests).toEqual([
        { method: "GET", path: `/api/v4/channels/${MM_INC42}` },
        {
          method: "GET",
          path: "/api/v4/users",
          query: { in_channel: MM_INC42, page: "0", per_page: "200" },
        },
        {
          method: "POST",
          path: `/api/v4/channels/${MM_INC42}/members`,
          body: { user_id: MM_ALICE },
        },
      ]);
      expect(world.mattermostChannels[MM_INC42]!.members).toEqual([
        MATTERMOST_BOT_ID,
        MM_ALICE,
      ]);
      // Nothing is asked of Slack for a Mattermost channel.
      expect(world.slackRequests).toEqual([]);
    });

    test("the feed says the viewer joined the Mattermost channel, with a link to it", async () => {
      await addHere({ userIds: [ALICE] });

      expect(world.feedEntries).toEqual([
        {
          recordType: WorkspaceChannelRecordType.Incident,
          recordId: INCIDENT_ID.toString(),
          eventType: "ChannelMemberAdded",
          markdown: `👥 Joined the Mattermost channel [inc-42](${CHANNEL_URL}).`,
          userId: ALICE.toString(),
        },
      ]);
    });

    test("the invitation is on the incident's Notification Logs, as Mattermost's", async () => {
      await addHere({ userIds: [ALICE] });

      const rows: Array<WorkspaceNotificationLog> = inviteRows();

      expect(rows.length).toBe(1);
      expect(rows[0]!.incidentId?.toString()).toBe(INCIDENT_ID.toString());
      expect(rows[0]!.userId?.toString()).toBe(ALICE.toString());
      expect(rows[0]!.workspaceType).toBe(WorkspaceType.Mattermost);
      expect(rows[0]!.channelId).toBe(MM_INC42);
      expect(rows[0]!.channelName).toBe("inc-42");
      expect(rows[0]!.status).toBe(WorkspaceNotificationStatus.Success);
    });

    test("a viewer who never connected joins by the account with their email address", async () => {
      world.viewer = CAROL;

      const answer: WorkspaceChannelAddAnswer = await addHere({
        userIds: [CAROL],
      });

      expect(answer.results[0]!.outcome).toBe(WorkspaceChannelAddOutcome.Added);
      expect(world.mattermostAdds()).toEqual([
        { channel: MM_INC42, user: MM_CAROL },
      ]);
    });

    test("a viewer nobody on the server has the email address of is not found, and nobody is added or written down", async () => {
      world.viewer = DAN;

      const answer: WorkspaceChannelAddAnswer = await addHere({
        userIds: [DAN],
      });

      expect(answer.results).toEqual([
        {
          userId: DAN.toString(),
          name: "Dan Brown",
          outcome: WorkspaceChannelAddOutcome.NotFound,
        },
      ]);
      expect(world.mattermostAdds()).toEqual([]);
      expect(world.feedEntries).toEqual([]);
      expect(inviteRows()).toEqual([]);
    });

    test("a server that does not show email addresses to the bot finds nobody by email", async () => {
      world.mattermostShowsEmails = false;
      world.viewer = CAROL;

      expect((await addHere({ userIds: [CAROL] })).results[0]!.outcome).toBe(
        WorkspaceChannelAddOutcome.NotFound,
      );
      expect(world.mattermostAdds()).toEqual([]);
    });

    /*
     * Mattermost answers somebody in the channel already as somebody it added,
     * so only reading who is in it first tells the two apart.
     */
    test("a viewer already in it is told so: Mattermost is not asked, and would not have said", async () => {
      world.mattermostChannels[MM_INC42]!.members.push(MM_ALICE);

      const answer: WorkspaceChannelAddAnswer = await addHere({
        userIds: [ALICE],
      });

      expect(answer.results[0]!.outcome).toBe(
        WorkspaceChannelAddOutcome.AlreadyIn,
      );
      expect(world.mattermostAdds()).toEqual([]);
      expect(world.feedEntries).toEqual([]);
    });
  });

  describe("adding other people", () => {
    test("adds each one in a request of their own, and says each of them in one feed entry", async () => {
      const answer: WorkspaceChannelAddAnswer = await addHere({
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
      expect(world.mattermostAdds()).toEqual([
        { channel: MM_INC42, user: MM_BOB },
        { channel: MM_INC42, user: MM_CAROL },
      ]);
      expect(world.feedEntries.length).toBe(1);
      expect(world.feedEntries[0]!.markdown).toBe(
        `👥 Added **[Bob Jones](https://oneuptime.test/users/${BOB.toString()})** and **[Carol Lee](https://oneuptime.test/users/${CAROL.toString()})** to the Mattermost channel [inc-42](${CHANNEL_URL}).`,
      );
      expect(world.feedEntries[0]!.userId).toBe(ALICE.toString());
    });

    test("the viewer and others at once: joined, and added the others", async () => {
      await addHere({ userIds: [ALICE, BOB] });

      expect(world.feedEntries[0]!.markdown).toBe(
        `👥 Joined the Mattermost channel [inc-42](${CHANNEL_URL}) and added **[Bob Jones](https://oneuptime.test/users/${BOB.toString()})** to it.`,
      );
    });

    test("a team: everybody in the project's team who accepted, each once, beside the people named", async () => {
      const answer: WorkspaceChannelAddAnswer = await addHere({
        userIds: [BOB],
        teamIds: [PLATFORM_TEAM_ID],
      });

      expect(
        answer.results.map((result: { userId: string }) => {
          return result.userId;
        }),
      ).toEqual([BOB.toString(), ERIN.toString()]);
      expect(world.mattermostAdds()).toEqual([
        { channel: MM_INC42, user: MM_BOB },
        { channel: MM_INC42, user: MM_ERIN },
      ]);
    });

    test("somebody who is not a member of the project is not added, nor even looked up", async () => {
      const answer: WorkspaceChannelAddAnswer = await addHere({
        userIds: [OSCAR],
      });

      expect(answer.results[0]!.outcome).toBe(
        WorkspaceChannelAddOutcome.NotProjectMember,
      );
      expect(world.mattermostAdds()).toEqual([]);
      expect(
        world.mattermostCalls().filter((call: string) => {
          return call.includes("/users/email/");
        }),
      ).toEqual([]);
    });

    test("a name full of Markdown reads as typed in the feed: no bold, no link, no mention", async () => {
      await addHere({ userIds: [MALLORY] });

      const markdown: string = world.feedEntries[0]!.markdown;

      expect(markdown).not.toContain("[click](https://evil.test)");
      expect(markdown).toContain("\\*\\*Mal\\*\\*");
    });
  });

  describe("who Mattermost takes", () => {
    /*
     * Slack keeps most guests out of what the app asks. Mattermost keeps a
     * guest from joining by itself, and lets a channel's members add one: that
     * is how a guest gets in.
     */
    test("a guest in the team is added, as anybody else", async () => {
      const answer: WorkspaceChannelAddAnswer = await addHere({
        userIds: [GINA],
      });

      expect(answer.results[0]!.outcome).toBe(WorkspaceChannelAddOutcome.Added);
      expect(world.mattermostChannels[MM_INC42]!.members).toContain(MM_GINA);
    });

    test("a guest found by email is added too", async () => {
      world.mattermostAccounts.find((account: { id: string }) => {
        return account.id === MM_CAROL;
      })!.isGuest = true;

      expect((await addHere({ userIds: [CAROL] })).results[0]!.outcome).toBe(
        WorkspaceChannelAddOutcome.Added,
      );
    });

    /*
     * Mattermost's 404 for somebody outside the team is not a channel that is
     * gone: the others are still tried, and the channel is not called deleted.
     */
    test("somebody outside the team is said so, and the others are still added", async () => {
      world.mattermostAccounts.find((account: { id: string }) => {
        return account.id === MM_BOB;
      })!.isOutsideTeam = true;

      const answer: WorkspaceChannelAddAnswer = await addHere({
        userIds: [BOB, CAROL],
      });

      expect(answer.channelState).toBeUndefined();
      expect(
        answer.results.map(
          (result: { outcome: WorkspaceChannelAddOutcome }) => {
            return result.outcome;
          },
        ),
      ).toEqual([
        WorkspaceChannelAddOutcome.NotInTeam,
        WorkspaceChannelAddOutcome.Added,
      ]);
    });

    test.each([
      [
        "removed from the team",
        400,
        "api.channel.add_user.to.channel.failed.deleted.app_error",
      ],
      [
        "outside the team, on an older server",
        404,
        "store.sql_team.get_member.missing.app_error",
      ],
    ] as Array<[string, number, string]>)(
      "somebody %s is outside it too",
      async (_: string, status: number, errorId: string) => {
        world.mattermostInviteRefusals[MM_BOB] = {
          status: status,
          errorId: errorId,
        };

        const answer: WorkspaceChannelAddAnswer = await addHere({
          userIds: [BOB],
        });

        expect(answer.channelState).toBeUndefined();
        expect(answer.results[0]!.outcome).toBe(
          WorkspaceChannelAddOutcome.NotInTeam,
        );
      },
    );

    test.each([
      ["deactivated", 403, "app.channel.add_member.deleted_user.app_error"],
      ["gone from the server", 404, "app.user.missing_account.const"],
      [
        "gone from an older server",
        404,
        "store.sql_user.missing_account.const",
      ],
    ] as Array<[string, number, string]>)(
      "a connected account %s is nobody OneUptime can find",
      async (_: string, status: number, errorId: string) => {
        world.mattermostInviteRefusals[MM_BOB] = {
          status: status,
          errorId: errorId,
        };

        const answer: WorkspaceChannelAddAnswer = await addHere({
          userIds: [BOB],
        });

        expect(answer.channelState).toBeUndefined();
        expect(answer.results[0]!.outcome).toBe(
          WorkspaceChannelAddOutcome.NotFound,
        );
      },
    );

    test("an account found by email that was deactivated is not asked for at all", async () => {
      world.mattermostAccounts.find((account: { id: string }) => {
        return account.id === MM_CAROL;
      })!.isDeactivated = true;

      expect((await addHere({ userIds: [CAROL] })).results[0]!.outcome).toBe(
        WorkspaceChannelAddOutcome.NotFound,
      );
      expect(world.mattermostAdds()).toEqual([]);
    });

    test("an email address that belongs to a bot account is nobody to add", async () => {
      world.mattermostAccounts.find((account: { id: string }) => {
        return account.id === MM_CAROL;
      })!.isBot = true;

      expect((await addHere({ userIds: [CAROL] })).results[0]!.outcome).toBe(
        WorkspaceChannelAddOutcome.NotFound,
      );
    });

    test.each([
      [
        "a channel kept to its groups",
        400,
        "api.channel.add_members.user_denied",
      ],
      [
        "an access policy the person does not meet",
        403,
        "api.channel.add_user.to.channel.rejected",
      ],
      [
        "a scheme that keeps the bot from adding anybody",
        403,
        "api.context.permissions.app_error",
      ],
    ] as Array<[string, number, string]>)(
      "refused by %s: Mattermost's own reason, and the others are still tried",
      async (_: string, status: number, errorId: string) => {
        world.mattermostInviteRefusals[MM_BOB] = {
          status: status,
          errorId: errorId,
        };

        const answer: WorkspaceChannelAddAnswer = await addHere({
          userIds: [BOB, CAROL],
        });

        expect(
          answer.results.map(
            (result: { outcome: WorkspaceChannelAddOutcome }) => {
              return result.outcome;
            },
          ),
        ).toEqual([
          WorkspaceChannelAddOutcome.Refused,
          WorkspaceChannelAddOutcome.Added,
        ]);
      },
    );

    test.each([429, 500, 503] as Array<number>)(
      "Mattermost answering %i for one person: try again, and the others are still tried",
      async (status: number) => {
        world.mattermostInviteRefusals[MM_BOB] = {
          status: status,
          errorId: "api.server.busy",
        };

        const answer: WorkspaceChannelAddAnswer = await addHere({
          userIds: [BOB, CAROL],
        });

        expect(
          answer.results.map(
            (result: { outcome: WorkspaceChannelAddOutcome }) => {
              return result.outcome;
            },
          ),
        ).toEqual([
          WorkspaceChannelAddOutcome.TryAgain,
          WorkspaceChannelAddOutcome.Added,
        ]);
      },
    );
  });

  describe("a channel that can take nobody", () => {
    /*
     * Slack refuses to invite anybody into an archived channel. Mattermost
     * takes them without a word, and the card would say they joined a channel
     * nobody can talk in. So OneUptime reads it first, and asks for nothing.
     */
    test("archived: said so, and nobody is added - though Mattermost would have taken them", async () => {
      world.mattermostChannels[MM_INC42]!.isArchived = true;

      const answer: WorkspaceChannelAddAnswer = await addHere({
        userIds: [ALICE],
      });

      expect(answer).toEqual({
        channelState: WorkspaceChannelState.Archived,
        results: [],
      });
      expect(world.mattermostAdds()).toEqual([]);
      expect(world.mattermostChannels[MM_INC42]!.members).toEqual([
        MATTERMOST_BOT_ID,
      ]);
      expect(world.feedEntries).toEqual([]);
    });

    test("a private channel the bot was removed from: out of OneUptime's sight, and only somebody in it can bring it back", async () => {
      world.mattermostChannels[MM_INC42]!.members = [MM_BOB];

      const answer: WorkspaceChannelAddAnswer = await addHere({
        userIds: [ALICE],
      });

      expect(answer).toEqual({
        channelState: WorkspaceChannelState.Unreachable,
        results: [],
      });
      expect(world.mattermostCalls()).toEqual([
        `GET /api/v4/channels/${MM_INC42}`,
      ]);
    });

    test("a public channel the bot was removed from: it joins first, once, then adds everybody", async () => {
      world.recordChannels[WorkspaceChannelRecordType.Alert] = [
        mattermostChannel(MM_ALT7, "alt-7"),
      ];
      world.mattermostChannels[MM_ALT7]!.members = [MM_BOB];

      const answer: WorkspaceChannelAddAnswer = await addHere({
        recordType: WorkspaceChannelRecordType.Alert,
        channelId: MM_ALT7,
        userIds: [ALICE, BOB, CAROL],
      });

      expect(
        answer.results.map(
          (result: { outcome: WorkspaceChannelAddOutcome }) => {
            return result.outcome;
          },
        ),
      ).toEqual([
        WorkspaceChannelAddOutcome.Added,
        // He was in it all along, which the read after the join tells.
        WorkspaceChannelAddOutcome.AlreadyIn,
        WorkspaceChannelAddOutcome.Added,
      ]);
      expect(world.mattermostAdds()).toEqual([
        { channel: MM_ALT7, user: MATTERMOST_BOT_ID },
        { channel: MM_ALT7, user: MM_ALICE },
        { channel: MM_ALT7, user: MM_CAROL },
      ]);
    });

    test("a public channel the bot may not join: out of sight, and nobody is tried", async () => {
      world.recordChannels[WorkspaceChannelRecordType.Alert] = [
        mattermostChannel(MM_ALT7, "alt-7"),
      ];
      world.mattermostChannels[MM_ALT7]!.members = [MM_BOB];
      world.mattermostInviteRefusals[MATTERMOST_BOT_ID] = {
        status: 403,
        errorId: "api.context.permissions.app_error",
      };

      expect(
        await addHere({
          recordType: WorkspaceChannelRecordType.Alert,
          channelId: MM_ALT7,
          userIds: [ALICE],
        }),
      ).toEqual({
        channelState: WorkspaceChannelState.Unreachable,
        results: [],
      });
      expect(world.mattermostAdds()).toEqual([
        { channel: MM_ALT7, user: MATTERMOST_BOT_ID },
      ]);
    });

    test("deleted between reading it and adding: the people added before are kept, and the channel's state is said", async () => {
      world.mattermostInviteRefusals[MM_CAROL] = {
        status: 404,
        errorId: "app.channel.get.existing.app_error",
      };

      const answer: WorkspaceChannelAddAnswer = await addHere({
        userIds: [BOB, CAROL, ERIN],
      });

      expect(answer.channelState).toBe(WorkspaceChannelState.Unreachable);
      expect(answer.results).toEqual([
        {
          userId: BOB.toString(),
          name: "Bob Jones",
          outcome: WorkspaceChannelAddOutcome.Added,
        },
      ]);
      // Erin is not tried once the channel refused.
      expect(world.mattermostAdds().length).toBe(2);
      expect(world.feedEntries.length).toBe(1);
    });

    test("a token revoked halfway: the people added before are kept and written down", async () => {
      world.mattermostInviteRefusals[MM_CAROL] = {
        status: 401,
        errorId: "api.context.session_expired.app_error",
      };

      const answer: WorkspaceChannelAddAnswer = await addHere({
        userIds: [BOB, CAROL],
      });

      expect(answer.channelState).toBe(WorkspaceChannelState.NotConnected);
      expect(answer.results).toEqual([
        {
          userId: BOB.toString(),
          name: "Bob Jones",
          outcome: WorkspaceChannelAddOutcome.Added,
        },
      ]);
      expect(world.feedEntries.length).toBe(1);
    });

    test("a lookup by email the server does not answer: try again, for that person", async () => {
      world.mattermostRefuses["GET /api/v4/users/email/Carol%40Acme.test"] = {
        status: 500,
        errorId: "app.user.get_by_email.app_error",
      };

      const answer: WorkspaceChannelAddAnswer = await addHere({
        userIds: [CAROL, BOB],
      });

      expect(
        answer.results.map(
          (result: { outcome: WorkspaceChannelAddOutcome }) => {
            return result.outcome;
          },
        ),
      ).toEqual([
        WorkspaceChannelAddOutcome.TryAgain,
        WorkspaceChannelAddOutcome.Added,
      ]);
    });

    test("a token that stops working during a lookup by email: not connected", async () => {
      world.mattermostRefuses["GET /api/v4/users/email/Carol%40Acme.test"] = {
        status: 401,
        errorId: "api.context.session_expired.app_error",
      };

      expect((await addHere({ userIds: [CAROL] })).channelState).toBe(
        WorkspaceChannelState.NotConnected,
      );
    });

    test("Mattermost disconnected from the project", async () => {
      world.mattermostConnected = false;

      expect(await addHere({ userIds: [ALICE] })).toEqual({
        channelState: WorkspaceChannelState.NotConnected,
        results: [],
      });
      expect(world.mattermostRequests).toEqual([]);
    });

    test("a connection OneUptime cannot read", async () => {
      world.mattermostAuthTokenBroken = true;

      expect((await addHere({ userIds: [ALICE] })).channelState).toBe(
        WorkspaceChannelState.NotConnected,
      );
      expect(world.mattermostRequests).toEqual([]);
    });

    test("a revoked token", async () => {
      world.mattermostTokenRevoked = true;

      expect((await addHere({ userIds: [ALICE] })).channelState).toBe(
        WorkspaceChannelState.NotConnected,
      );
    });

    test("a server that does not answer", async () => {
      world.mattermostDown = true;

      expect((await addHere({ userIds: [ALICE] })).channelState).toBe(
        WorkspaceChannelState.Unavailable,
      );
    });

    test("an id of the wrong shape: nothing is asked with it", async () => {
      world.recordChannels[WorkspaceChannelRecordType.Incident] = [
        mattermostChannel("../../users/me", "inc-42"),
      ];

      expect(
        await addHere({ channelId: "../../users/me", userIds: [ALICE] }),
      ).toEqual({
        channelState: WorkspaceChannelState.Unreachable,
        results: [],
      });
      expect(world.mattermostRequests).toEqual([]);
    });
  });

  describe("who may add people, and to which channel", () => {
    test("not somebody who may only read the record: refused before anything is asked of Mattermost", async () => {
      world.canEdit = false;

      await expect(addHere({ userIds: [ALICE] })).rejects.toBeInstanceOf(
        NotAuthorizedException,
      );
      expect(world.mattermostRequests).toEqual([]);
    });

    test("only into the record's own channel: any other channel id is not found, and nobody is added anywhere", async () => {
      await expect(
        addHere({ userIds: [ALICE], channelId: MM_ALT7 }),
      ).rejects.toThrow("This channel is not one of this incident's channels.");
      expect(world.mattermostRequests).toEqual([]);
    });
  });

  test.each([
    [WorkspaceChannelRecordType.Alert, MM_ALT7, "alt-7", "alertId"],
    [
      WorkspaceChannelRecordType.IncidentEpisode,
      MM_IE3,
      "ie-3",
      "incidentEpisodeId",
    ],
    [WorkspaceChannelRecordType.AlertEpisode, MM_AE5, "ae-5", "alertEpisodeId"],
    [
      WorkspaceChannelRecordType.ScheduledMaintenance,
      MM_SM5,
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
      world.recordChannels[recordType] = [
        mattermostChannel(channelId, channelName),
      ];

      await addHere({ recordType, channelId, userIds: [BOB] });

      expect(world.feedEntries).toEqual([
        {
          recordType: recordType,
          recordId: RECORD_IDS[recordType].toString(),
          eventType: "ChannelMemberAdded",
          markdown: `👥 Added **[Bob Jones](https://oneuptime.test/users/${BOB.toString()})** to the Mattermost channel [${channelName}](${MATTERMOST_SERVER}/acme/channels/${channelName}).`,
          userId: ALICE.toString(),
        } as FeedEntry,
      ]);

      const row: WorkspaceNotificationLog = inviteRows()[0]!;

      expect(
        (row as unknown as Record<string, ObjectID | undefined>)[
          logColumn
        ]?.toString(),
      ).toBe(RECORD_IDS[recordType].toString());
      expect(row.workspaceType).toBe(WorkspaceType.Mattermost);
    },
  );
});

describe("the feed sentence", () => {
  test("a channel without a link is named, not linked", () => {
    expect(
      WorkspaceChannelMembers.getFeedMarkdown({
        workspaceType: WorkspaceType.Slack,
        channelName: "inc-42",
        channelUrl: null,
        actorJoined: true,
        others: [],
      }).toString(),
    ).toBe("👥 Joined the Slack channel #inc-42.");
  });

  test("a Mattermost channel is named as Mattermost writes it, without a #", () => {
    expect(
      WorkspaceChannelMembers.getFeedMarkdown({
        workspaceType: WorkspaceType.Mattermost,
        channelName: "inc-42",
        channelUrl: null,
        actorJoined: true,
        others: [],
      }).toString(),
    ).toBe("👥 Joined the Mattermost channel inc-42.");
    expect(
      WorkspaceChannelMembers.getFeedMarkdown({
        workspaceType: WorkspaceType.Mattermost,
        channelName: " ",
        channelUrl: null,
        actorJoined: true,
        others: [],
      }).toString(),
    ).toBe("👥 Joined the Mattermost channel channel.");
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
