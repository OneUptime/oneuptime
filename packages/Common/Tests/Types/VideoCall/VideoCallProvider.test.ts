import VideoCallProvider, {
  AllVideoCallProviders,
  detectVideoCallProviderFromUrl,
  getVideoCallNoun,
  getVideoCallProviderDisplayName,
  isVideoCallProvider,
} from "../../../Types/VideoCall/VideoCallProvider";
import { describe, expect, test } from "@jest/globals";

describe("VideoCallProvider", () => {
  test("knows every provider", () => {
    expect(AllVideoCallProviders).toEqual(Object.values(VideoCallProvider));

    for (const provider of AllVideoCallProviders) {
      expect(isVideoCallProvider(provider)).toBe(true);
      expect(getVideoCallProviderDisplayName(provider)).toBeTruthy();
    }

    // Every name a person reads is the product's own spelling.
    expect(AllVideoCallProviders.map(getVideoCallProviderDisplayName)).toEqual([
      "Zoom",
      "Google Meet",
      "Microsoft Teams",
      "Slack huddle",
      "Meeting link",
    ]);

    expect(isVideoCallProvider("Webex")).toBe(false);
    expect(isVideoCallProvider(undefined)).toBe(false);
    expect(isVideoCallProvider(1)).toBe(false);
  });

  test("names providers and their calls", () => {
    expect(getVideoCallProviderDisplayName(VideoCallProvider.GoogleMeet)).toBe(
      "Google Meet",
    );
    expect(getVideoCallProviderDisplayName(VideoCallProvider.SlackHuddle)).toBe(
      "Slack huddle",
    );
    expect(getVideoCallProviderDisplayName("Something")).toBe("Something");
    expect(getVideoCallProviderDisplayName(undefined)).toBe("");
    expect(getVideoCallNoun(VideoCallProvider.Zoom)).toBe("Zoom meeting");
    expect(getVideoCallNoun(VideoCallProvider.MicrosoftTeams)).toBe(
      "Microsoft Teams meeting",
    );
    expect(getVideoCallNoun(VideoCallProvider.CustomLink)).toBe("video call");
  });

  describe("detectVideoCallProviderFromUrl", () => {
    test.each([
      ["https://zoom.us/j/123", VideoCallProvider.Zoom],
      ["https://us02web.zoom.us/j/123?pwd=x", VideoCallProvider.Zoom],
      ["https://acme.zoomgov.com/j/123", VideoCallProvider.Zoom],
      ["https://meet.google.com/abc-defg-hij", VideoCallProvider.GoogleMeet],
      [
        "https://teams.microsoft.com/l/meetup-join/19%3ameeting_x",
        VideoCallProvider.MicrosoftTeams,
      ],
      ["https://teams.live.com/meet/123", VideoCallProvider.MicrosoftTeams],
      [
        "https://app.slack.com/huddle/T01379XQ9FG/C013E22BPPC",
        VideoCallProvider.SlackHuddle,
      ],
      ["https://app.slack.com/client/T1/C1", VideoCallProvider.CustomLink],
      ["https://acme.webex.com/meet/incidents", VideoCallProvider.CustomLink],
      ["https://meet.jit.si/acme-incident", VideoCallProvider.CustomLink],
      ["https://zoom.us.evil.example.com/j/1", VideoCallProvider.CustomLink],
      ["https://notzoom.us/j/1", VideoCallProvider.CustomLink],
      ["not a url", VideoCallProvider.CustomLink],
      ["", VideoCallProvider.CustomLink],
    ])("reads %s as %s", (url: string, expected: VideoCallProvider) => {
      expect(detectVideoCallProviderFromUrl(url)).toBe(expected);
    });

    test("reads nothing as a custom link", () => {
      expect(detectVideoCallProviderFromUrl(undefined)).toBe(
        VideoCallProvider.CustomLink,
      );
    });
  });
});
