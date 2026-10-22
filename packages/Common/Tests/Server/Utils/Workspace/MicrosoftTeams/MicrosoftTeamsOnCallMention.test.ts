import User from "../../../../../Models/DatabaseModels/User";
import WorkspaceProjectAuthToken from "../../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import UserService from "../../../../../Server/Services/UserService";
import WorkspaceNotificationRuleService from "../../../../../Server/Services/WorkspaceNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../../../Server/Services/WorkspaceUserAuthTokenService";
import ChannelMembersNotAddedNotice from "../../../../../Server/Utils/Workspace/LiveMessages/ChannelMembersNotAddedNotice";
import MicrosoftTeamsUtil, {
  MicrosoftTeamsRosterMember,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import MicrosoftTeamsOnCallMention, {
  MICROSOFT_TEAMS_ON_CALL_MAX_NAMED,
  MicrosoftTeamsOnCallMessage,
  MicrosoftTeamsOnCallPerson,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsOnCallMention";
import { WorkspaceThread } from "../../../../../Server/Utils/Workspace/WorkspaceBase";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

jest.mock("../../../../../Server/Utils/Logger");

/*
 * WHOEVER IS ON CALL, @MENTIONED IN A NEW MICROSOFT TEAMS CHANNEL.
 *
 * A rule that creates a channel can name on-call schedules. Slack adds the
 * people on call in them to the channel; Microsoft Teams adds nobody to a
 * channel, so the channel gets one message that @mentions them, after the
 * record's own first message, and Teams notifies each of them. Somebody not
 * in the channel's team cannot open it, so they are named, not mentioned.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const TEAM_ID: string = "19c1f0d4-graph-team";

const JANE: ObjectID = ObjectID.generate();
const RAJ: ObjectID = ObjectID.generate();
const ALEX: ObjectID = ObjectID.generate();

const JANE_AAD: string = "aad-jane";
const RAJ_AAD: string = "aad-raj";

function texts(message: MicrosoftTeamsOnCallMessage): Array<string> {
  return (message.card["body"] as Array<JSONObject>).map(
    (block: JSONObject): string => {
      return block["text"] as string;
    },
  );
}

function entities(message: MicrosoftTeamsOnCallMessage): Array<JSONObject> {
  return (
    ((message.card["msteams"] as JSONObject | undefined)?.[
      "entities"
    ] as Array<JSONObject>) || []
  );
}

function person(
  name: string,
  scheduleNames: Array<string>,
  aadObjectId: string | null,
): MicrosoftTeamsOnCallPerson {
  return { name: name, scheduleNames: scheduleNames, aadObjectId: aadObjectId };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("MicrosoftTeamsOnCallMention.buildMessage", () => {
  test("each person in the team is @mentioned, with the schedules they are on call in, and Teams is told who each mention is", () => {
    const message: MicrosoftTeamsOnCallMessage =
      MicrosoftTeamsOnCallMention.buildMessage({
        people: [
          person("Jane Doe", ["Payments Primary"], JANE_AAD),
          person("Raj Patel", ["Payments Secondary"], RAJ_AAD),
        ],
      })!;

    expect(texts(message)).toEqual([
      "📟 On call now: <at>Jane Doe</at> (Payments Primary) and <at>Raj Patel</at> (Payments Secondary).",
    ]);

    expect(entities(message)).toEqual([
      {
        type: "mention",
        text: "<at>Jane Doe</at>",
        mentioned: { id: JANE_AAD, name: "Jane Doe" },
      },
      {
        type: "mention",
        text: "<at>Raj Patel</at>",
        mentioned: { id: RAJ_AAD, name: "Raj Patel" },
      },
    ]);

    expect(message.summary).toBe("On call now: Jane Doe, Raj Patel");
  });

  test("every mention's text is in the card exactly as its entity says, or Teams shows no mention", () => {
    const message: MicrosoftTeamsOnCallMessage =
      MicrosoftTeamsOnCallMention.buildMessage({
        people: [
          person("Ann-Marie O'Neil (SRE)", ["Primary"], "aad-1"),
          person("José Müller", [], "aad-2"),
          person("李 雷", ["Database"], "aad-3"),
        ],
      })!;

    const card: string = texts(message).join("\n");

    for (const entity of entities(message)) {
      expect(card).toContain(entity["text"] as string);
    }

    expect(entities(message)).toHaveLength(3);
  });

  test("a name that would be Markdown or a tag is mentioned without those characters, and its schedule is text", () => {
    const message: MicrosoftTeamsOnCallMessage =
      MicrosoftTeamsOnCallMention.buildMessage({
        people: [
          person(
            "**Eve** <script>[x](https://evil.example)",
            ["[Primary](https://evil.example) <b>"],
            "aad-eve",
          ),
        ],
      })!;

    const entity: JSONObject = entities(message)[0]!;
    const mentionText: string = entity["text"] as string;

    // The name keeps no character the card's Markdown or the <at> tag reads.
    expect(mentionText.slice("<at>".length, -"</at>".length)).not.toMatch(
      /[<>&*_`~[\]\\|#]/,
    );
    expect(texts(message)[0]).toContain(mentionText);

    // The schedule's name is text: its link and its tag are escaped.
    expect(texts(message)[0]).toContain(
      "\\[Primary\\](https://evil.example) \\<b>",
    );
    expect(texts(message)[0]).not.toMatch(/(^|[^\\])<b>/);
  });

  test("somebody not in the team is named, not mentioned, and the message says why", () => {
    const message: MicrosoftTeamsOnCallMessage =
      MicrosoftTeamsOnCallMention.buildMessage({
        people: [
          person("Jane Doe", ["Payments Primary"], JANE_AAD),
          person("Alex Kim", ["Database"], null),
        ],
      })!;

    expect(texts(message)).toEqual([
      "📟 On call now: <at>Jane Doe</at> (Payments Primary).",
      "**Alex Kim** (Database) is on call too, but is not in this team, so Microsoft Teams cannot show them this channel.",
    ]);
    expect(entities(message)).toHaveLength(1);
  });

  test("nobody in the team: no mention, and the people on call are still named", () => {
    const message: MicrosoftTeamsOnCallMessage =
      MicrosoftTeamsOnCallMention.buildMessage({
        people: [
          person("Alex Kim", ["Database"], null),
          person("Sam Lee", ["Payments Primary"], null),
        ],
      })!;

    expect(texts(message)).toEqual([
      "**Alex Kim** (Database) and **Sam Lee** (Payments Primary) are on call, but are not in this team, so Microsoft Teams cannot show them this channel.",
    ]);
    expect(message.card["msteams"]).toBeUndefined();
  });

  test("the log's copy names people in bold, without <at> tags", () => {
    const message: MicrosoftTeamsOnCallMessage =
      MicrosoftTeamsOnCallMention.buildMessage({
        people: [person("Jane Doe", ["Payments Primary"], JANE_AAD)],
      })!;

    expect(message.markdown).toBe(
      "📟 On call now: **Jane Doe** (Payments Primary).",
    );
  });

  test("a person on call in many schedules names a few of them, and how many more", () => {
    const message: MicrosoftTeamsOnCallMessage =
      MicrosoftTeamsOnCallMention.buildMessage({
        people: [
          person("Jane Doe", ["A", "B", "C", "D", "E", "F", "G"], JANE_AAD),
        ],
      })!;

    expect(texts(message)[0]).toBe(
      "📟 On call now: <at>Jane Doe</at> (A, B, C, D, E and 2 more).",
    );
  });

  test(`at most ${MICROSOFT_TEAMS_ON_CALL_MAX_NAMED} people are named, and the rest are counted, so the card stays a message Teams takes`, () => {
    const people: Array<MicrosoftTeamsOnCallPerson> = [];

    for (
      let index: number = 0;
      index < MICROSOFT_TEAMS_ON_CALL_MAX_NAMED + 3;
      index++
    ) {
      people.push(
        person(`Person ${index}`, [`Schedule ${index}`], `aad-${index}`),
      );
    }

    const message: MicrosoftTeamsOnCallMessage =
      MicrosoftTeamsOnCallMention.buildMessage({ people: people })!;

    expect(entities(message)).toHaveLength(MICROSOFT_TEAMS_ON_CALL_MAX_NAMED);
    expect(texts(message)[texts(message).length - 1]).toBe(
      "3 more people are on call.",
    );
    expect(JSON.stringify(message.card).length).toBeLessThan(20 * 1024);
  });

  test("nobody to name: no message", () => {
    expect(MicrosoftTeamsOnCallMention.buildMessage({ people: [] })).toBeNull();
  });
});

describe("MicrosoftTeamsOnCallMention.findInTeam", () => {
  const ROSTER: Array<MicrosoftTeamsRosterMember> = [
    {
      aadObjectId: JANE_AAD,
      email: "jane@example.com",
      userPrincipalName: "jane@corp.example.com",
      name: "Jane Doe (Payments)",
    },
    {
      aadObjectId: RAJ_AAD,
      email: "",
      userPrincipalName: "raj@example.com",
      name: "Raj Patel",
    },
  ];

  const PEOPLE: Array<{
    userId: ObjectID;
    email: string;
    connectedWorkspaceUserId: string | null;
    name: string;
  }> = [
    {
      userId: JANE,
      email: "someone-else@example.com",
      connectedWorkspaceUserId: JANE_AAD,
      name: "Jane",
    },
    {
      userId: RAJ,
      email: "RAJ@example.com",
      connectedWorkspaceUserId: null,
      name: "Raj",
    },
    {
      userId: ALEX,
      email: "alex@example.com",
      connectedWorkspaceUserId: null,
      name: "Alex Kim",
    },
  ];

  test("a person is found by the account they connected, else by their email address, and named as the team knows them", () => {
    expect(
      MicrosoftTeamsOnCallMention.findInTeam({
        onCall: [
          { userId: JANE, scheduleNames: ["Payments Primary"] },
          { userId: RAJ, scheduleNames: ["Payments Secondary"] },
          { userId: ALEX, scheduleNames: ["Database"] },
        ],
        people: PEOPLE,
        roster: ROSTER,
      }),
    ).toEqual([
      person("Jane Doe (Payments)", ["Payments Primary"], JANE_AAD),
      person("Raj Patel", ["Payments Secondary"], RAJ_AAD),
      person("Alex Kim", ["Database"], null),
    ]);
  });

  test("without the team's roster, only a connected account is mentioned", () => {
    expect(
      MicrosoftTeamsOnCallMention.findInTeam({
        onCall: [
          { userId: JANE, scheduleNames: ["Payments Primary"] },
          { userId: RAJ, scheduleNames: ["Payments Secondary"] },
        ],
        people: PEOPLE,
        roster: null,
      }),
    ).toEqual([
      person("Jane", ["Payments Primary"], JANE_AAD),
      person("Raj", ["Payments Secondary"], null),
    ]);
  });
});

describe("MicrosoftTeamsOnCallMention.mentionInChannels", () => {
  let send: SpyInstance<typeof MicrosoftTeamsUtil.sendAdaptiveCardToChannel>;
  let roster: SpyInstance<typeof MicrosoftTeamsUtil.getTeamRoster>;
  let logSends: SpyInstance<
    typeof WorkspaceNotificationRuleService.logSendResponses
  >;

  beforeEach(() => {
    const projectAuth: WorkspaceProjectAuthToken =
      new WorkspaceProjectAuthToken();
    projectAuth.authToken = "teams-token";

    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockResolvedValue(projectAuth);

    const jane: User = new User();
    jane.id = JANE;
    jane.name = "Jane" as never;
    jane.email = "jane@example.com" as never;

    jest.spyOn(UserService, "findBy").mockResolvedValue([jane]);

    const connection: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
    connection.userId = JANE;
    connection.workspaceUserId = JANE_AAD;

    jest
      .spyOn(WorkspaceUserAuthTokenService, "findBy")
      .mockResolvedValue([connection]);

    roster = jest.spyOn(MicrosoftTeamsUtil, "getTeamRoster").mockResolvedValue([
      {
        aadObjectId: JANE_AAD,
        email: "jane@example.com",
        userPrincipalName: "jane@example.com",
        name: "Jane Doe",
      },
    ]);

    send = jest
      .spyOn(MicrosoftTeamsUtil, "sendAdaptiveCardToChannel")
      .mockImplementation(
        async (data: {
          workspaceChannel: { id: string; name: string };
        }): Promise<WorkspaceThread> => {
          return {
            channel: {
              id: data.workspaceChannel.id,
              name: data.workspaceChannel.name,
              workspaceType: WorkspaceType.MicrosoftTeams,
            },
            threadId: "1700000000000",
          };
        },
      );

    logSends = jest
      .spyOn(WorkspaceNotificationRuleService, "logSendResponses")
      .mockResolvedValue(undefined);
  });

  test("the channel gets the card through the bot, and the post is logged against the record", async () => {
    const incidentId: ObjectID = ObjectID.generate();

    await MicrosoftTeamsOnCallMention.mentionInChannels({
      projectId: PROJECT_ID,
      channels: [
        { id: "19:channel@thread.tacv2", name: "inc-42", teamId: TEAM_ID },
      ],
      people: [{ userId: JANE, scheduleNames: ["Payments Primary"] }],
      notificationFor: { incidentId: incidentId },
    });

    expect(roster).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      teamId: TEAM_ID,
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toMatchObject({
      authToken: "teams-token",
      teamId: TEAM_ID,
      projectId: PROJECT_ID,
      workspaceChannel: { id: "19:channel@thread.tacv2", teamId: TEAM_ID },
      summary: "On call now: Jane Doe",
    });

    const card: JSONObject = send.mock.calls[0]![0].adaptiveCard;
    expect(JSON.stringify(card)).toContain("<at>Jane Doe</at>");

    expect(logSends).toHaveBeenCalledTimes(1);
    expect(logSends.mock.calls[0]![0]).toMatchObject({
      projectId: PROJECT_ID,
      notificationFor: { incidentId: incidentId },
      messageBlocksByWorkspaceTypes: [
        {
          workspaceType: WorkspaceType.MicrosoftTeams,
          messageBlocks: [
            {
              _type: "WorkspacePayloadMarkdown",
              text: "📟 On call now: **Jane Doe** (Payments Primary).",
            },
          ],
        },
      ],
    });
  });

  test("a team's roster is read once for all its channels", async () => {
    await MicrosoftTeamsOnCallMention.mentionInChannels({
      projectId: PROJECT_ID,
      channels: [
        { id: "19:one@thread.tacv2", name: "inc-42", teamId: TEAM_ID },
        { id: "19:two@thread.tacv2", name: "prod-inc-42", teamId: TEAM_ID },
      ],
      people: [{ userId: JANE, scheduleNames: ["Payments Primary"] }],
    });

    expect(roster).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(2);
  });

  test("a card Teams refuses is logged as the record's failed message, and nothing throws", async () => {
    send.mockRejectedValueOnce(new Error("Forbidden"));

    await expect(
      MicrosoftTeamsOnCallMention.mentionInChannels({
        projectId: PROJECT_ID,
        channels: [
          { id: "19:one@thread.tacv2", name: "inc-42", teamId: TEAM_ID },
        ],
        people: [{ userId: JANE, scheduleNames: ["Payments Primary"] }],
        notificationFor: { alertId: ObjectID.generate() },
      }),
    ).resolves.toBeUndefined();

    const responses: Array<JSONObject> = logSends.mock.calls[0]![0]
      .responses as unknown as Array<JSONObject>;

    expect(responses[0]!["threads"]).toEqual([]);
    expect(responses[0]!["errors"]).toHaveLength(1);
  });

  test("the team's roster cannot be read: the connected account is still mentioned", async () => {
    roster.mockRejectedValueOnce(new Error("Bot not in team"));

    await MicrosoftTeamsOnCallMention.mentionInChannels({
      projectId: PROJECT_ID,
      channels: [
        { id: "19:one@thread.tacv2", name: "inc-42", teamId: TEAM_ID },
      ],
      people: [{ userId: JANE, scheduleNames: ["Payments Primary"] }],
    });

    expect(JSON.stringify(send.mock.calls[0]![0].adaptiveCard)).toContain(
      JANE_AAD,
    );
  });

  test("Microsoft Teams not connected, or a channel without its team: nothing is sent", async () => {
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockResolvedValue(null);

    await MicrosoftTeamsOnCallMention.mentionInChannels({
      projectId: PROJECT_ID,
      channels: [
        { id: "19:one@thread.tacv2", name: "inc-42", teamId: TEAM_ID },
      ],
      people: [{ userId: JANE, scheduleNames: ["Payments Primary"] }],
    });

    jest.restoreAllMocks();

    await MicrosoftTeamsOnCallMention.mentionInChannels({
      projectId: PROJECT_ID,
      channels: [{ id: "19:one@thread.tacv2", name: "inc-42" }],
      people: [],
    });

    expect(send).not.toHaveBeenCalled();
  });
});

/*
 * The mention is posted where Slack's note of who could not be added is:
 * once the record's own first message is (ChannelMembersNotAddedNotice.noteAll).
 */
describe("ChannelMembersNotAddedNotice.noteAll", () => {
  test("a Microsoft Teams channel's people on call are mentioned in it; Slack's note is still Slack's", async () => {
    const mention: SpyInstance<
      typeof MicrosoftTeamsOnCallMention.mentionInChannels
    > = jest
      .spyOn(MicrosoftTeamsOnCallMention, "mentionInChannels")
      .mockResolvedValue(undefined);

    const note: SpyInstance<
      typeof ChannelMembersNotAddedNotice.noteMembersNotAdded
    > = jest
      .spyOn(ChannelMembersNotAddedNotice, "noteMembersNotAdded")
      .mockResolvedValue(undefined);

    const incidentId: ObjectID = ObjectID.generate();
    const people: Array<{ userId: ObjectID; scheduleNames: Array<string> }> = [
      { userId: JANE, scheduleNames: ["Payments Primary"] },
    ];

    await ChannelMembersNotAddedNotice.noteAll({
      projectId: PROJECT_ID,
      membersNotAdded: [
        {
          workspaceType: WorkspaceType.MicrosoftTeams,
          channels: [
            { id: "19:one@thread.tacv2", name: "inc-42", teamId: TEAM_ID },
          ],
          userIds: [],
          onCallToMention: people,
          notificationFor: { incidentId: incidentId },
        },
        {
          workspaceType: WorkspaceType.Slack,
          channels: [{ id: "C0INC42", name: "inc-42" }],
          userIds: [RAJ],
        },
      ],
    });

    expect(mention).toHaveBeenCalledTimes(1);
    expect(mention.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      channels: [
        { id: "19:one@thread.tacv2", name: "inc-42", teamId: TEAM_ID },
      ],
      people: people,
      notificationFor: { incidentId: incidentId },
    });

    expect(note).toHaveBeenCalledTimes(2);
  });

  test("a mention that fails does not stop the notes after it", async () => {
    jest
      .spyOn(MicrosoftTeamsOnCallMention, "mentionInChannels")
      .mockRejectedValue(new Error("Teams is down"));

    const note: SpyInstance<
      typeof ChannelMembersNotAddedNotice.noteMembersNotAdded
    > = jest
      .spyOn(ChannelMembersNotAddedNotice, "noteMembersNotAdded")
      .mockResolvedValue(undefined);

    await expect(
      ChannelMembersNotAddedNotice.noteAll({
        projectId: PROJECT_ID,
        membersNotAdded: [
          {
            workspaceType: WorkspaceType.MicrosoftTeams,
            channels: [{ id: "19:one@thread.tacv2", teamId: TEAM_ID }],
            userIds: [],
            onCallToMention: [{ userId: JANE, scheduleNames: [] }],
          },
          {
            workspaceType: WorkspaceType.Slack,
            channels: [{ id: "C0INC42", name: "inc-42" }],
            userIds: [RAJ],
          },
        ],
      }),
    ).resolves.toBeUndefined();

    expect(note).toHaveBeenCalledTimes(1);
    expect(note.mock.calls[0]![0].workspaceType).toBe(WorkspaceType.Slack);
  });
});
