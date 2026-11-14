import DataMigrationBase from "./DataMigrationBase";
import {
  NotificationsSettledBeforeTheCheckSummary,
  settleNotificationsStuckBeforeTheCheck,
} from "Common/Server/Utils/OnCall/OnCallStuckNotifications";
import logger from "Common/Server/Utils/Logger";

/*
 * Settles, once, every on-call notification (UserOnCallLogTimeline) left at
 * Sending from before the check for notifications that never got a result
 * existed (issue #7085).
 *
 * That check (OnCallStuckNotifications, run every five minutes by the worker
 * job SettleStuckNotifications) reads the last day only, so it stays cheap.
 * A notification stuck at Sending longer ago than that - on a server that
 * ran before the check, through a Notification service restart - is never
 * read by it, and said Sending for ever on the person's on-call timeline and
 * in the policy's execution log. This writes Error on each, with the check's
 * own words ("Sending did not finish within 15 minutes, so this notification
 * may not have been sent."), without hooks - their pages are long over, so
 * no feed line and no chat message is written about them now - over Sending
 * only, page by page (settleNotificationsStuckBeforeTheCheck).
 *
 * Since issue #7290 every run of the check also settles those written
 * before its look-back, so a notification the workers left behind while
 * they were down for a day is settled when they come back. This migration
 * settles the backlog at once, as the server is upgraded; it is kept for
 * the servers that have not run it yet.
 *
 * Postgres only. Idempotent: a second run finds none to settle.
 */
export default class SettleOnCallNotificationsStuckBeforeUpgrade extends DataMigrationBase {
  public constructor() {
    super("SettleOnCallNotificationsStuckBeforeUpgrade");
  }

  public override async migrate(): Promise<void> {
    const summary: NotificationsSettledBeforeTheCheckSummary =
      await settleNotificationsStuckBeforeTheCheck();

    logger.info(
      `SettleOnCallNotificationsStuckBeforeUpgrade: ${summary.settled} on-call notification(s) left Sending before the upgrade settled as not sent, in ${summary.statements} statement(s).`,
    );
  }

  public override async rollback(): Promise<void> {
    /*
     * Nothing to undo: what they said - Sending - was never true of a
     * notification no result would ever come for.
     */
    return;
  }
}
