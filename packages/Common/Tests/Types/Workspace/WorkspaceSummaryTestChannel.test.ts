import { describe, expect, test } from "@jest/globals";
import {
  getWorkspaceSummaryTestChannels,
  WORKSPACE_SUMMARY_TEST_CHANNELS_KEY,
  WorkspaceSummaryTestChannel,
} from "../../../Types/Workspace/NotificationSummary/WorkspaceSummaryTestChannel";

/*
 * #6920: what the Dashboard reads of Send Test Now's refusal - each
 * channel of the summary, and what became of the test in it - from the
 * JSON body the test route answers. A body of another shape is read as
 * having no channels, and the dialog says the answer's message, as it
 * always did.
 */

const NOT_FOUND: string =
  "The Slack channel #gone was not found. If it is a private channel, invite OneUptime's bot to it in Slack.";

const MESSAGE: string = `The test summary was not posted in 1 of its 2 channels. #gone: ${NOT_FOUND}`;

describe("getWorkspaceSummaryTestChannels", () => {
  test("the channels are under the key the route answers them by", () => {
    expect(WORKSPACE_SUMMARY_TEST_CHANNELS_KEY).toBe("channels");
  });

  test("each channel, in the order the route answered them: posted, or not with why", () => {
    const channels: Array<WorkspaceSummaryTestChannel> =
      getWorkspaceSummaryTestChannels({
        message: MESSAGE,
        channels: [
          { channelName: "#ops", isPosted: true },
          { channelName: "#gone", isPosted: false, reason: NOT_FOUND },
        ],
      });

    expect(channels).toStrictEqual([
      { channelName: "#ops", isPosted: true, reason: undefined },
      { channelName: "#gone", isPosted: false, reason: NOT_FOUND },
    ]);
  });

  test("a reason is read without the spaces around it; a blank one, or one that is not text, is none", () => {
    expect(
      getWorkspaceSummaryTestChannels({
        channels: [
          { channelName: "#a", isPosted: false, reason: "  ratelimited \n" },
          { channelName: "#b", isPosted: false, reason: "   " },
          { channelName: "#c", isPosted: false, reason: "" },
          { channelName: "#d", isPosted: false, reason: 404 },
          { channelName: "#e", isPosted: false, reason: null },
          { channelName: "#f", isPosted: false },
        ],
      }).map((channel: WorkspaceSummaryTestChannel) => {
        return channel.reason;
      }),
    ).toEqual([
      "ratelimited",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  test("only what a channel is: its name, whether it was posted in, and why not - nothing else the body holds", () => {
    const channels: Array<WorkspaceSummaryTestChannel> =
      getWorkspaceSummaryTestChannels({
        channels: [
          {
            channelName: "#ops",
            isPosted: true,
            channelId: "C0OPS",
            threadId: "1760000000.000100",
          },
        ],
      });

    expect(Object.keys(channels[0]!).sort()).toEqual([
      "channelName",
      "isPosted",
      "reason",
    ]);
  });

  test("an answer with no channels - a test refused before anything was posted, an older server - has none", () => {
    expect(
      getWorkspaceSummaryTestChannels({
        message: "The summary has no channel to post in.",
      }),
    ).toEqual([]);
    expect(getWorkspaceSummaryTestChannels({ message: MESSAGE })).toEqual([]);
    expect(getWorkspaceSummaryTestChannels({ channels: [] })).toEqual([]);
  });

  test.each([
    ["no body", undefined],
    ["null", null],
    ["text", "Network Error"],
    ["a number", 400],
    ["true", true],
    ["a list", [{ channelName: "#ops", isPosted: true }]],
  ])(
    "a body that is not an object (%s) has none",
    (_name: string, body: unknown) => {
      expect(getWorkspaceSummaryTestChannels(body)).toEqual([]);
    },
  );

  test.each([
    ["an object", { "#ops": true }],
    ["text", "#ops"],
    ["null", null],
  ])(
    "channels that are not a list (%s) are none",
    (_name: string, channels: unknown) => {
      expect(getWorkspaceSummaryTestChannels({ channels: channels })).toEqual(
        [],
      );
    },
  );

  test.each([
    ["a channel that is not an object", ["#ops"]],
    ["a channel that is null", [null]],
    ["a channel that is a list", [["#ops", true]]],
    ["a channel without a name", [{ isPosted: false, reason: NOT_FOUND }]],
    ["a name that is not text", [{ channelName: 7, isPosted: true }]],
    ["no word of whether it was posted", [{ channelName: "#ops" }]],
    [
      "whether it was posted, as text",
      [{ channelName: "#ops", isPosted: "false" }],
    ],
    [
      "whether it was posted, as a number",
      [{ channelName: "#ops", isPosted: 0 }],
    ],
  ])(
    "%s: the list is not this answer's shape, so none is read - not part of it",
    (_name: string, malformed: Array<unknown>) => {
      expect(
        getWorkspaceSummaryTestChannels({
          channels: [{ channelName: "#sre", isPosted: true }, ...malformed],
        }),
      ).toEqual([]);
    },
  );

  test("the body it reads is left as it was", () => {
    const body: Record<string, unknown> = {
      channels: [{ channelName: "#gone", isPosted: false, reason: " gone " }],
    };
    const before: string = JSON.stringify(body);

    getWorkspaceSummaryTestChannels(body);

    expect(JSON.stringify(body)).toBe(before);
  });
});
