import MattermostUtil from "../../../../Server/Utils/Workspace/Mattermost/Mattermost";
import MicrosoftTeamsUtil from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import SlackUtil from "../../../../Server/Utils/Workspace/Slack/Slack";
import WorkspaceMentions from "../../../../Server/Utils/Workspace/WorkspaceMentions";
import { JSONObject } from "../../../../Types/JSON";
import {
  WorkspacePayloadMarkdown,
  WorkspacePayloadMention,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import { describe, expect, test } from "@jest/globals";

/*
 * A PERSON MENTIONED ON PURPOSE, IN EACH WORKSPACE'S OWN WAY (#7968).
 *
 * An on-call rule can ask for the person who comes on call to be mentioned
 * - notified - in its hand-off line, by the account they connected:
 *
 *   Slack             <@U0123ABC>        a mention as Slack reads one
 *   Microsoft Teams   <at>Ana Lee</at>    and a mention entity on the card
 *   Mattermost        @ana.lee            kept whole where every other "@" is broken
 *
 * Only an account's own stored id becomes a mention; nothing a person typed
 * does, and "@channel" stays broken.
 */

const SLACK_ID: string = "U0123ABC";
const ENTRA_ID: string = "7a3e1d2c-4b5f-4c6d-8e9f-0a1b2c3d4e5f";
const MATTERMOST_ID: string = "abcdefghijklmnopqrstuvwxyz";

function markdownBlock(
  text: string,
  mentions?: Array<WorkspacePayloadMention>,
): WorkspacePayloadMarkdown {
  return {
    _type: "WorkspacePayloadMarkdown",
    text: text,
    ...(mentions ? { mentions: mentions } : {}),
  };
}

describe("the mention of an account, as each workspace writes it", () => {
  test("Slack: <@id>, named by the name given", () => {
    expect(
      WorkspaceMentions.getMention({
        workspaceType: WorkspaceType.Slack,
        workspaceUserId: SLACK_ID,
        name: "Ana Lee",
      }),
    ).toEqual({
      text: `<@${SLACK_ID}>`,
      workspaceUserId: SLACK_ID,
      name: "Ana Lee",
    });

    // An Enterprise organization's user id starts with W.
    expect(
      WorkspaceMentions.getMention({
        workspaceType: WorkspaceType.Slack,
        workspaceUserId: "W0123ABC",
        name: "",
      })?.text,
    ).toBe("<@W0123ABC>");
  });

  test("Microsoft Teams: an <at> tag around the name, by the Entra object id", () => {
    expect(
      WorkspaceMentions.getMention({
        workspaceType: WorkspaceType.MicrosoftTeams,
        workspaceUserId: ENTRA_ID,
        name: "Ana Lee",
      }),
    ).toEqual({
      text: "<at>Ana Lee</at>",
      workspaceUserId: ENTRA_ID,
      name: "Ana Lee",
    });
  });

  test("Microsoft Teams: a name with what the tag or the card would read is left without it", () => {
    expect(
      WorkspaceMentions.getMention({
        workspaceType: WorkspaceType.MicrosoftTeams,
        workspaceUserId: ENTRA_ID,
        name: "Ana </at><at>Bob *Lee*",
      })?.text,
    ).toBe("<at>Ana /atatBob Lee</at>");
  });

  test("Mattermost: @username, by the user's id", () => {
    expect(
      WorkspaceMentions.getMention({
        workspaceType: WorkspaceType.Mattermost,
        workspaceUserId: MATTERMOST_ID,
        name: "ana.lee",
      }),
    ).toEqual({
      text: "@ana.lee",
      workspaceUserId: MATTERMOST_ID,
      name: "ana.lee",
    });
  });

  test("REGRESSION: nothing that is not the workspace's own account becomes a mention", () => {
    const refused: Array<{
      workspaceType: WorkspaceType;
      workspaceUserId: string | null;
      name: string;
    }> = [
      // Nothing connected.
      { workspaceType: WorkspaceType.Slack, workspaceUserId: null, name: "a" },
      { workspaceType: WorkspaceType.Slack, workspaceUserId: "", name: "a" },
      // A Slack "id" that would close the mention and open another.
      {
        workspaceType: WorkspaceType.Slack,
        workspaceUserId: "U1><!channel",
        name: "a",
      },
      {
        workspaceType: WorkspaceType.Slack,
        workspaceUserId: "u0123",
        name: "a",
      },
      // Not an Entra object id, or no name to show.
      {
        workspaceType: WorkspaceType.MicrosoftTeams,
        workspaceUserId: "29:1abc",
        name: "Ana",
      },
      {
        workspaceType: WorkspaceType.MicrosoftTeams,
        workspaceUserId: ENTRA_ID,
        name: "<>",
      },
      // A Mattermost username that is none, or would mention everybody.
      {
        workspaceType: WorkspaceType.Mattermost,
        workspaceUserId: MATTERMOST_ID,
        name: "",
      },
      {
        workspaceType: WorkspaceType.Mattermost,
        workspaceUserId: MATTERMOST_ID,
        name: "ana lee",
      },
      {
        workspaceType: WorkspaceType.Mattermost,
        workspaceUserId: "short",
        name: "ana",
      },
    ];

    for (const data of refused) {
      expect({ data, mention: WorkspaceMentions.getMention(data) }).toEqual({
        data,
        mention: null,
      });
    }
  });
});

describe("a notification log names a mention", () => {
  test("by the name it shows, every time the text holds it", () => {
    expect(
      WorkspaceMentions.toLogText(
        `📞 <@${SLACK_ID}> is now on call for Payments. <@${SLACK_ID}> takes the pager.`,
        [
          {
            text: `<@${SLACK_ID}>`,
            workspaceUserId: SLACK_ID,
            name: "Ana Lee",
          },
        ],
      ),
    ).toBe(
      "📞 @Ana Lee is now on call for Payments. @Ana Lee takes the pager.",
    );
  });

  test("text without mentions is as it was", () => {
    expect(WorkspaceMentions.toLogText("📞 @ana is now on call.", [])).toBe(
      "📞 @ana is now on call.",
    );
    expect(
      WorkspaceMentions.toLogText("📞 @ana is now on call.", undefined),
    ).toBe("📞 @ana is now on call.");
  });
});

describe("Slack reads <@id> in a message as a mention", () => {
  test("REGRESSION: the hand-off line's mention survives Slack's Markdown conversion", () => {
    const sections: Array<JSONObject> = SlackUtil.getMarkdownBlocks({
      payloadMarkdownBlock: markdownBlock(
        `📞 <@${SLACK_ID}> is now on call for [Payments](https://oneuptime.test/p) until {{TIME(2026-11-14T22:50:00Z)}}.`,
      ),
    });

    const text: string = (sections[0]!["text"] as JSONObject)["text"] as string;

    expect(text).toContain(`📞 <@${SLACK_ID}> is now on call for`);
    expect(text).toContain("<https://oneuptime.test/p|Payments>");
  });

  test("a mention somebody typed - in a name, escaped - is still broken", () => {
    const sections: Array<JSONObject> = SlackUtil.getMarkdownBlocks({
      payloadMarkdownBlock: markdownBlock(
        "📞 Ana is on call for <⁠@U0999 and \\<!channel>",
      ),
    });

    const text: string = (sections[0]!["text"] as JSONObject)["text"] as string;

    expect(text).not.toContain("<@U0999");
    expect(text).not.toContain("<!channel>");
  });
});

describe("Microsoft Teams notifies a card's mentions by their entities", () => {
  const ANA: WorkspacePayloadMention = {
    text: "<at>Ana Lee</at>",
    workspaceUserId: ENTRA_ID,
    name: "Ana Lee",
  };

  test("REGRESSION: a card whose text mentions somebody carries a mention entity for them", () => {
    const card: JSONObject =
      MicrosoftTeamsUtil.buildAdaptiveCardFromMessageBlocks({
        messageBlocks: [
          markdownBlock("📞 <at>Ana Lee</at> is now on call for Payments.", [
            ANA,
          ]),
        ],
      });

    expect(
      ((card["body"] as Array<JSONObject>)[0]!["text"] as string).includes(
        "<at>Ana Lee</at>",
      ),
    ).toBe(true);
    expect(card["msteams"]).toEqual({
      entities: [
        {
          type: "mention",
          text: "<at>Ana Lee</at>",
          mentioned: { id: ENTRA_ID, name: "Ana Lee" },
        },
      ],
    });
  });

  test("a card that mentions nobody has no entities, as before", () => {
    const card: JSONObject =
      MicrosoftTeamsUtil.buildAdaptiveCardFromMessageBlocks({
        messageBlocks: [markdownBlock("📞 Ana Lee is now on call.")],
      });

    expect(card["msteams"]).toBeUndefined();
  });

  test("a mention the text does not hold - Teams would refuse the card - is left out; one held twice is one entity", () => {
    expect(
      WorkspaceMentions.getMicrosoftTeamsEntities({
        texts: ["📞 Ana Lee is now on call."],
        mentions: [ANA],
      }),
    ).toEqual([]);
    expect(
      WorkspaceMentions.getMicrosoftTeamsEntities({
        texts: ["<at>Ana Lee</at> and <at>Ana Lee</at>"],
        mentions: [ANA, ANA],
      }),
    ).toHaveLength(1);
  });
});

describe("Mattermost keeps a mention it is told of, and breaks every other", () => {
  test("REGRESSION: the person on call is mentioned; @channel and anybody typed are not", () => {
    const posted: string = MattermostUtil.getMessageText(
      "📞 @ana.lee is now on call for @channel's Payments, then @bob.",
      ["ana.lee"],
    );

    expect(posted).toContain("📞 @ana.lee is now on call");
    expect(posted).toContain("@⁠channel");
    expect(posted).toContain("then @⁠bob.");
  });

  test("only the whole username: a longer one that starts with it is still broken", () => {
    expect(
      MattermostUtil.neutralizeMentions("@ana.leeroy and @ana.lee-x", [
        "ana.lee",
      ]),
    ).toBe("@⁠ana.leeroy and @⁠ana.lee-x");
  });

  test("a mention that ends a sentence keeps its full stop out of the username", () => {
    expect(
      MattermostUtil.neutralizeMentions("Next is @ana.lee.", ["ana.lee"]),
    ).toBe("Next is @ana.lee.");
  });

  test("with nothing to keep, every mention is broken, as before", () => {
    expect(MattermostUtil.getMessageText("📞 @ana.lee is now on call.")).toBe(
      "📞 @⁠ana.lee is now on call.",
    );
  });

  test("a post's mentions come from its Markdown blocks: the block's username is kept", () => {
    const post: JSONObject = MattermostUtil.toPost({
      blocks: MattermostUtil.getBlocksFromWorkspaceMessagePayload({
        messageBlocks: [
          markdownBlock("📞 @ana.lee is now on call. Hi @bob.", [
            {
              text: "@ana.lee",
              workspaceUserId: MATTERMOST_ID,
              name: "ana.lee",
            },
          ]),
        ],
      }),
      teamId: MATTERMOST_ID,
    });

    expect(post["message"]).toBe("📞 @ana.lee is now on call. Hi @⁠bob.");
  });
});
