import SecurityBlocklistFeed from "../../../Models/DatabaseModels/SecurityBlocklistFeed";
import SecurityBlocklistFeedService from "../../Services/SecurityBlocklistFeedService";
import SecurityBlockDestination, {
  SecurityBlockCapacity,
  SecurityBlockEntry,
  SecurityBlockHeldItem,
  SecurityBlockSupport,
  SecurityBlockWriteResult,
} from "./SecurityBlockDestination";
import ObjectID from "../../../Types/ObjectID";
import {
  SecurityBlockAction,
  SecurityBlockIndicatorType,
  SecurityBlockValue,
  readSecurityBlockValue,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import { SecurityBlockDestinationProvider } from "../../../Types/SecurityBlocklist/SecurityBlockEnforcement";
import {
  SecurityBlocklistFeedFamily,
  getSecurityBlocklistFeedFamilyRefusal,
} from "../../../Types/SecurityBlocklist/SecurityBlocklistFeed";

/*
 * A BLOCKLIST FEED AS A DESTINATION OF THE BLOCKLIST (#10345).
 *
 * Every other destination is pushed to: the reconciler writes a block to
 * Cloudflare's list or an AWS WAF IP set, then reads the list back. A feed
 * is pulled: the firewall fetches the list when it likes, and holds what it
 * fetched until it fetches again. So:
 *
 *   apply, remove  ask nothing of anyone, and are always done: the feed
 *                  serves every active block it can hold, and nothing else,
 *                  from the very next fetch (SecurityBlocklistFeedServe);
 *   readBack       is what the firewall fetched last - the entries of the
 *                  last list the feed answered it with, confirmed at that
 *                  fetch (servedConfirmedAt), never at the time of the read.
 *
 * So a block is Applied at a feed only once a firewall has fetched a list
 * that holds it, and the reconciler never counts a fetch from before the
 * block was made (a value the firewall still holds from an earlier block of
 * it). Its confirmation is that fetch: when the firewall stops fetching, it
 * goes stale ten minutes later, like any destination that stops answering,
 * and the block is no longer enforced there. A lifted block stays Removing
 * until the firewall fetches a list without it.
 *
 * A feed cannot challenge, serves IP addresses and ranges only, and serves
 * only the families it is set to: each block it cannot hold says why on its
 * row. It holds as many entries as the blocklist has (the firewall's own
 * limits are in each vendor's guide).
 */

export const SECURITY_BLOCKLIST_FEED_DESTINATION_KEY_PREFIX: string = "Feed:";

export function getSecurityBlocklistFeedDestinationKey(feedId: ObjectID): string {
  return `${SECURITY_BLOCKLIST_FEED_DESTINATION_KEY_PREFIX}${feedId.toString()}`;
}

export default class SecurityBlocklistFeedDestination
  implements SecurityBlockDestination
{
  public readonly key: string;
  public readonly provider: SecurityBlockDestinationProvider =
    SecurityBlockDestinationProvider.Feed;
  public readonly name: string;
  public readonly connectionId: ObjectID;

  private readonly feedId: ObjectID;
  private readonly family: SecurityBlocklistFeedFamily;

  public constructor(feed: {
    id: ObjectID;
    name: string;
    family?: SecurityBlocklistFeedFamily | undefined | null;
  }) {
    this.feedId = feed.id;
    this.key = getSecurityBlocklistFeedDestinationKey(feed.id);
    this.name = (feed.name || "Blocklist feed").slice(0, 100);
    this.connectionId = feed.id;
    this.family = feed.family || SecurityBlocklistFeedFamily.Both;
  }

  public supports(entry: {
    indicatorType: SecurityBlockIndicatorType;
    action: SecurityBlockAction;
    value: string;
  }): SecurityBlockSupport {
    // A firewall blocks what is on the list: it has no way to ask a visitor to prove they are a person.
    if (entry.action === SecurityBlockAction.Challenge) {
      return { isSupported: false, reason: `${this.name} cannot challenge` };
    }

    const read: SecurityBlockValue | null = readSecurityBlockValue(entry.value);

    if (
      !read ||
      (entry.indicatorType !== SecurityBlockIndicatorType.IpAddress &&
        entry.indicatorType !== SecurityBlockIndicatorType.IpRange)
    ) {
      return {
        isSupported: false,
        reason: `${this.name} serves IP addresses and ranges only`,
      };
    }

    const refusal: string | null = getSecurityBlocklistFeedFamilyRefusal({
      feedName: this.name,
      family: this.family,
      value: read.value,
    });

    return refusal ? { isSupported: false, reason: refusal } : { isSupported: true };
  }

  public async capacity(): Promise<SecurityBlockCapacity> {
    return { limit: null };
  }

  // Served from the next fetch: nothing to ask the firewall.
  public async apply(
    entries: Array<SecurityBlockEntry>,
  ): Promise<Array<SecurityBlockWriteResult>> {
    return entries.map((entry: SecurityBlockEntry): SecurityBlockWriteResult => {
      return { value: entry.value, action: entry.action, isDone: true };
    });
  }

  // Gone from the next fetch: nothing to ask the firewall.
  public async remove(
    items: Array<SecurityBlockHeldItem>,
  ): Promise<Array<SecurityBlockWriteResult>> {
    return items.map((item: SecurityBlockHeldItem): SecurityBlockWriteResult => {
      return { value: item.value, action: item.action, isDone: true };
    });
  }

  /*
   * What the firewall holds: the entries of the last list it fetched, each
   * confirmed at that fetch. Nothing before its first fetch.
   */
  public async readBack(): Promise<Array<SecurityBlockHeldItem>> {
    const feed: SecurityBlocklistFeed | null =
      await SecurityBlocklistFeedService.findOneById({
        id: this.feedId,
        select: { _id: true, servedValues: true, servedConfirmedAt: true },
        props: { isRoot: true },
      });

    if (!feed || !feed.servedConfirmedAt || !Array.isArray(feed.servedValues)) {
      return [];
    }

    const confirmedAt: Date = new Date(feed.servedConfirmedAt);
    const held: Array<SecurityBlockHeldItem> = [];

    for (const value of feed.servedValues) {
      const read: SecurityBlockValue | null = readSecurityBlockValue(value);

      if (read) {
        held.push({
          value: read.value,
          action: SecurityBlockAction.Block,
          confirmedAt,
        });
      }
    }

    return held;
  }

  /*
   * The project's feeds, each a destination: what SecurityBlockDestinations
   * asks this kind of destination for.
   */
  public static async findForProject(
    projectId: ObjectID,
  ): Promise<Array<SecurityBlockDestination>> {
    const feeds: Array<SecurityBlocklistFeed> =
      await SecurityBlocklistFeedService.findForProject(projectId);

    return feeds
      .filter((feed: SecurityBlocklistFeed): boolean => {
        return Boolean(feed.id);
      })
      .map((feed: SecurityBlocklistFeed): SecurityBlockDestination => {
        return new SecurityBlocklistFeedDestination({
          id: feed.id!,
          name: feed.name || "",
          family: feed.family,
        });
      });
  }
}
