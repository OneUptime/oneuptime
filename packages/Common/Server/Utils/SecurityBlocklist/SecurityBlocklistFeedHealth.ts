import SecurityBlocklistFeed from "../../../Models/DatabaseModels/SecurityBlocklistFeed";
import { DashboardClientUrl } from "../../EnvironmentConfig";
import ProjectService from "../../Services/ProjectService";
import SecurityBlocklistFeedFetchService from "../../Services/SecurityBlocklistFeedFetchService";
import SecurityBlocklistFeedService from "../../Services/SecurityBlocklistFeedService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import URL from "../../../Types/API/URL";
import PartialEntity from "../../../Types/Database/PartialEntity";
import OneUptimeDate from "../../../Types/Date";
import { NO_BREAK_SPACE } from "../../../Types/NoBreakSpaces";
import ObjectID from "../../../Types/ObjectID";
import SafeHtml from "../../../Types/SafeHtml";
import {
  getSecurityBlocklistFeedUsualIntervalInMs,
  hasSecurityBlocklistFeedStoppedReading,
} from "../../../Types/SecurityBlocklist/SecurityBlocklistFeed";

/*
 * A FIREWALL THAT STOPS READING ITS FEED IS A PROBLEM (#10345).
 *
 * Every few minutes (SecurityBlocklist:CheckFeedsAreRead), for each feed a
 * firewall has fetched: how often it usually fetches it - the median gap
 * between its latest fetches, kept on the feed for its page and the
 * Blocklist's - and whether it has stopped: no fetch for three times that,
 * and never sooner than a block's confirmation lasts (ten minutes). Until
 * it reads the feed again its blocks are not enforced there, and the feed's
 * page and the Blocklist say so.
 *
 * The project's owners are told once each time it stops, by email - the
 * one the product sends them about everything that stopped working on its
 * own - in one compare-and-set on the feed (stoppedReadingToldAt), so two
 * servers never both tell them. The next fetch clears it
 * (SecurityBlocklistFeedServe), so a firewall that stops again is reported
 * again. A feed whose secret was revoked was stopped on purpose, and is not
 * reported.
 */

// The most feeds one pass looks at.
export const SECURITY_BLOCKLIST_FEED_HEALTH_MAX_FEEDS: number = 10000;

export interface SecurityBlocklistFeedHealthResult {
  checked: number;
  told: number;
}

// "3 hours", "45 minutes", "2 days": how long, in the English an email reads, the figure held to its word.
export function describeSecurityBlocklistFeedDuration(ms: number): string {
  const minutes: number = Math.max(1, Math.round(ms / (60 * 1000)));

  if (minutes < 120) {
    return `${minutes}${NO_BREAK_SPACE}${minutes === 1 ? "minute" : "minutes"}`;
  }

  const hours: number = Math.round(minutes / 60);

  if (hours < 48) {
    return `${hours}${NO_BREAK_SPACE}hours`;
  }

  const days: number = Math.round(hours / 24);

  return `${days}${NO_BREAK_SPACE}days`;
}

export default class SecurityBlocklistFeedHealth {
  /*
   * One pass over every feed a firewall has fetched. Never throws for one
   * feed: the next is checked all the same.
   */
  @CaptureSpan()
  public static async checkFeeds(
    now?: Date | undefined,
  ): Promise<SecurityBlocklistFeedHealthResult> {
    const at: Date = now || OneUptimeDate.getCurrentDate();

    const feeds: Array<SecurityBlocklistFeed> =
      await SecurityBlocklistFeedService.findBy({
        query: { lastFetchedAt: QueryHelper.notNull() },
        select: {
          _id: true,
          projectId: true,
          name: true,
          // Until its usual interval is known, it is held to its firewall's.
          firewall: true,
          // Whether it has a secret: its hint is there exactly while it does.
          secretHint: true,
          lastFetchedAt: true,
          usualFetchIntervalInSeconds: true,
          stoppedReadingToldAt: true,
        },
        skip: 0,
        limit: SECURITY_BLOCKLIST_FEED_HEALTH_MAX_FEEDS,
        props: { isRoot: true },
      });

    const result: SecurityBlocklistFeedHealthResult = {
      checked: 0,
      told: 0,
    };

    for (const feed of feeds) {
      try {
        result.checked++;

        if (await this.checkFeed({ feed, now: at })) {
          result.told++;
        }
      } catch (error) {
        logger.error(
          `SecurityBlocklistFeedHealth: could not check feed ${feed.id?.toString() || ""}; the next pass checks it again.`,
        );
        logger.error(error);
      }
    }

    return result;
  }

  /*
   * One feed: its usual interval, kept when it moved, and whether its
   * owners are to be told it stopped. Answers whether they were told now.
   */
  @CaptureSpan()
  public static async checkFeed(data: {
    feed: SecurityBlocklistFeed;
    now: Date;
  }): Promise<boolean> {
    const { feed } = data;

    if (!feed.id || !feed.projectId || !feed.lastFetchedAt) {
      return false;
    }

    const usualIntervalInMs: number | null =
      getSecurityBlocklistFeedUsualIntervalInMs(
        await SecurityBlocklistFeedFetchService.findLatestFetchTimes(feed.id),
      );
    const usualIntervalInSeconds: number | null =
      usualIntervalInMs === null ? null : Math.round(usualIntervalInMs / 1000);

    if ((feed.usualFetchIntervalInSeconds ?? null) !== usualIntervalInSeconds) {
      await SecurityBlocklistFeedService.updateColumnsByIdWithoutHooks({
        id: feed.id,
        data: {
          usualFetchIntervalInSeconds: usualIntervalInSeconds,
        } as unknown as PartialEntity<SecurityBlocklistFeed>,
      });
    }

    // Revoked on purpose: nothing stopped working.
    if (!feed.secretHint || feed.stoppedReadingToldAt) {
      return false;
    }

    if (
      !hasSecurityBlocklistFeedStoppedReading({
        lastFetchedAt: feed.lastFetchedAt,
        usualIntervalInMs,
        firewall: feed.firewall,
        now: data.now,
      })
    ) {
      return false;
    }

    // One server tells them: the one whose claim lands.
    const isClaimed: boolean =
      await SecurityBlocklistFeedService.compareAndSetColumnsByIdWithoutHooks({
        id: feed.id,
        data: {
          stoppedReadingToldAt: data.now,
        } as unknown as PartialEntity<SecurityBlocklistFeed>,
        expectedData: {
          stoppedReadingToldAt: null,
          lastFetchedAt: feed.lastFetchedAt,
        } as unknown as PartialEntity<SecurityBlocklistFeed>,
      });

    if (!isClaimed) {
      return false;
    }

    await ProjectService.sendEmailToProjectOwners(
      feed.projectId,
      this.getSubject(feed.name || ""),
      this.getHtml({
        projectId: feed.projectId,
        feedId: feed.id,
        feedName: feed.name || "",
        lastFetchedAt: new Date(feed.lastFetchedAt),
        usualIntervalInMs,
        now: data.now,
      }),
    );

    return true;
  }

  public static getSubject(feedName: string): string {
    return `Your firewall stopped reading the blocklist feed ${feedName.trim() || "of your project"}`;
  }

  /*
   * The email's body, as HTML the owners' email places in its message: which
   * feed, since when, what that means for the blocks, what to check, and
   * the feed's page.
   */
  public static getHtml(data: {
    projectId: ObjectID;
    feedId: ObjectID;
    feedName: string;
    lastFetchedAt: Date;
    usualIntervalInMs: number | null;
    now: Date;
  }): string {
    const since: string = describeSecurityBlocklistFeedDuration(
      data.now.getTime() - data.lastFetchedAt.getTime(),
    );

    const paragraphs: Array<string> = [
      SafeHtml.escape(
        `Your firewall stopped reading the blocklist feed ${data.feedName.trim()} ${since} ago${
          data.usualIntervalInMs
            ? `, though it usually reads it every ${describeSecurityBlocklistFeedDuration(data.usualIntervalInMs)}`
            : ""
        }. Blocks made since then are not enforced there, and OneUptime cannot confirm the ones it holds until it reads the feed again.`,
      ),
      SafeHtml.escape(
        "Check that the firewall can still reach OneUptime, and that it still has the feed's secret: a secret replaced more than a day ago no longer works.",
      ),
    ];

    const link: URL | null = this.getFeedLink(data.projectId, data.feedId);

    if (link) {
      const text: string = SafeHtml.escape(link.toString());

      paragraphs.push(
        `${SafeHtml.escape("The feed's page shows every fetch:")} <br/> <a href="${text}">${text}</a>`,
      );
    }

    paragraphs.push(
      SafeHtml.escape(
        "Project Owners get this email once each time a firewall stops reading a feed.",
      ),
    );

    return paragraphs.join(" <br/> <br/> ");
  }

  // The feed's page, or null when the dashboard's address is not configured.
  public static getFeedLink(projectId: ObjectID, feedId: ObjectID): URL | null {
    if (!DashboardClientUrl || !DashboardClientUrl.hostname?.toString()) {
      return null;
    }

    return URL.fromString(DashboardClientUrl.toString()).addRoute(
      `/${projectId.toString()}/security-events/blocklist/feeds/${feedId.toString()}`,
    );
  }
}
