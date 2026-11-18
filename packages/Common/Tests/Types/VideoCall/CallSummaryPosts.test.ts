import { JSONObject } from "../../../Types/JSON";
import CallSummaryPosts, {
  CallSummaryPost,
} from "../../../Types/VideoCall/CallSummaryPosts";
import WorkspacePostedMessage, {
  readWorkspacePostedMessage,
  toWorkspacePostedMessageJSON,
} from "../../../Types/Workspace/WorkspacePostedMessage";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { describe, expect, test } from "@jest/globals";

/*
 * Where OneUptime posted what OneUptime AI read in a call's transcript
 * (IncidentVideoCall.callSummaryPosts, #9289 and #9290): each reading's feed
 * item and channel messages, read back from the column whole or not at all,
 * so a removal never deletes a message by a half-read place - and split by
 * the sign-in that read the transcript, so an account removing OneUptime
 * takes only what was read through it.
 */

const SLACK: WorkspacePostedMessage = {
  workspaceType: WorkspaceType.Slack,
  channelId: "C0INC42",
  channelName: "inc-42",
  messageId: "1760713500.000100",
};

// A Microsoft Teams personal chat's id runs past 130 characters.
const TEAMS_CHAT: WorkspacePostedMessage = {
  workspaceType: WorkspaceType.MicrosoftTeams,
  channelId: `a:${"1".repeat(140)}`,
  isChat: true,
  messageId: "1760713500123",
};

const TEAMS_CHANNEL: WorkspacePostedMessage = {
  workspaceType: WorkspaceType.MicrosoftTeams,
  channelId: "19:abc@thread.tacv2",
  channelName: "Incidents",
  teamId: "team-1",
  messageId: "1760713500999",
};

function post(overrides: Partial<CallSummaryPost> = {}): CallSummaryPost {
  return {
    feedId: "66666666-6666-4666-8666-666666666666",
    postedAt: "2026-10-17T15:05:00.000Z",
    messages: [SLACK, TEAMS_CHAT, TEAMS_CHANNEL],
    ...overrides,
  };
}

describe("CallSummaryPosts", () => {
  test("what is written is read back as it was, ids kept whole", () => {
    const value: JSONObject | null = CallSummaryPosts.toValue([
      post(),
      post({ feedId: undefined, signInAccountId: "KdYKjnimT4KPd8FFgQt9FQ" }),
    ]);

    expect(CallSummaryPosts.read(JSON.parse(JSON.stringify(value)))).toEqual([
      post(),
      {
        postedAt: "2026-10-17T15:05:00.000Z",
        signInAccountId: "KdYKjnimT4KPd8FFgQt9FQ",
        messages: [SLACK, TEAMS_CHAT, TEAMS_CHANNEL],
      },
    ]);
    expect(
      CallSummaryPosts.read(value)[0]!.messages[1]!.channelId.length,
    ).toBe(142);
  });

  test("no posts left is no value at all", () => {
    expect(CallSummaryPosts.toValue([])).toBeNull();
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["a list", [post()]],
    ["a string", "posts"],
    ["no posts list", { posts: "many" }],
  ])("a column that holds %s holds no posts", (_name: string, value: unknown) => {
    expect(CallSummaryPosts.read(value)).toEqual([]);
  });

  test("a message that is not one is left out; the rest of its post stays", () => {
    const posts: Array<CallSummaryPost> = CallSummaryPosts.read({
      posts: [
        {
          feedId: "66666666-6666-4666-8666-666666666666",
          postedAt: "2026-10-17T15:05:00.000Z",
          messages: [
            { workspaceType: "Discord", channelId: "c", messageId: "m" },
            { workspaceType: WorkspaceType.Slack, messageId: "no channel" },
            "a string",
            toWorkspacePostedMessageJSON(SLACK),
          ],
        },
        "not a post",
      ],
    });

    expect(posts).toEqual([
      {
        feedId: "66666666-6666-4666-8666-666666666666",
        postedAt: "2026-10-17T15:05:00.000Z",
        messages: [SLACK],
      },
    ]);
  });

  test("whether a reading was kept at all: a reading posted before posts were kept has no record", () => {
    expect(CallSummaryPosts.isKept({ posts: [] })).toBe(true);
    expect(CallSummaryPosts.isKept(CallSummaryPosts.toValue([post()]))).toBe(
      true,
    );
    expect(CallSummaryPosts.isKept(null)).toBe(false);
    expect(CallSummaryPosts.isKept(undefined)).toBe(false);
    expect(CallSummaryPosts.isKept({})).toBe(false);
  });

  test("an account removing OneUptime takes what was read through its sign-in, and leaves the rest", () => {
    const throughIt: CallSummaryPost = post({
      signInAccountId: "KdYKjnimT4KPd8FFgQt9FQ",
    });
    const otherAccount: CallSummaryPost = post({
      signInAccountId: "SomeoneElse12345",
    });
    const added: CallSummaryPost = post();

    expect(
      CallSummaryPosts.splitBySignIn(
        [throughIt, otherAccount, added],
        "KdYKjnimT4KPd8FFgQt9FQ",
      ),
    ).toEqual({
      readThroughSignIn: [throughIt],
      rest: [otherAccount, added],
    });
  });

  test("no account takes nothing: a post a person's transcript made is never one of an account's", () => {
    expect(CallSummaryPosts.splitBySignIn([post()], "")).toEqual({
      readThroughSignIn: [],
      rest: [post()],
    });
  });
});

describe("WorkspacePostedMessage", () => {
  test("a message with no id is kept with an empty one: OneUptime says it cannot delete it", () => {
    expect(
      readWorkspacePostedMessage({
        workspaceType: WorkspaceType.MicrosoftTeams,
        channelId: "19:abc@thread.tacv2",
      }),
    ).toEqual({
      workspaceType: WorkspaceType.MicrosoftTeams,
      channelId: "19:abc@thread.tacv2",
      messageId: "",
    });
  });

  test("keeps only what it has", () => {
    expect(toWorkspacePostedMessageJSON(SLACK)).toEqual({
      workspaceType: WorkspaceType.Slack,
      channelId: "C0INC42",
      channelName: "inc-42",
      messageId: "1760713500.000100",
    });
    expect(toWorkspacePostedMessageJSON(TEAMS_CHAT)).toEqual({
      workspaceType: WorkspaceType.MicrosoftTeams,
      channelId: TEAMS_CHAT.channelId,
      isChat: true,
      messageId: "1760713500123",
    });
  });

  test.each([
    ["no object", "C0INC42"],
    ["an unknown workspace", { workspaceType: "Discord", channelId: "c" }],
    ["no channel", { workspaceType: WorkspaceType.Slack, channelId: "" }],
  ])("%s is no message", (_name: string, value: unknown) => {
    expect(readWorkspacePostedMessage(value)).toBeNull();
  });
});
