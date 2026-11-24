import DataMigrationService from "../../Services/DataMigrationService";
import logger from "../Logger";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import DataMigration from "../../../Models/DatabaseModels/DataMigration";
import OnCallPageLinkToken, {
  ON_CALL_PAGE_LINK_TOKEN_EXPIRES_IN_SECONDS,
} from "./OnCallPageLinkToken";

/*
 * WHAT LETS A LINK IN A PERSON'S OWN PAGE ACKNOWLEDGE IT (#10025).
 *
 * Acknowledging a page stops it: nobody else is paged, and the record shows
 * who took it. So the press that acknowledges must come from the person the
 * page was sent to - knowing a notification's id is not enough. Its id is
 * in the address of every link and call about it, in Twilio's request logs,
 * and in what people who may read the on-call policy can read. Escalating
 * has asked for the page's own token (OnCallPageLinkToken) since it was
 * made; acknowledging asks for it too now. Every link OneUptime sends that
 * leads to Acknowledge carries it, an email's included, and the page's
 * Acknowledge button sends it on in its form.
 *
 * Links sent before this release carry none: an email's Acknowledge, and
 * the button of an acknowledge page drawn before it. They go on working for
 * a page sent before this server was upgraded, for a week after it was sent
 * - as long as a page's token lasts, and longer than any page goes on. The
 * upgrade is the moment this server first ran the data migration
 * ON_CALL_ACKNOWLEDGE_TOKEN_MIGRATION_NAME (Workers/DataMigrations), as the
 * DataMigrations table records it, with an hour more for a rolling upgrade,
 * while a server of the release before may still be sending links without
 * a token. Until that is recorded - the upgrade is still under way - such a
 * link works as it always did. A week and an hour after the upgrade, no page
 * is left that a link without a token acknowledges.
 */

export enum OnCallAcknowledgeLinkProof {
  // The page's own token, signed for this notification, that has not expired.
  PageToken = "PageToken",
  // No token, on a page sent before the upgrade: for a week after it was sent.
  SentBeforeTokens = "SentBeforeTokens",
  // Neither: the link acknowledges nothing.
  None = "None",
}

/*
 * The data migration whose first run on this server is the upgrade: it
 * changes no data, and the runner records when it ran.
 */
export const ON_CALL_ACKNOWLEDGE_TOKEN_MIGRATION_NAME: string =
  "RequireTokenToAcknowledgeOnCallPages";

// How long a link without a token acknowledges a page sent before the upgrade.
export const ON_CALL_LINK_WITHOUT_TOKEN_LIFETIME_MS: number =
  ON_CALL_PAGE_LINK_TOKEN_EXPIRES_IN_SECONDS * 1000;

/*
 * While an upgrade rolls out, a server of the release before can still be
 * sending links without a token: a page sent this long after the upgrade
 * was recorded counts as sent before it.
 */
export const ON_CALL_LINK_TOKEN_ROLLOUT_MS: number = 60 * 60 * 1000;

// How long a process goes by what it last found of the upgrade, before it asks again.
export const ON_CALL_LINK_TOKEN_UPGRADE_CHECK_TTL_MS: number = 60 * 1000;

export default class OnCallAcknowledgeLink {
  private static upgrade: {
    at: Date | null;
    checkedAt: number;
  } | null = null;

  /*
   * What lets this link acknowledge the notification: its token, a page
   * sent before the upgrade - or nothing.
   */
  public static async getProof(data: {
    token: unknown;
    userOnCallLogTimelineId: ObjectID;
    // When the notification was sent: its row's createdAt.
    sentAt: Date | string | null | undefined;
  }): Promise<OnCallAcknowledgeLinkProof> {
    if (
      OnCallPageLinkToken.isValid({
        token: data.token,
        userOnCallLogTimelineId: data.userOnCallLogTimelineId,
      })
    ) {
      return OnCallAcknowledgeLinkProof.PageToken;
    }

    if (await OnCallAcknowledgeLink.isSentBeforeTokens(data.sentAt)) {
      return OnCallAcknowledgeLinkProof.SentBeforeTokens;
    }

    return OnCallAcknowledgeLinkProof.None;
  }

  /*
   * Whether a page sent at `sentAt` was sent before this server's links
   * carried a token, and less than a week ago.
   */
  public static async isSentBeforeTokens(
    sentAt: Date | string | null | undefined,
  ): Promise<boolean> {
    const sentAtMs: number = sentAt ? new Date(sentAt).getTime() : NaN;

    if (!Number.isFinite(sentAtMs)) {
      return false;
    }

    const now: number = OneUptimeDate.getCurrentDate().getTime();

    if (now - sentAtMs > ON_CALL_LINK_WITHOUT_TOKEN_LIFETIME_MS) {
      return false;
    }

    const upgradedAt: Date | null = await OnCallAcknowledgeLink.getUpgradedAt();

    // The upgrade is still under way: links work as they always did.
    if (!upgradedAt) {
      return true;
    }

    return sentAtMs < upgradedAt.getTime() + ON_CALL_LINK_TOKEN_ROLLOUT_MS;
  }

  /*
   * When this server was upgraded to links that carry the page's token: the
   * first run of ON_CALL_ACKNOWLEDGE_TOKEN_MIGRATION_NAME, or null while it
   * has not run. Once found it never changes, so it is asked of the
   * database once; until then, at most once a minute per process. A
   * question the database does not answer counts as not yet: an upgrade
   * must not lock anyone out of a page they were sent before it.
   */
  public static async getUpgradedAt(): Promise<Date | null> {
    const now: number = Date.now();
    const known: { at: Date | null; checkedAt: number } | null =
      OnCallAcknowledgeLink.upgrade;

    if (
      known &&
      (known.at ||
        now - known.checkedAt < ON_CALL_LINK_TOKEN_UPGRADE_CHECK_TTL_MS)
    ) {
      return known.at;
    }

    let at: Date | null = null;

    try {
      const migration: DataMigration | null =
        await DataMigrationService.findOneBy({
          query: {
            name: ON_CALL_ACKNOWLEDGE_TOKEN_MIGRATION_NAME,
            executed: true,
          },
          select: {
            executedAt: true,
            createdAt: true,
          },
          sort: {
            executedAt: SortOrder.Ascending,
          },
          props: {
            isRoot: true,
          },
        });

      const recordedAt: Date | undefined =
        migration?.executedAt || migration?.createdAt;
      const recordedAtMs: number = recordedAt
        ? new Date(recordedAt).getTime()
        : NaN;

      at = Number.isFinite(recordedAtMs) ? new Date(recordedAtMs) : null;
    } catch (err) {
      logger.error(
        "OnCallAcknowledgeLink: could not read when this server was upgraded to on-call links that carry the page's token; a link without one acknowledges a page sent less than a week ago until it can:",
      );
      logger.error(err);
    }

    OnCallAcknowledgeLink.upgrade = { at: at, checkedAt: now };

    return at;
  }

  // Forgets what was found, so the next question asks the database: for tests.
  public static forget(): void {
    OnCallAcknowledgeLink.upgrade = null;
  }
}
