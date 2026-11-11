import UserOnCallLogTimeline from "Common/Models/DatabaseModels/UserOnCallLogTimeline";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import ColumnLength from "Common/Types/Database/ColumnLength";
import ObjectID from "Common/Types/ObjectID";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";

/*
 * What a person's on-call timeline says of one notification of a page
 * (UserOnCallLogTimeline), as an SMS, a WhatsApp message or a call sent for
 * it moves on. Several write it at about the same time:
 *
 *  - the send, once the provider has answered it (SmsService,
 *    WhatsAppService): Sent, or Error when the provider refused it;
 *  - the provider's report of how the message ended (API/SMS.ts,
 *    API/WhatsApp.ts, API/Call.ts), which can land before the send's own
 *    write - Twilio calls back within milliseconds;
 *  - the person, who acknowledges the page meanwhile, by another channel.
 *
 * Each writes only while the notification still has a status it may move
 * on from, in the same statement as the check: the update names the
 * notification at the version read (DatabaseService's compare-and-set), and
 * one that finds it changed reads it again and decides again. So none of
 * them undoes another: a failed delivery written first is never put back to
 * Sent by the send, and an acknowledgement is never written over.
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

/*
 * Writes the notification's status - when one is given - and message,
 * while it still has one of `from`. Whether it was written: false when the
 * notification is gone, says something else, or kept changing under every
 * try. A failure to read or write it throws.
 */
export async function writeNotificationStatusWhileStill(data: {
  userOnCallLogTimelineId: ObjectID;
  from: ReadonlyArray<UserNotificationStatus>;
  status?: UserNotificationStatus | undefined;
  statusMessage: string;
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
        },
        props: {
          isRoot: true,
        },
      });

    if (
      !notification ||
      !notification.status ||
      !data.from.includes(notification.status)
    ) {
      return false;
    }

    const writtenCount: number = await UserOnCallLogTimelineService.updateOneBy(
      {
        query: {
          _id: data.userOnCallLogTimelineId.toString(),
          status: notification.status,
          // At the version read: a write landing meanwhile leaves no row to write.
          ...(typeof notification.version === "number"
            ? { version: notification.version }
            : {}),
        },
        data: {
          ...(data.status ? { status: data.status } : {}),
          statusMessage: data.statusMessage.substring(0, ColumnLength.LongText),
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
 * provider took the message, Error when it did not - over Sending only.
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
