import VideoCallMessages, {
  VideoCallAnnouncement,
} from "../../../../Server/Utils/VideoCall/VideoCallMessages";
import SlackActionType from "../../../../Server/Utils/Workspace/Slack/Actions/ActionTypes";
import { MessageBlocksByWorkspaceType } from "../../../../Server/Services/WorkspaceNotificationRuleService";
import VideoCallProvider from "../../../../Types/VideoCall/VideoCallProvider";
import {
  WorkspaceMessagePayloadButton,
  WorkspacePayloadButtons,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import { describe, expect, test } from "@jest/globals";

/*
 * What a started call says in the incident's feed and in its Slack and
 * Microsoft Teams channels. Every name and title in it is text a person
 * typed, so the tests include the hostile ones: a title that would be a
 * link, an image fetched on view, or a Slack mention of the whole channel.
 */

const EVENT_LINK: string = "https://oneuptime.com/dashboard/p1/incidents/i1";

function announcement(
  overrides: Partial<VideoCallAnnouncement>,
): VideoCallAnnouncement {
  return {
    eventNoun: "Incident",
    eventNumberDisplay: "INC-42",
    eventLink: EVENT_LINK,
    provider: VideoCallProvider.Zoom,
    joinUrl: "https://us02web.zoom.us/j/123?pwd=abc",
    startedByPerson: false,
    ...overrides,
  };
}

describe("VideoCallMessages", () => {
  describe("getStartedFeedMarkdown", () => {
    test("a rule's Zoom meeting: which call, for which incident, and the link", () => {
      const markdown: string = VideoCallMessages.getStartedFeedMarkdown(
        announcement({}),
      ).toString();

      expect(markdown).toBe(
        `📞 A **Zoom meeting** was started for [Incident INC-42](${EVENT_LINK}).

**[Join the call](https://us02web.zoom.us/j/123?pwd=abc)**`,
      );
    });

    test("a person's call reads on from their name", () => {
      const markdown: string = VideoCallMessages.getStartedFeedMarkdown(
        announcement({
          provider: VideoCallProvider.MicrosoftTeams,
          startedByPerson: true,
        }),
      ).toString();

      expect(
        markdown.startsWith(
          "📞 started a **Microsoft Teams meeting** for [Incident INC-42]",
        ),
      ).toBe(true);
    });

    test("a person's own link is added, not started", () => {
      expect(
        VideoCallMessages.getStartedFeedMarkdown(
          announcement({
            provider: VideoCallProvider.CustomLink,
            title: "War room",
            startedByPerson: true,
          }),
        ).toString(),
      ).toContain("📞 added a **War room** video call to [Incident INC-42]");

      expect(
        VideoCallMessages.getStartedFeedMarkdown(
          announcement({ provider: VideoCallProvider.CustomLink }),
        ).toString(),
      ).toContain("📞 A **video call** was added to [Incident INC-42]");
    });

    test("a standing bridge is named for its connection", () => {
      expect(
        VideoCallMessages.getStartedFeedMarkdown(
          announcement({
            provider: VideoCallProvider.CustomLink,
            connectionName: "Major incident bridge",
          }),
        ).toString(),
      ).toContain("**Major incident bridge** video call");
    });

    test("a Slack huddle says it starts when opened", () => {
      const markdown: string = VideoCallMessages.getStartedFeedMarkdown(
        announcement({
          provider: VideoCallProvider.SlackHuddle,
          joinUrl: "https://app.slack.com/huddle/T1/C1",
        }),
      ).toString();

      expect(markdown).toContain(
        "🎧 The **Slack huddle** of [Incident INC-42]",
      );
      expect(markdown).toContain(
        "Opening the link starts the huddle, or joins it when it is running.",
      );
      expect(markdown).toContain(
        "**[Join the huddle](https://app.slack.com/huddle/T1/C1)**",
      );
    });

    test("an alert reads as an alert", () => {
      // "#" is escaped inside link text; it still reads "Alert #7".
      expect(
        VideoCallMessages.getStartedFeedMarkdown(
          announcement({ eventNoun: "Alert", eventNumberDisplay: "#7" }),
        ).toString(),
      ).toContain("[Alert #7](");
    });

    test("a hostile title stays text: no link, no image, no mention", () => {
      const markdown: string = VideoCallMessages.getStartedFeedMarkdown(
        announcement({
          provider: VideoCallProvider.CustomLink,
          title:
            "<!channel> [Reset password](https://evil.example) ![](https://tracker.example/p.gif)",
          startedByPerson: true,
        }),
      ).toString();

      expect(markdown).not.toContain("[Reset password](https://evil.example)");
      expect(markdown).not.toContain("![](https://tracker.example/p.gif)");
      expect(markdown).not.toContain("<!channel>");
    });

    test("a join link cannot end its own link target early", () => {
      const markdown: string = VideoCallMessages.getStartedFeedMarkdown(
        announcement({
          provider: VideoCallProvider.CustomLink,
          joinUrl: "https://example.com/room(1) <b>",
        }),
      ).toString();

      expect(markdown).toContain(
        "**[Join the call](https://example.com/room%281%29%20%3Cb%3E)**",
      );
    });
  });

  describe("getStartedFeedMoreInformationMarkdown", () => {
    test("names the rule and the connection, escaped", () => {
      expect(
        VideoCallMessages.getStartedFeedMoreInformationMarkdown(
          announcement({
            ruleName: "Sev1 [bridge]",
            connectionName: "Incident Zoom",
          }),
        )?.toString(),
      ).toBe(
        "Started by the **Sev1 \\[bridge\\]** workspace notification rule.\n\nCreated with the **Incident Zoom** video call connection.",
      );
    });

    test("a standing link's connection is already named in the sentence", () => {
      expect(
        VideoCallMessages.getStartedFeedMoreInformationMarkdown(
          announcement({
            provider: VideoCallProvider.CustomLink,
            connectionName: "Bridge",
          }),
        ),
      ).toBe(undefined);
    });

    test("says nothing when there is nothing to add", () => {
      expect(
        VideoCallMessages.getStartedFeedMoreInformationMarkdown(
          announcement({ startedByPerson: true }),
        ),
      ).toBe(undefined);
    });
  });

  describe("getFailedFeedMarkdown", () => {
    test("names the rule and the reason, both escaped", () => {
      const markdown: string = VideoCallMessages.getFailedFeedMarkdown({
        eventNoun: "Incident",
        ruleName: "Sev1 <!here>",
        error: "Zoom said [no](https://evil.example)",
      }).toString();

      expect(markdown).toContain("⚠️ The video call the **Sev1");
      expect(markdown).toContain(
        "Start one from this incident's page instead.",
      );
      expect(markdown).not.toContain("<!here>");
      expect(markdown).not.toContain("[no](https://evil.example)");
    });

    test("reads without a rule name", () => {
      expect(
        VideoCallMessages.getFailedFeedMarkdown({
          eventNoun: "Alert",
          ruleName: "",
          error: "x",
        }).toString(),
      ).toContain("The video call a workspace notification rule asks for");
    });
  });

  describe("getJoinButtonBlocks", () => {
    test("one link button for Slack and one for Microsoft Teams", () => {
      const joinUrl: string =
        "https://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0?context=%7b%7d";

      const blocks: Array<MessageBlocksByWorkspaceType> =
        VideoCallMessages.getJoinButtonBlocks({
          provider: VideoCallProvider.MicrosoftTeams,
          joinUrl,
        });

      expect(
        blocks.map((block: MessageBlocksByWorkspaceType) => {
          return block.workspaceType;
        }),
      ).toEqual([WorkspaceType.Slack, WorkspaceType.MicrosoftTeams]);

      for (const block of blocks) {
        expect(block.messageBlocks).toHaveLength(1);

        const buttons: WorkspacePayloadButtons = block
          .messageBlocks[0] as WorkspacePayloadButtons;
        expect(buttons._type).toBe("WorkspacePayloadButtons");

        const button: WorkspaceMessagePayloadButton = buttons.buttons[0]!;
        expect(button.title).toBe("📞 Join call");
        // The link is passed through untouched, encodings and all.
        expect(button.url?.toString()).toBe(joinUrl);
        expect(button.actionId).toBe(SlackActionType.JoinVideoCall);
      }
    });

    test("a huddle's button says huddle", () => {
      const blocks: Array<MessageBlocksByWorkspaceType> =
        VideoCallMessages.getJoinButtonBlocks({
          provider: VideoCallProvider.SlackHuddle,
          joinUrl: "https://app.slack.com/huddle/T1/C1",
        });

      expect(
        (blocks[0]!.messageBlocks[0] as WorkspacePayloadButtons).buttons[0]!
          .title,
      ).toBe("🎧 Join huddle");
    });
  });

  describe("getMeetingRequestText", () => {
    test("names the meeting for the event", () => {
      expect(
        VideoCallMessages.getMeetingRequestText({
          eventNoun: "Incident",
          eventNumberDisplay: "INC-42",
          eventTitle: "  Checkout   API\nis down ",
          eventLink: EVENT_LINK,
        }),
      ).toEqual({
        title: "INC-42: Checkout API is down",
        description: `Video call for incident INC-42, started by OneUptime. Incident details: ${EVENT_LINK}`,
      });
    });

    test("falls back to the event's number without a title", () => {
      expect(
        VideoCallMessages.getMeetingRequestText({
          eventNoun: "Alert",
          eventNumberDisplay: "#7",
          eventTitle: undefined,
          eventLink: EVENT_LINK,
        }).title,
      ).toBe("Alert #7");
    });
  });

  test("an ordinary join link is placed as it is, without the spaces around it", () => {
    const markdown: string = VideoCallMessages.getStartedFeedMarkdown(
      announcement({
        provider: VideoCallProvider.GoogleMeet,
        joinUrl: " https://meet.google.com/abc-mnop-xyz ",
      }),
    ).toString();

    expect(markdown).toContain(
      "**[Join the call](https://meet.google.com/abc-mnop-xyz)**",
    );
  });

  test("a join link that is not a web address is not linked", () => {
    const markdown: string = VideoCallMessages.getStartedFeedMarkdown(
      announcement({
        provider: VideoCallProvider.CustomLink,
        joinUrl: "javascript:alert(1)",
      }),
    ).toString();

    expect(markdown).toContain("**[Join the call](#)**");
    expect(markdown).not.toContain("javascript:");
  });
});
