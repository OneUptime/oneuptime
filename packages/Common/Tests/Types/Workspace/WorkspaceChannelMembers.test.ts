import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { WorkspaceChannelRecordType } from "../../../Types/Workspace/WorkspaceChannelLink";
import WorkspaceChannelMembersUtil, {
  WORKSPACE_CHANNEL_ADD_MAX_PEOPLE,
  WORKSPACE_CHANNEL_ADD_MAX_TEAMS,
  WORKSPACE_CHANNEL_ADD_MAX_USERS,
  WORKSPACE_CHANNEL_MEMBERS_ROUTE,
  WorkspaceChannelAddAnswer,
  WorkspaceChannelAddOutcome,
  WorkspaceChannelState,
  WorkspaceChannelViewerStatus,
  WorkspaceRecordChannels,
} from "../../../Types/Workspace/WorkspaceChannelMembers";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";

/*
 * What a record's page and the server say to each other about the record's
 * channels and the people in them: the routes, and the answers written and
 * read back. The page keeps only well-formed values, so nothing an answer
 * holds can draw a link to somewhere else or a person without a name.
 */

const RECORD_ID: ObjectID = new ObjectID(
  "c5000000-0000-4000-8000-000000000001",
);
const USER_ID: string = "c5000000-0000-4000-8000-000000000002";

const FULL_ANSWER: WorkspaceRecordChannels = {
  canAddPeople: true,
  channels: [
    {
      channelId: "C0INC42",
      workspaceType: WorkspaceType.Slack,
      name: "inc-42",
      url: "https://slack.com/app_redirect?channel=C0INC42&team=T0ACME",
      isPrivate: true,
      state: WorkspaceChannelState.Members,
      people: [
        {
          key: "U0ALICE",
          name: "Alice Smith",
          userId: USER_ID,
          hasProfilePicture: true,
          isViewer: true,
        },
        { key: "U0SAM", name: "Sam from Support" },
      ],
      peopleCount: 7,
      viewer: WorkspaceChannelViewerStatus.In,
    },
    {
      channelId: "19:acme@thread.tacv2",
      workspaceType: WorkspaceType.MicrosoftTeams,
      name: "inc-42",
      url: "https://teams.microsoft.com/l/channel/19%3Aacme%40thread.tacv2/inc-42?groupId=c5000000-0000-4000-8000-000000000003",
      isPrivate: null,
      state: WorkspaceChannelState.ManagedInTeams,
      people: [],
      peopleCount: 0,
      viewer: WorkspaceChannelViewerStatus.NotFound,
      teamName: "Ops",
    },
  ],
};

describe("the routes", () => {
  test("read and add live beside each other, under the record", () => {
    expect(WORKSPACE_CHANNEL_MEMBERS_ROUTE).toBe("/workspace-channel-members");
    expect(
      WorkspaceChannelMembersUtil.getRoute({
        recordType: WorkspaceChannelRecordType.IncidentEpisode,
        recordId: RECORD_ID,
      }),
    ).toBe(`/workspace-channel-members/incident-episode/${RECORD_ID}`);
    expect(
      WorkspaceChannelMembersUtil.getAddRoute({
        recordType: WorkspaceChannelRecordType.Incident,
        recordId: RECORD_ID,
      }),
    ).toBe(`/workspace-channel-members/incident/${RECORD_ID}/add`);
  });

  test("one click adds a person or a team, never a directory", () => {
    expect(WORKSPACE_CHANNEL_ADD_MAX_USERS).toBe(50);
    expect(WORKSPACE_CHANNEL_ADD_MAX_TEAMS).toBe(10);
    expect(WORKSPACE_CHANNEL_ADD_MAX_PEOPLE).toBe(100);
  });
});

describe("the channels, as written and read back", () => {
  test("round-trip unchanged", () => {
    expect(
      WorkspaceChannelMembersUtil.channelsFromJSON(
        JSON.parse(
          JSON.stringify(
            WorkspaceChannelMembersUtil.channelsToJSON(FULL_ANSWER),
          ),
        ),
      ),
    ).toEqual(FULL_ANSWER);
  });

  test("an answer that is not one reads as no channels, and no permission", () => {
    for (const value of [null, undefined, "x", 7, [], { channels: "x" }]) {
      expect(WorkspaceChannelMembersUtil.channelsFromJSON(value)).toEqual({
        channels: [],
        canAddPeople: false,
      });
    }
  });

  test("permission is only a real true", () => {
    expect(
      WorkspaceChannelMembersUtil.channelsFromJSON({
        canAddPeople: "true",
        channels: [],
      }).canAddPeople,
    ).toBe(false);
  });

  test("a channel of an unknown product or state, or without an id, is left out", () => {
    const base: JSONObject = WorkspaceChannelMembersUtil.channelsToJSON(
      FULL_ANSWER,
    )["channels"] as unknown as JSONObject;
    const slack: JSONObject = (base as unknown as Array<JSONObject>)[0]!;

    const read: WorkspaceRecordChannels =
      WorkspaceChannelMembersUtil.channelsFromJSON({
        channels: [
          { ...slack, workspaceType: "Discord" },
          { ...slack, state: "exploded" },
          { ...slack, channelId: "" },
          { ...slack, channelId: 7 },
          "C0INC42",
          null,
          slack,
        ],
      });

    expect(read.channels.length).toBe(1);
  });

  test("a link off Slack's or Microsoft's own host is dropped, the channel kept", () => {
    const read: WorkspaceRecordChannels =
      WorkspaceChannelMembersUtil.channelsFromJSON({
        channels: [
          {
            channelId: "C1",
            workspaceType: WorkspaceType.Slack,
            name: "inc-1",
            url: "https://evil.test/app_redirect?channel=C1",
            state: WorkspaceChannelState.Members,
            people: [],
            peopleCount: 0,
            viewer: WorkspaceChannelViewerStatus.In,
          },
          {
            channelId: "C2",
            workspaceType: WorkspaceType.Slack,
            name: "inc-2",
            // A Teams link on a Slack channel.
            url: "https://teams.microsoft.com/l/channel/x",
            state: WorkspaceChannelState.Members,
            people: [],
            peopleCount: 0,
            viewer: WorkspaceChannelViewerStatus.In,
          },
          {
            channelId: "C3",
            workspaceType: WorkspaceType.Slack,
            name: "inc-3",
            url: "javascript:alert(1)",
            state: WorkspaceChannelState.Members,
            people: [],
            peopleCount: 0,
            viewer: WorkspaceChannelViewerStatus.In,
          },
        ],
      });

    expect(
      read.channels.map((channel: { channelId: string; url?: string }) => {
        return [channel.channelId, channel.url];
      }),
    ).toEqual([
      ["C1", undefined],
      ["C2", undefined],
      ["C3", undefined],
    ]);
  });

  test("a person needs a key and a name; an id that is not one is dropped, and with it the picture", () => {
    const read: WorkspaceRecordChannels =
      WorkspaceChannelMembersUtil.channelsFromJSON({
        channels: [
          {
            channelId: "C1",
            workspaceType: WorkspaceType.Slack,
            name: "inc-1",
            state: WorkspaceChannelState.Members,
            people: [
              { key: "U1", name: "  " },
              { key: "", name: "Nobody" },
              {
                key: "U2",
                name: "Bob",
                userId: "../../users",
                hasProfilePicture: true,
              },
              { key: "U3", name: "Carol", isViewer: "yes" },
              "U4",
            ],
            peopleCount: 3,
            viewer: WorkspaceChannelViewerStatus.NotIn,
          },
        ],
      });

    expect(read.channels[0]!.people).toEqual([
      { key: "U2", name: "Bob" },
      { key: "U3", name: "Carol" },
    ]);
  });

  test("the count of people is never fewer than the people listed, and whole", () => {
    const read: (peopleCount: unknown) => number = (
      peopleCount: unknown,
    ): number => {
      return WorkspaceChannelMembersUtil.channelsFromJSON({
        channels: [
          {
            channelId: "C1",
            workspaceType: WorkspaceType.Slack,
            name: "inc-1",
            state: WorkspaceChannelState.Members,
            people: [
              { key: "U1", name: "A" },
              { key: "U2", name: "B" },
            ],
            peopleCount: peopleCount,
            viewer: WorkspaceChannelViewerStatus.NotIn,
          },
        ],
      }).channels[0]!.peopleCount;
    };

    expect(read(9)).toBe(9);
    expect(read(9.7)).toBe(9);
    expect(read(1)).toBe(2);
    expect(read("9")).toBe(2);
    expect(read(Number.POSITIVE_INFINITY)).toBe(2);
  });

  test("an unknown viewer status reads as not found; privacy is true, false or unknown", () => {
    const channel: JSONObject = {
      channelId: "C1",
      workspaceType: WorkspaceType.Slack,
      name: "inc-1",
      state: WorkspaceChannelState.Members,
      people: [],
      peopleCount: 0,
      viewer: "maybe",
      isPrivate: "yes",
    };

    const read: WorkspaceRecordChannels =
      WorkspaceChannelMembersUtil.channelsFromJSON({ channels: [channel] });

    expect(read.channels[0]!.viewer).toBe(
      WorkspaceChannelViewerStatus.NotFound,
    );
    expect(read.channels[0]!.isPrivate).toBeNull();
  });
});

describe("the answer to adding people, as written and read back", () => {
  test("round-trips, with the channel's state when it took nobody", () => {
    const answer: WorkspaceChannelAddAnswer = {
      channelState: WorkspaceChannelState.Archived,
      results: [
        {
          userId: USER_ID,
          name: "Alice Smith",
          outcome: WorkspaceChannelAddOutcome.Added,
        },
      ],
    };

    expect(
      WorkspaceChannelMembersUtil.addAnswerFromJSON(
        JSON.parse(
          JSON.stringify(WorkspaceChannelMembersUtil.addAnswerToJSON(answer)),
        ),
      ),
    ).toEqual(answer);
  });

  test("no channel state when everybody was tried", () => {
    const json: JSONObject = WorkspaceChannelMembersUtil.addAnswerToJSON({
      results: [],
    });

    expect(json).toEqual({ results: [] });
    expect(WorkspaceChannelMembersUtil.addAnswerFromJSON(json)).toEqual({
      results: [],
    });
  });

  test("a result with an unknown outcome or no person, and an unknown state, are dropped", () => {
    expect(
      WorkspaceChannelMembersUtil.addAnswerFromJSON({
        channelState: "melted",
        results: [
          { userId: USER_ID, name: "A", outcome: "teleported" },
          { userId: "", name: "B", outcome: WorkspaceChannelAddOutcome.Added },
          null,
          {
            userId: USER_ID,
            name: "C",
            outcome: WorkspaceChannelAddOutcome.NotFound,
          },
        ],
      }),
    ).toEqual({
      results: [
        {
          userId: USER_ID,
          name: "C",
          outcome: WorkspaceChannelAddOutcome.NotFound,
        },
      ],
    });
  });
});
