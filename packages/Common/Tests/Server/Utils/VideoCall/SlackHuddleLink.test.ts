import SlackHuddleLink, {
  SLACK_HUDDLE_BASE_URL,
} from "../../../../Server/Utils/VideoCall/Providers/SlackHuddleLink";
import BadDataException from "../../../../Types/Exception/BadDataException";
import VideoCallProvider, {
  detectVideoCallProviderFromUrl,
} from "../../../../Types/VideoCall/VideoCallProvider";
import { describe, expect, test } from "@jest/globals";

/*
 * Slack's Copy huddle link gives https://app.slack.com/huddle/<team>/<channel>,
 * and opening it starts the channel's huddle. The link is built from ids
 * OneUptime stored, so anything that is not a Slack id is refused rather
 * than allowed to reshape the path.
 */
describe("SlackHuddleLink", () => {
  test("builds the channel's huddle link", () => {
    expect(
      SlackHuddleLink.getHuddleUrl({
        teamId: "T01379XQ9FG",
        channelId: "C013E22BPPC",
      }),
    ).toBe("https://app.slack.com/huddle/T01379XQ9FG/C013E22BPPC");
  });

  test("accepts an Enterprise Grid org id and a private channel id", () => {
    expect(
      SlackHuddleLink.getHuddleUrl({
        teamId: "E0123ABCD",
        channelId: "G0123ABCD",
      }),
    ).toBe(`${SLACK_HUDDLE_BASE_URL}/E0123ABCD/G0123ABCD`);
  });

  test("returns a huddle that the provider detection recognises as one", () => {
    const huddle: ReturnType<typeof SlackHuddleLink.getHuddle> =
      SlackHuddleLink.getHuddle({ teamId: "T1", channelId: "C1" });

    expect(huddle.provider).toBe(VideoCallProvider.SlackHuddle);
    expect(huddle.externalMeetingId).toBe("C1");
    expect(detectVideoCallProviderFromUrl(huddle.joinUrl)).toBe(
      VideoCallProvider.SlackHuddle,
    );
  });

  test.each([
    ["", "C0123ABCD"],
    ["T0123/../x", "C0123ABCD"],
    ["T0123ABCD", "c0123abcd"],
    ["T0123ABCD", "C0123ABCD?x=1"],
    ["T0123ABCD", ""],
    ["T0123ABCD", "#incident-42"],
  ])("refuses team %s and channel %s", (teamId: string, channelId: string) => {
    expect(() => {
      return SlackHuddleLink.getHuddleUrl({ teamId, channelId });
    }).toThrow(BadDataException);
  });
});
