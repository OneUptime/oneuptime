import { describe, expect, test } from "@jest/globals";
import EpisodeMembersBatch, {
  EPISODE_MEMBER_ADDED_TOGETHER_KEY,
  EpisodeMemberFeedMention,
  MAX_MEMBERS_NAMED_IN_FEED,
} from "../../../../Server/Utils/Episode/EpisodeMembersBatch";
import {
  ALERT_NOUNS,
  INCIDENT_NOUNS,
} from "../../../../Types/Episode/EpisodeMembersAdd";
import FeedMarkdown, { mdText } from "../../../../Utils/Markdown/FeedMarkdown";

/*
 * The episode's one entry - and its one Slack / Microsoft Teams post - for
 * incidents or alerts added together, and the marker that keeps each
 * member's own create from writing an entry of its own.
 */

/*
 * A mention as the member services build one: the number in bold, then
 * ": <title>" placed as text - or, for a private one, "(private alert)" and
 * no title.
 */
type MentionFunction = (
  label: string,
  title: string,
  isPrivate?: boolean,
) => EpisodeMemberFeedMention;

const mention: MentionFunction = (
  label: string,
  title: string,
  isPrivate?: boolean,
): EpisodeMemberFeedMention => {
  if (isPrivate) {
    return {
      subject: mdText`${mdText`**${label}**`} (private alert)`,
      titleSuffix: FeedMarkdown.empty(),
    };
  }

  return {
    subject: mdText`**${label}**`,
    titleSuffix: mdText`: ${title}`,
  };
};

describe("the episode's entry for what was added together", () => {
  test("one added reads exactly as one added on its own does", () => {
    expect(
      EpisodeMembersBatch.getAddedFeedMarkdown({
        mentions: [mention("Alert ALT-3", "Checkout is slow")],
        nouns: ALERT_NOUNS,
      }),
    ).toBe("**Alert ALT-3** added to episode: Checkout is slow");
  });

  test("several are one entry naming each, in the order they were added", () => {
    expect(
      EpisodeMembersBatch.getAddedFeedMarkdown({
        mentions: [
          mention("Alert ALT-3", "Checkout is slow"),
          mention("Alert ALT-1", "Disk filling up"),
          mention("Alert ALT-2", "Payroll export failing", true),
        ],
        nouns: ALERT_NOUNS,
      }),
    ).toBe(
      [
        "**3 alerts** added to episode:",
        "",
        "- **Alert ALT-3**: Checkout is slow",
        "- **Alert ALT-1**: Disk filling up",
        "- **Alert ALT-2** (private alert)",
      ].join("\n"),
    );
  });

  test("says incidents for incidents", () => {
    expect(
      EpisodeMembersBatch.getAddedFeedMarkdown({
        mentions: [
          mention("Incident INC-7", "Database down"),
          mention("Incident INC-8", "Search down"),
        ],
        nouns: INCIDENT_NOUNS,
      }).split("\n")[0],
    ).toBe("**2 incidents** added to episode:");
  });

  test("names the first 20, and counts the rest after them", () => {
    const mentions: Array<EpisodeMemberFeedMention> = Array.from(
      { length: MAX_MEMBERS_NAMED_IN_FEED + 5 },
      (_value: unknown, index: number): EpisodeMemberFeedMention => {
        return mention(`Alert ALT-${index + 1}`, `Title ${index + 1}`);
      },
    );

    const lines: Array<string> = EpisodeMembersBatch.getAddedFeedMarkdown({
      mentions: mentions,
      nouns: ALERT_NOUNS,
    }).split("\n");

    expect(lines[0]).toBe("**25 alerts** added to episode:");
    // The heading, a blank line, 20 named and the rest counted.
    expect(lines).toHaveLength(2 + MAX_MEMBERS_NAMED_IN_FEED + 1);
    expect(lines[2]).toBe("- **Alert ALT-1**: Title 1");
    expect(lines[21]).toBe("- **Alert ALT-20**: Title 20");
    expect(lines[22]).toBe("- and 5 more alerts");
  });

  test("one more than it names is counted in the singular", () => {
    const mentions: Array<EpisodeMemberFeedMention> = Array.from(
      { length: MAX_MEMBERS_NAMED_IN_FEED + 1 },
      (_value: unknown, index: number): EpisodeMemberFeedMention => {
        return mention(`Incident INC-${index + 1}`, `Title ${index + 1}`);
      },
    );

    const lines: Array<string> = EpisodeMembersBatch.getAddedFeedMarkdown({
      mentions: mentions,
      nouns: INCIDENT_NOUNS,
    }).split("\n");

    expect(lines[lines.length - 1]).toBe("- and 1 more incident");
  });

  test("exactly 20 are all named, with nothing counted", () => {
    const markdown: string = EpisodeMembersBatch.getAddedFeedMarkdown({
      mentions: Array.from(
        { length: MAX_MEMBERS_NAMED_IN_FEED },
        (_value: unknown, index: number): EpisodeMemberFeedMention => {
          return mention(`Alert ALT-${index + 1}`, `Title ${index + 1}`);
        },
      ),
      nouns: ALERT_NOUNS,
    });

    expect(markdown).not.toContain("more alert");
    expect(markdown.split("\n")).toHaveLength(2 + MAX_MEMBERS_NAMED_IN_FEED);
  });

  test("nothing added is no entry", () => {
    expect(
      EpisodeMembersBatch.getAddedFeedMarkdown({
        mentions: [],
        nouns: ALERT_NOUNS,
      }),
    ).toBe("");
  });

  test("a title is placed as text: no image, link, mention or emphasis", () => {
    const markdown: string = EpisodeMembersBatch.getAddedFeedMarkdown({
      mentions: [
        mention(
          "Alert ALT-1",
          "![x](https://tracker.example/p.png) <!channel> [Reset](https://evil.example) *bold*",
        ),
        mention("Alert ALT-2", "Plain"),
      ],
      nouns: ALERT_NOUNS,
    });

    expect(markdown).toContain(
      "- **Alert ALT-1**: !\\[x\\](https://tracker.example/p.png)",
    );
    expect(markdown).not.toContain("![x](");
    expect(markdown).not.toContain("[Reset](");
    expect(markdown).not.toContain("<!channel>");
    expect(markdown).not.toContain(" *bold*");
  });
});

describe("a member added together with others", () => {
  test("is created with the marker the member services read", () => {
    expect(EpisodeMembersBatch.getMiscDataProps()).toEqual({
      [EPISODE_MEMBER_ADDED_TOGETHER_KEY]: true,
    });
  });

  test("leaves the episode's side to the batch only when OneUptime writes it", () => {
    expect(
      EpisodeMembersBatch.isAddedTogether({
        props: { isRoot: true },
        miscDataProps: EpisodeMembersBatch.getMiscDataProps(),
      }),
    ).toBe(true);
  });

  test("an API client cannot skip the episode's entry by sending the marker", () => {
    expect(
      EpisodeMembersBatch.isAddedTogether({
        props: {},
        miscDataProps: EpisodeMembersBatch.getMiscDataProps(),
      }),
    ).toBe(false);

    expect(
      EpisodeMembersBatch.isAddedTogether({
        props: { isRoot: false, isMasterAdmin: true },
        miscDataProps: EpisodeMembersBatch.getMiscDataProps(),
      }),
    ).toBe(false);
  });

  test("anything but true is no marker", () => {
    for (const value of ["true", 1, null, undefined, {}]) {
      expect(
        EpisodeMembersBatch.isAddedTogether({
          props: { isRoot: true },
          miscDataProps: {
            [EPISODE_MEMBER_ADDED_TOGETHER_KEY]: value as never,
          },
        }),
      ).toBe(false);
    }

    expect(
      EpisodeMembersBatch.isAddedTogether({ props: { isRoot: true } }),
    ).toBe(false);
  });
});
