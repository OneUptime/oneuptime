import { EpisodeMemberNouns } from "../../../Types/Episode/EpisodeMembersAdd";
import { JSONObject } from "../../../Types/JSON";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";

/*
 * INCIDENTS OR ALERTS ADDED TO AN EPISODE TOGETHER (EpisodeMembersAdd).
 *
 * Each is added through its member service's own create, so it is the same
 * row, with the same follow-ons on the incident or alert, as one added on
 * its own. The episode's side is written once for all of them: one feed
 * entry and one Slack / Microsoft Teams post that name them all, one
 * recount. A member created with EPISODE_MEMBER_ADDED_TOGETHER_KEY leaves
 * that side to whoever is adding them.
 */

/*
 * miscDataProps on a member's create: one of several added together, so its
 * create writes no entry on the episode and leaves the episode's count and
 * last-added time alone - the batch writes them once. Honoured for root
 * writes only: miscDataProps is part of the public create API, and an API
 * client must not be able to add to an episode without the episode's own
 * entry saying so.
 */
export const EPISODE_MEMBER_ADDED_TOGETHER_KEY: string = "addedTogether";

// How many the episode's entry names one by one; any more are counted after them.
export const MAX_MEMBERS_NAMED_IN_FEED: number = 20;

export interface EpisodeMemberFeedMention {
  // "**Alert ALT-3**", or "**Alert ALT-3** (private alert)".
  subject: MarkdownText;
  // ": <title>", or nothing for a private one.
  titleSuffix: MarkdownText;
}

export default class EpisodeMembersBatch {
  // The miscDataProps a member added together with others is created with.
  public static getMiscDataProps(): JSONObject {
    return {
      [EPISODE_MEMBER_ADDED_TOGETHER_KEY]: true,
    };
  }

  /*
   * Whether a member's create is one of several added together, and so
   * leaves the episode's side to the batch. Root writes only: see
   * EPISODE_MEMBER_ADDED_TOGETHER_KEY.
   */
  public static isAddedTogether(data: {
    props: DatabaseCommonInteractionProps;
    miscDataProps?: JSONObject | undefined;
  }): boolean {
    return (
      data.props.isRoot === true &&
      data.miscDataProps?.[EPISODE_MEMBER_ADDED_TOGETHER_KEY] === true
    );
  }

  /*
   * The episode's one entry for what was added together. One reads exactly
   * as one added on its own does ("**Alert ALT-3** added to episode:
   * Checkout is slow"); several are one entry naming them, in the order they
   * were added. The entry is read by the episode's audience, so each one is
   * named as the member services name it there: by its number, and by its
   * title unless it is private. Empty when nothing was added.
   */
  public static getAddedFeedMarkdown(data: {
    mentions: Array<EpisodeMemberFeedMention>;
    nouns: EpisodeMemberNouns;
  }): string {
    const mentions: Array<EpisodeMemberFeedMention> = data.mentions;

    if (mentions.length === 0) {
      return "";
    }

    if (mentions.length === 1) {
      const mention: EpisodeMemberFeedMention = mentions[0]!;

      return mdText`${mention.subject} added to episode${mention.titleSuffix}`.toString();
    }

    const lines: Array<MarkdownText> = mentions
      .slice(0, MAX_MEMBERS_NAMED_IN_FEED)
      .map((mention: EpisodeMemberFeedMention): MarkdownText => {
        return mdText`${mention.subject}${mention.titleSuffix}`;
      });

    const notNamed: number = mentions.length - lines.length;

    if (notNamed > 0) {
      const noun: string =
        notNamed === 1 ? data.nouns.singular : data.nouns.plural;

      lines.push(mdText`and ${notNamed} more ${noun}`);
    }

    return mdText`**${mentions.length} ${data.nouns.plural}** added to episode:\n\n${FeedMarkdown.bulletList(lines)}`.toString();
  }
}
