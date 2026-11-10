import MattermostUtil from "../../../../Server/Utils/Workspace/Mattermost/Mattermost";
import MicrosoftTeamsUtil from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import { MICROSOFT_TEAMS_TRUNCATED_TEXT_NOTE } from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsMessageSize";
import SlackUtil from "../../../../Server/Utils/Workspace/Slack/Slack";
import { JSONObject } from "../../../../Types/JSON";
import { WORD_JOINER } from "../../../../Utils/Markdown/MarkdownEscape";
import { MarkdownText, mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import {
  SloFeedDeploymentGateChange,
  SloFeedMarkdown,
  SloFeedMarkdownParts,
  SloFeedPolicyTierChange,
  getSloDeploymentGateChangedFeedMarkdown,
  getSloDeploymentGateChangedFeedParts,
  getSloFeedChatMarkdown,
  getSloPolicyTierChangedFeedMarkdown,
  getSloPolicyTierChangedFeedParts,
  toSloFeedMarkdown,
} from "../../../../Utils/Slo/SloFeedMarkdown";
import { describe, expect, jest, test } from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

/*
 * WHAT A CHANNEL IS TOLD WHEN AN SLO'S ERROR BUDGET POLICY MOVES.
 *
 * The message a Service Level Objective rule posts to Slack, Microsoft
 * Teams or Mattermost is the SLO feed item of the same change: its line,
 * then its details - the tier left and entered, how the deploy gate moved,
 * the budget left - and the team's agreement for the new tier, in the words
 * the feed uses. What people named - the SLO, the tiers - is placed as
 * text, so a name such as "<!channel>" notifies nobody and hides no link;
 * the agreement stays the team's Markdown, with every chat mention in it
 * broken; and the senders hold the message to what each workspace takes.
 */

const SLO_LINK: MarkdownText = mdText`[SLO ${"Checkout availability"}](https://oneuptime.com/dashboard/project-1/slos/slo-1)`;

const AGREEMENT: string =
  "Freeze **non-critical** releases.\n\n- reliability fixes\n- security fixes\n\nSee the [runbook](https://runbook.example/freeze).";

function tierChange(
  overrides: Partial<SloFeedPolicyTierChange> = {},
): SloFeedPolicyTierChange {
  return {
    sloMarkdownLink: SLO_LINK,
    previousTierName: "Caution",
    newTier: {
      name: "Budget exhausted",
      thresholdPercentage: 0,
      whatWeDo: AGREEMENT,
    },
    isEscalation: true,
    errorBudgetRemainingPercentage: -4.17,
    errorBudgetRemainingSeconds: -36,
    deployments: { isAllowed: false, hasChanged: true },
    ...overrides,
  };
}

function gateChange(
  overrides: Partial<SloFeedDeploymentGateChange> = {},
): SloFeedDeploymentGateChange {
  return {
    sloMarkdownLink: SLO_LINK,
    tierName: "Budget exhausted",
    isAllowed: false,
    errorBudgetRemainingPercentage: -4.17,
    errorBudgetRemainingSeconds: -36,
    ...overrides,
  };
}

function chatOf(parts: SloFeedMarkdownParts): string {
  return getSloFeedChatMarkdown(parts).toString();
}

function slackTextOf(markdown: string): string {
  return SlackUtil.getMarkdownBlocks({
    payloadMarkdownBlock: {
      _type: "WorkspacePayloadMarkdown",
      text: markdown,
    },
  })
    .map((block: JSONObject): string => {
      return ((block["text"] as JSONObject)?.["text"] as string) || "";
    })
    .join("\n");
}

function teamsTextOf(markdown: string): string {
  return (
    (MicrosoftTeamsUtil.getMarkdownBlock({
      payloadMarkdownBlock: {
        _type: "WorkspacePayloadMarkdown",
        text: markdown,
      },
    })["text"] as string) || ""
  );
}

// A Slack mention (<!channel>, <!here>, <@U123>, <#C123>) as Slack reads one.
const SLACK_MENTION_PATTERN: RegExp = /<[!@#]/;
// A Slack link whose words hide an address a name brought.
const SLACK_HIDDEN_LINK_PATTERN: RegExp = /<https:\/\/evil\.example[^|>]*\|/;
// A Mattermost mention: "@" at the start of a word, before a letter.
const MATTERMOST_MENTION_PATTERN: RegExp =
  /(?:^|[\s(])@(?:channel|here|all|alice)/;

describe("the message says the change in the feed item's words", () => {
  test("a tier change: the item's line, then its details, then the agreement", () => {
    const parts: SloFeedMarkdownParts =
      getSloPolicyTierChangedFeedParts(tierChange());
    const feed: SloFeedMarkdown =
      getSloPolicyTierChangedFeedMarkdown(tierChange());

    // The feed reads exactly as the item it always posted.
    expect(toSloFeedMarkdown(parts)).toEqual(feed);
    expect(chatOf(parts)).toBe(
      `${feed.feedInfoInMarkdown}\n\n${feed.moreInformationInMarkdown}`,
    );
    expect(chatOf(parts)).toBe(
      [
        "📉 [SLO Checkout availability](https://oneuptime.com/dashboard/project-1/slos/slo-1) entered the **Budget exhausted** tier of its error budget policy (was **Caution**). Deployments are frozen.",
        "**Error budget policy tier**: Caution → Budget exhausted",
        "**Deployments**: allowed → frozen",
        "**Error budget remaining**: -4.17% (over budget by 36 seconds)",
        "**Tier applies while**: the error budget left is at or below 0%",
        "**What we do**:",
        AGREEMENT,
      ].join("\n\n"),
    );
  });

  test("recovering, and leaving every tier, say so as the feed does", () => {
    const recovered: string = chatOf(
      getSloPolicyTierChangedFeedParts(
        tierChange({
          previousTierName: "Budget exhausted",
          newTier: {
            name: "Reliability first",
            thresholdPercentage: 25,
            whatWeDo: "Only reliability work ships.",
          },
          isEscalation: false,
          errorBudgetRemainingPercentage: 23.6,
          errorBudgetRemainingSeconds: 204,
          deployments: { isAllowed: true, hasChanged: true },
        }),
      ),
    );

    expect(recovered.split("\n\n")[0]).toBe(
      "📈 [SLO Checkout availability](https://oneuptime.com/dashboard/project-1/slos/slo-1) recovered to the **Reliability first** tier of its error budget policy (was **Budget exhausted**). Deployments are allowed again.",
    );
    expect(recovered).toContain("**Deployments**: frozen → allowed");
    expect(recovered.endsWith("Only reliability work ships.")).toBe(true);

    const left: string = chatOf(
      getSloPolicyTierChangedFeedParts(
        tierChange({
          previousTierName: "Caution",
          newTier: null,
          isEscalation: false,
          errorBudgetRemainingPercentage: 62,
          errorBudgetRemainingSeconds: 535,
          deployments: { isAllowed: true, hasChanged: false },
        }),
      ),
    );

    expect(left).toBe(
      [
        "✅ [SLO Checkout availability](https://oneuptime.com/dashboard/project-1/slos/slo-1) left the **Caution** tier of its error budget policy: its error budget is above every tier again.",
        "**Error budget policy tier**: Caution → none",
        "**Error budget remaining**: 62% (9 minutes)",
      ].join("\n\n"),
    );
  });

  test("a tier without an agreement says nothing about one", () => {
    const parts: SloFeedMarkdownParts = getSloPolicyTierChangedFeedParts(
      tierChange({
        newTier: {
          name: "Budget exhausted",
          thresholdPercentage: 0,
          whatWeDo: "   ",
        },
      }),
    );

    expect(parts.whatWeDo).toBeUndefined();
    expect(chatOf(parts)).not.toContain("What we do");
    expect(toSloFeedMarkdown(parts).moreInformationInMarkdown).not.toContain(
      "What we do",
    );
  });

  test("a deploy gate flip: the item's line and its details, with no agreement", () => {
    const parts: SloFeedMarkdownParts =
      getSloDeploymentGateChangedFeedParts(gateChange());
    const feed: SloFeedMarkdown =
      getSloDeploymentGateChangedFeedMarkdown(gateChange());

    expect(toSloFeedMarkdown(parts)).toEqual(feed);
    expect(chatOf(parts)).toBe(
      [
        "🔒 Deployments of [SLO Checkout availability](https://oneuptime.com/dashboard/project-1/slos/slo-1) are frozen: its **Budget exhausted** tier now freezes deployments.",
        "**Deployments**: allowed → frozen",
        "**Error budget policy tier**: Budget exhausted",
        "**Error budget remaining**: -4.17% (over budget by 36 seconds)",
      ].join("\n\n"),
    );

    expect(
      chatOf(
        getSloDeploymentGateChangedFeedParts(gateChange({ isAllowed: true })),
      ).split("\n\n")[0],
    ).toBe(
      "🔓 Deployments of [SLO Checkout availability](https://oneuptime.com/dashboard/project-1/slos/slo-1) are allowed again: its **Budget exhausted** tier no longer freezes deployments.",
    );
  });
});

describe("what people named notifies nobody and hides no link", () => {
  const HOSTILE: string =
    "<!channel> <@U0123ABC> [Freeze](https://evil.example/login) **bold**";

  const hostileMarkdown: string = chatOf(
    getSloPolicyTierChangedFeedParts(
      tierChange({
        sloMarkdownLink: mdText`[SLO ${HOSTILE}](https://oneuptime.com/dashboard/project-1/slos/slo-1)`,
        previousTierName: HOSTILE,
        newTier: {
          name: HOSTILE,
          thresholdPercentage: 0,
          whatWeDo: "Freeze releases.",
        },
      }),
    ),
  );

  test("in Slack: no mention, and no link to where a name points", () => {
    const slack: string = slackTextOf(hostileMarkdown);

    expect(SLACK_MENTION_PATTERN.test(slack)).toBe(false);
    expect(SLACK_HIDDEN_LINK_PATTERN.test(slack)).toBe(false);
    // The SLO's own link is the only one, to the SLO.
    expect(slack).toContain(
      "<https://oneuptime.com/dashboard/project-1/slos/slo-1|",
    );
  });

  test("in a deploy gate flip's message too", () => {
    const slack: string = slackTextOf(
      chatOf(
        getSloDeploymentGateChangedFeedParts(gateChange({ tierName: HOSTILE })),
      ),
    );

    expect(SLACK_MENTION_PATTERN.test(slack)).toBe(false);
    expect(SLACK_HIDDEN_LINK_PATTERN.test(slack)).toBe(false);
  });

  test("in Microsoft Teams and Mattermost: the names read as typed, and mention nobody", () => {
    const teams: string = teamsTextOf(hostileMarkdown);

    // Teams draws the Markdown: an escaped name is text, never a link.
    expect(teams).not.toContain("[Freeze](https://evil.example/login)");

    const mattermost: string = MattermostUtil.getMessageText(
      chatOf(
        getSloPolicyTierChangedFeedParts(
          tierChange({ previousTierName: "@channel @alice" }),
        ),
      ),
    );

    expect(MATTERMOST_MENTION_PATTERN.test(mattermost)).toBe(false);
  });
});

describe("the agreement stays the team's Markdown, and notifies nobody", () => {
  const QUOTING_MENTIONS: string =
    "Page <!channel> and <@U0123ABC> in <#C0123ABC>, then <!subteam^S0123|sre>.\n\n- **stop** releases\n- read the [runbook](https://runbook.example/freeze)";

  const markdown: string = chatOf(
    getSloPolicyTierChangedFeedParts(
      tierChange({
        newTier: {
          name: "Budget exhausted",
          thresholdPercentage: 0,
          whatWeDo: QUOTING_MENTIONS,
        },
      }),
    ),
  );

  test("in Slack: no mention of the channel, a person, a channel or a group", () => {
    const slack: string = slackTextOf(markdown);

    expect(SLACK_MENTION_PATTERN.test(slack)).toBe(false);
    // ...and still the team's emphasis, list and link.
    expect(slack).toContain("*stop*");
    expect(slack).toContain("<https://runbook.example/freeze|runbook>");
  });

  test("the agreement reads as typed: only invisible joiners break the mentions", () => {
    expect(markdown.split(WORD_JOINER).join("")).toContain(QUOTING_MENTIONS);
    expect(markdown).not.toContain("<!channel>");
    expect(markdown).not.toContain("<@U0123ABC>");
  });

  test("the feed keeps the agreement exactly as the team wrote it", () => {
    expect(
      toSloFeedMarkdown(
        getSloPolicyTierChangedFeedParts(
          tierChange({
            newTier: {
              name: "Budget exhausted",
              thresholdPercentage: 0,
              whatWeDo: QUOTING_MENTIONS,
            },
          }),
        ),
      ).moreInformationInMarkdown.endsWith(QUOTING_MENTIONS),
    ).toBe(true);
  });

  test("in Mattermost: no @-mention reaches anybody", () => {
    const mattermost: string = MattermostUtil.getMessageText(
      chatOf(
        getSloPolicyTierChangedFeedParts(
          tierChange({
            newTier: {
              name: "Budget exhausted",
              thresholdPercentage: 0,
              whatWeDo: "Tell @channel, then ask @alice to roll back.",
            },
          }),
        ),
      ),
    );

    expect(MATTERMOST_MENTION_PATTERN.test(mattermost)).toBe(false);
  });

  test("an image an agreement carries as a data: URL is its alt text in a chat", () => {
    const withImage: string = chatOf(
      getSloPolicyTierChangedFeedParts(
        tierChange({
          newTier: {
            name: "Budget exhausted",
            thresholdPercentage: 0,
            whatWeDo: `Freeze.\n\n![burn-down](data:image/png;base64,${"A".repeat(4096)})`,
          },
        }),
      ),
    );

    expect(withImage).not.toContain("data:image/png");
    // The alt text, as text: its "-" escaped so it starts no list.
    expect(withImage.endsWith("Freeze.\n\nburn\\-down")).toBe(true);
  });
});

describe("a long agreement is cut to what each workspace takes, with a note", () => {
  // A megabyte on one line, as an agreement saved through the API could be.
  const LONG_AGREEMENT: string = `Start ${"freeze releases and fix the checkout path. ".repeat(24000)} End`;

  const markdown: string = chatOf(
    getSloPolicyTierChangedFeedParts(
      tierChange({
        newTier: {
          name: "Budget exhausted",
          thresholdPercentage: 0,
          whatWeDo: LONG_AGREEMENT,
        },
      }),
    ),
  );

  test("Slack: sections it accepts, opening with the change, ending with the note", () => {
    const sections: Array<JSONObject> = SlackUtil.getMarkdownBlocks({
      payloadMarkdownBlock: {
        _type: "WorkspacePayloadMarkdown",
        text: markdown,
      },
    });
    const texts: Array<string> = sections.map((section: JSONObject): string => {
      return ((section["text"] as JSONObject)?.["text"] as string) || "";
    });

    expect(sections.length).toBeGreaterThanOrEqual(1);
    expect(sections.length).toBeLessThanOrEqual(
      SlackUtil.MAX_SECTIONS_PER_MARKDOWN_BLOCK,
    );
    expect(
      texts.every((text: string): boolean => {
        return text.length <= SlackUtil.SECTION_TEXT_MAX_LENGTH;
      }),
    ).toBe(true);
    expect(texts[0]!.startsWith("📉")).toBe(true);
    expect(
      texts[texts.length - 1]!.endsWith(SlackUtil.TRUNCATED_SECTION_NOTE),
    ).toBe(true);
  });

  test("Microsoft Teams: a text block within its budget, ending with the note", () => {
    const text: string = teamsTextOf(markdown);

    expect(text.startsWith("📉")).toBe(true);
    expect(JSON.stringify(text).length * 2).toBeLessThanOrEqual(80 * 1024);
    expect(text.endsWith(MICROSOFT_TEAMS_TRUNCATED_TEXT_NOTE.trim())).toBe(
      true,
    );
  });

  test("Mattermost: a post within its limit", () => {
    expect(MattermostUtil.getMessageText(markdown).length).toBeLessThanOrEqual(
      MattermostUtil.MESSAGE_MAX_LENGTH,
    );
  });
});
