import UserOnCallLogTimeline from "../../../Models/DatabaseModels/UserOnCallLogTimeline";
import UserOnCallLogTimelineService from "../../Services/UserOnCallLogTimelineService";
import ColumnLength from "../../../Types/Database/ColumnLength";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";

/*
 * What a person's on-call timeline says of one notification of a page
 * (UserOnCallLogTimeline), as the message sent for it moves on. Several
 * write it at about the same time:
 *
 *  - the send, once the provider has answered it - every channel's sender
 *    (SmsService, WhatsAppService, CallService, MailService,
 *    TelegramService, WebhookService, PushNotificationService,
 *    WorkspaceUserNotificationService, the Enterprise custom channel's
 *    CustomChannelSender) and a send refused before it went out
 *    (UserOnCallLogTimelineService.markNotSent): Sent, or Error;
 *  - the provider's report of how the message ended (API/SMS.ts,
 *    API/WhatsApp.ts, API/Call.ts, ExpoPushReceiptService), which can land
 *    before the send's own write - Twilio calls back within milliseconds;
 *  - the page's own request to the Notification service, when it failed
 *    or was answered with an error (OnCallSendFailure): Error;
 *  - the check for notifications that never got a result
 *    (OnCallStuckNotifications): Error, after STUCK_NOTIFICATION_AFTER_MINUTES;
 *  - the person, who answers the page meanwhile: acknowledges it from this
 *    message or another (UserOnCallLogTimelineAPI, CustomChannelActions), or
 *    escalates it from this one (OnCallPagePassOn).
 *
 * Each writes only while the notification still has a status it may move
 * on from, in the same statement as the check: the update names the
 * notification at the version read (DatabaseService's compare-and-set), and
 * one that finds it changed reads it again and decides again. So none of
 * them undoes another: a failed delivery written first is never put back to
 * Sent by the send, and an acknowledgement or an escalation is never written
 * over by a send that finished late (issue #7082).
 *
 * Written through the full update pipeline: the notification's own hooks
 * tell the record's feed, the run's chat message and the time to send
 * (UserOnCallLogTimelineService).
 */

// How many times a write reads the notification again when it changed under it.
export const MAX_NOTIFICATION_WRITE_ATTEMPTS: number = 3;

/*
 * What the send moves on from: only Sending, as the notification was
 * written just before it. Anything else was written by someone who knows
 * more - the provider's report, the person's acknowledgement.
 */
export const SEND_RESULT_MOVES_ON_FROM: ReadonlyArray<UserNotificationStatus> =
  [UserNotificationStatus.Sending];

/*
 * What a provider's report moves on from: a notification still only sent,
 * or still going out. Never an acknowledgement, an escalation from it, a
 * skip, or an error or a call not answered written already.
 */
export const PROVIDER_REPORT_MOVES_ON_FROM: ReadonlyArray<UserNotificationStatus> =
  [UserNotificationStatus.Sent, UserNotificationStatus.Sending];

// What a notification the person acknowledged the page from says.
export const ON_CALL_NOTIFICATION_ACKNOWLEDGED_MESSAGE: string =
  "Notification Acknowledged";

// What an observer's notification says once they said they have seen it (OnCallObserverPage).
export const ON_CALL_OBSERVER_NOTIFICATION_SEEN_MESSAGE: string =
  "Marked as seen, paged as an observer";

/*
 * What a press of Acknowledge is told when the acknowledgement could not be
 * written, and the page is not answered either: the notification kept
 * changing under every try. Nothing was acknowledged; pressing again does.
 */
export const ON_CALL_NOTIFICATION_NOT_ACKNOWLEDGED_MESSAGE: string =
  "This notification could not be acknowledged just now. Please try again.";

/*
 * The same, said by a call whose 1 could not acknowledge the page. The call
 * ends with it, so the person cannot press again there.
 */
export const ON_CALL_CALL_NOT_ACKNOWLEDGED_SAY_MESSAGE: string =
  "This page could not be acknowledged just now. Please acknowledge it from the dashboard. Good bye.";

/*
 * What the person's acknowledgement from this notification moves on from:
 * whatever its send or its provider wrote - Sending, Sent, an Error, a call
 * Not Answered - and an escalation from it. Taking a page after all, once
 * it was escalated, is an answer too: the acknowledge page still offers it
 * (OnCallAcknowledgePage), and the latest answer is the one that stands.
 * Never an acknowledgement written already - a page is acknowledged once
 * from a message - nor a skip.
 */
export const ACKNOWLEDGEMENT_MOVES_ON_FROM: ReadonlyArray<UserNotificationStatus> =
  [
    UserNotificationStatus.Sending,
    UserNotificationStatus.Sent,
    UserNotificationStatus.Error,
    UserNotificationStatus.NotAnswered,
    UserNotificationStatus.PassedOn,
  ];

/*
 * What escalating the page from this notification moves on from: whatever
 * its send or its provider wrote. Never an acknowledgement - the person's
 * own answer stands - nor an escalation written already, nor a skip.
 */
export const PASS_ON_MOVES_ON_FROM: ReadonlyArray<UserNotificationStatus> = [
  UserNotificationStatus.Sending,
  UserNotificationStatus.Sent,
  UserNotificationStatus.Error,
  UserNotificationStatus.NotAnswered,
];

/*
 * How long a notification may say Sending before the stuck check settles
 * it (OnCallStuckNotifications). A send takes seconds; the longest any
 * sender waits on its provider is a few minutes.
 */
export const STUCK_NOTIFICATION_AFTER_MINUTES: number = 15;

/*
 * What the stuck check writes, with Error: no result came back, so the
 * notification may well not have gone out. A send that finishes after all
 * writes its own result over it (recordSendResult).
 */
export const STUCK_NOTIFICATION_STATUS_MESSAGE: string = `Sending did not finish within ${STUCK_NOTIFICATION_AFTER_MINUTES} minutes, so this notification may not have been sent.`;

/*
 * Whether a notification holds the stuck check's own verdict - and only
 * that: an Error with any other message was written by someone who knew
 * why.
 */
export function isSettledAsStuck(notification: {
  status?: UserNotificationStatus | undefined;
  statusMessage?: string | undefined;
}): boolean {
  return (
    notification.status === UserNotificationStatus.Error &&
    notification.statusMessage === STUCK_NOTIFICATION_STATUS_MESSAGE
  );
}

/*
 * Writes the notification's status - when one is given - and message,
 * while it still has one of `from`, or - with `orSettledAsStuck` - while it
 * holds the stuck check's verdict, at the version read. With
 * `acknowledgedAt`, it is written as acknowledged then, in the same
 * statement: the notification's update hook acknowledges the page
 * (UserOnCallLogTimelineService). Whether it was written: false when the
 * notification is gone, says something else, or kept changing under every
 * try. A failure to read or write it throws.
 */
export async function writeNotificationStatusWhileStill(data: {
  userOnCallLogTimelineId: ObjectID;
  from: ReadonlyArray<UserNotificationStatus>;
  status?: UserNotificationStatus | undefined;
  statusMessage: string;
  orSettledAsStuck?: boolean | undefined;
  acknowledgedAt?: Date | undefined;
}): Promise<boolean> {
  for (
    let attempt: number = 0;
    attempt < MAX_NOTIFICATION_WRITE_ATTEMPTS;
    attempt++
  ) {
    const notification: UserOnCallLogTimeline | null =
      await UserOnCallLogTimelineService.findOneById({
        id: data.userOnCallLogTimelineId,
        select: {
          _id: true,
          status: true,
          version: true,
          // The stuck check's verdict is told by its message.
          ...(data.orSettledAsStuck ? { statusMessage: true } : {}),
        },
        props: {
          isRoot: true,
        },
      });

    if (!notification || !notification.status) {
      return false;
    }

    const hasVersion: boolean = typeof notification.version === "number";

    /*
     * The stuck check's verdict is an Error like any other to the database,
     * so it is written over only at the version read: an Error written
     * meanwhile - the provider's report - moves the version on.
     */
    const mayMoveOn: boolean =
      data.from.includes(notification.status) ||
      Boolean(
        data.orSettledAsStuck && hasVersion && isSettledAsStuck(notification),
      );

    if (!mayMoveOn) {
      return false;
    }

    const writtenCount: number = await UserOnCallLogTimelineService.updateOneBy(
      {
        query: {
          _id: data.userOnCallLogTimelineId.toString(),
          status: notification.status,
          // At the version read: a write landing meanwhile leaves no row to write.
          ...(hasVersion ? { version: notification.version } : {}),
        },
        data: {
          ...(data.status ? { status: data.status } : {}),
          statusMessage: data.statusMessage.substring(0, ColumnLength.LongText),
          ...(data.acknowledgedAt
            ? { acknowledgedAt: data.acknowledgedAt, isAcknowledged: true }
            : {}),
        },
        props: {
          isRoot: true,
        },
      },
    );

    if (writtenCount > 0) {
      return true;
    }
  }

  return false;
}

/*
 * What the send found, once the provider answered it: Sent when the
 * provider took the message, Error when it did not - over Sending only, or
 * over the stuck check's verdict: a send that finished late says how it
 * went after all.
 */
export async function recordSendResult(data: {
  userOnCallLogTimelineId: ObjectID;
  isSent: boolean;
  statusMessage: string;
}): Promise<boolean> {
  return await writeNotificationStatusWhileStill({
    userOnCallLogTimelineId: data.userOnCallLogTimelineId,
    from: SEND_RESULT_MOVES_ON_FROM,
    status: data.isSent
      ? UserNotificationStatus.Sent
      : UserNotificationStatus.Error,
    statusMessage: data.statusMessage,
    orSettledAsStuck: true,
  });
}

/*
 * What the provider reported later: an SMS or a WhatsApp message that did
 * not reach the person is an Error, a call not answered Not Answered - or,
 * with no status, only the message says how it went (a call answered). Over
 * Sent or Sending only.
 */
export async function recordProviderReport(data: {
  userOnCallLogTimelineId: ObjectID;
  status?: UserNotificationStatus | undefined;
  statusMessage: string;
}): Promise<boolean> {
  return await writeNotificationStatusWhileStill({
    userOnCallLogTimelineId: data.userOnCallLogTimelineId,
    from: PROVIDER_REPORT_MOVES_ON_FROM,
    status: data.status,
    statusMessage: data.statusMessage,
  });
}

/*
 * The person acknowledged the page from this notification - its link, a
 * call's 1, a custom channel's button: Acknowledged, with when, over what
 * its send or its provider wrote, or an escalation from it
 * (ACKNOWLEDGEMENT_MOVES_ON_FROM). The notification's update hook then
 * acknowledges their page, the run and the record
 * (UserOnCallLogTimelineService.acknowledgePage). Whether it was written:
 * false when it was acknowledged already - a second press, say - so the
 * page is acknowledged once.
 */
export async function recordAcknowledgement(data: {
  userOnCallLogTimelineId: ObjectID;
  statusMessage: string;
  acknowledgedAt?: Date | undefined;
}): Promise<boolean> {
  return await writeNotificationStatusWhileStill({
    userOnCallLogTimelineId: data.userOnCallLogTimelineId,
    from: ACKNOWLEDGEMENT_MOVES_ON_FROM,
    status: UserNotificationStatus.Acknowledged,
    statusMessage: data.statusMessage,
    acknowledgedAt: data.acknowledgedAt || OneUptimeDate.getCurrentDate(),
  });
}

/*
 * Whether the notification is acknowledged now: read again when
 * recordAcknowledgement wrote nothing, to tell a second press - acknowledged
 * meanwhile - from a notification that kept changing under every try. Only
 * the first may be answered as acknowledged: the second is not, and the page
 * goes on paging the person.
 */
export async function isNotificationAcknowledged(
  userOnCallLogTimelineId: ObjectID,
): Promise<boolean> {
  const notification: UserOnCallLogTimeline | null =
    await UserOnCallLogTimelineService.findOneById({
      id: userOnCallLogTimelineId,
      select: {
        _id: true,
        isAcknowledged: true,
      },
      props: {
        isRoot: true,
      },
    });

  return Boolean(notification?.isAcknowledged);
}

/*
 * The person escalated the page from this notification (OnCallPagePassOn):
 * Passed On, over what its send or its provider wrote - never over an
 * acknowledgement (PASS_ON_MOVES_ON_FROM).
 */
export async function recordPassOn(data: {
  userOnCallLogTimelineId: ObjectID;
  statusMessage: string;
}): Promise<boolean> {
  return await writeNotificationStatusWhileStill({
    userOnCallLogTimelineId: data.userOnCallLogTimelineId,
    from: PASS_ON_MOVES_ON_FROM,
    status: UserNotificationStatus.PassedOn,
    statusMessage: data.statusMessage,
  });
}
