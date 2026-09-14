import GlobalCache from "../../Infrastructure/GlobalCache";
import logger from "../Logger";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";

/*
 * Why this file exists.
 *
 * The auto-recharge paths in NotificationService and AIBillingService run
 * inline on every notification attempt, so when a card is declined they used
 * to mail every project owner once per paging attempt - a genuine mail bomb
 * arriving during the exact outage the pages were about.
 *
 * The obvious fix - gate the mail on the project's existing
 * failed...NotificationSentToOwners boolean, which is only cleared by a
 * SUCCESSFUL recharge - trades a storm for something worse: permanent silence.
 * A project with no payment method mails once and latches; the owner adds a
 * card; the card is declined; the recharge can therefore never succeed, so the
 * latch can never clear, and the owner is never told the new card failed. SMS
 * and voice paging simply stops working and nobody hears about it.
 *
 * So this is a WINDOW, not a latch. At most one failure notice per project per
 * day, per kind of failure, and the window expires on its own whether or not
 * anything is ever fixed. A storm collapses to one email a day; a new and
 * newly-actionable failure is still reported within a day.
 *
 * It FAILS OPEN. If Redis is unreachable the notice is sent, which is the same
 * behaviour the product had before any of this existed. Failing closed would
 * mean a Redis blip could silently suppress "we cannot page anyone for you",
 * and there is no worse thing for a monitoring product to lose.
 */

const BILLING_FAILURE_NOTICE_NAMESPACE: string = "billing-failure-notice";

export enum BillingFailureNoticeKind {
  SmsAndCallRechargeFailed = "sms-and-call-recharge-failed",
  AiCreditRechargeFailed = "ai-credit-recharge-failed",
}

export type ShouldSendBillingFailureNoticeFunction = (data: {
  projectId: ObjectID;
  kind: BillingFailureNoticeKind;
}) => Promise<boolean>;

/*
 * Claims the day's window for this (project, kind). True means "you own it,
 * send the email"; false means somebody already told them today.
 */
export const shouldSendBillingFailureNotice: ShouldSendBillingFailureNoticeFunction =
  async (data: {
    projectId: ObjectID;
    kind: BillingFailureNoticeKind;
  }): Promise<boolean> => {
    const key: string = `${data.projectId.toString()}-${data.kind}`;

    try {
      /*
       * SET NX rather than read-then-write: several notification attempts
       * failing at once is the normal case here, not the edge one, and a
       * check-then-act would let every one of them decide it was first.
       */
      return await GlobalCache.setStringIfNotExists(
        BILLING_FAILURE_NOTICE_NAMESPACE,
        key,
        ObjectID.generate().toString(),
        {
          expiresInSeconds: OneUptimeDate.getSecondsInDays(1),
        },
      );
    } catch (err) {
      logger.warn(
        `Billing failure notice throttle: the shared cache is unavailable, so the 24h window for project ${data.projectId.toString()} (${
          data.kind
        }) is not enforced. Sending, because a suppressed billing failure is worse than a duplicated one.`,
      );
      logger.warn(err);

      return true;
    }
  };
