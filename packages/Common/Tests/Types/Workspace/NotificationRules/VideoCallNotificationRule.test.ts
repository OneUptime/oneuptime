import {
  SLACK_HUDDLE_VIDEO_CALL_SOURCE,
  getRequestedVideoCallSource,
  isSlackHuddleVideoCallSource,
} from "../../../../Types/Workspace/NotificationRules/VideoCallNotificationRule";
import { describe, expect, test } from "@jest/globals";

describe("VideoCallNotificationRule", () => {
  test("a rule asks for a call only when switched on with a source", () => {
    expect(getRequestedVideoCallSource(undefined)).toBe(null);
    expect(getRequestedVideoCallSource({})).toBe(null);
    expect(
      getRequestedVideoCallSource({
        shouldStartVideoCall: false,
        videoCallSource: SLACK_HUDDLE_VIDEO_CALL_SOURCE,
      }),
    ).toBe(null);
    expect(getRequestedVideoCallSource({ shouldStartVideoCall: true })).toBe(
      null,
    );
    expect(
      getRequestedVideoCallSource({
        shouldStartVideoCall: true,
        videoCallSource: "   ",
      }),
    ).toBe(null);
    expect(
      getRequestedVideoCallSource({
        shouldStartVideoCall: true,
        videoCallSource: " 7c8d9e0f-a1b2-3c4d-9e5f-8a9b0c1d2e3f ",
      }),
    ).toBe("7c8d9e0f-a1b2-3c4d-9e5f-8a9b0c1d2e3f");
  });

  test("knows the Slack huddle source", () => {
    expect(isSlackHuddleVideoCallSource(SLACK_HUDDLE_VIDEO_CALL_SOURCE)).toBe(
      true,
    );
    expect(isSlackHuddleVideoCallSource("slackhuddle")).toBe(false);
    expect(isSlackHuddleVideoCallSource(undefined)).toBe(false);
  });
});
