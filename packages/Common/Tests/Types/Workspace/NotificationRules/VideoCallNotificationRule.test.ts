import {
  SLACK_HUDDLE_VIDEO_CALL_SOURCE,
  getRequestedVideoCallSource,
  getVideoCallValidationError,
  isSlackHuddleVideoCallSource,
} from "../../../../Types/Workspace/NotificationRules/VideoCallNotificationRule";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
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

describe("getVideoCallValidationError", () => {
  const CONNECTION_ID: string = "7c8d9e0f-a1b2-3c4d-9e5f-8a9b0c1d2e3f";

  test("a rule that starts no call has nothing to check", () => {
    for (const workspaceType of [
      WorkspaceType.Slack,
      WorkspaceType.MicrosoftTeams,
    ]) {
      expect(
        getVideoCallValidationError({ rule: undefined, workspaceType }),
      ).toBeNull();
      expect(
        getVideoCallValidationError({ rule: {}, workspaceType }),
      ).toBeNull();
      // Switched off, a leftover source is kept for later and never checked.
      expect(
        getVideoCallValidationError({
          rule: {
            shouldStartVideoCall: false,
            videoCallSource: SLACK_HUDDLE_VIDEO_CALL_SOURCE,
          },
          workspaceType,
        }),
      ).toBeNull();
    }
  });

  test("a switched-on call needs to know where it is held", () => {
    for (const videoCallSource of [undefined, "", "   "]) {
      expect(
        getVideoCallValidationError({
          rule: { shouldStartVideoCall: true, videoCallSource },
          workspaceType: WorkspaceType.Slack,
        }),
      ).toBe(
        "Pick where this rule's video call is held, or turn the video call off.",
      );
    }
  });

  test("a Slack rule may hold its call in its channel's huddle", () => {
    expect(
      getVideoCallValidationError({
        rule: {
          shouldStartVideoCall: true,
          videoCallSource: SLACK_HUDDLE_VIDEO_CALL_SOURCE,
        },
        workspaceType: WorkspaceType.Slack,
      }),
    ).toBeNull();
  });

  test("a Microsoft Teams rule may not: it has no Slack channel", () => {
    expect(
      getVideoCallValidationError({
        rule: {
          shouldStartVideoCall: true,
          videoCallSource: SLACK_HUDDLE_VIDEO_CALL_SOURCE,
        },
        workspaceType: WorkspaceType.MicrosoftTeams,
      }),
    ).toBe(
      "A Slack huddle can only be started by a Slack notification rule. Pick a Zoom, Google Meet or Microsoft Teams connection instead.",
    );
  });

  test("any rule may use one of the project's connections", () => {
    for (const workspaceType of [
      WorkspaceType.Slack,
      WorkspaceType.MicrosoftTeams,
    ]) {
      expect(
        getVideoCallValidationError({
          rule: { shouldStartVideoCall: true, videoCallSource: CONNECTION_ID },
          workspaceType,
        }),
      ).toBeNull();
    }
  });
});
