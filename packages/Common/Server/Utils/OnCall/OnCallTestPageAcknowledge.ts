import UserOnCallLog from "../../../Models/DatabaseModels/UserOnCallLog";
import UserOnCallLogTimeline from "../../../Models/DatabaseModels/UserOnCallLogTimeline";
import ObjectID from "../../../Types/ObjectID";
import { ON_CALL_TEST_PAGE_NOTIFICATION_ACKNOWLEDGED_MESSAGE } from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import UserOnCallLogService from "../../Services/UserOnCallLogService";
import {
  isNotificationAcknowledged,
  recordAcknowledgement,
} from "./OnCallNotificationStatus";

/*
 * ACKNOWLEDGING A TEST PAGE FROM ONE OF ITS MESSAGES (OnCallTestPage).
 *
 * The one rule every way of answering a test page goes through: the page an
 * email's, a text's or a chat message's link opens (UserOnCallLogTimelineAPI)
 * and the On-Call app's "Acknowledge test page" under its push (#7014,
 * OnCallTestPageAPI). Both write the same thing on the message's row of the
 * person's on-call timeline - Acknowledged, when, in the same words - and the
 * row's update hook then acknowledges the person's page and the run, in a
 * test's words ("Test page acknowledged by Ana Lopez by push notification
 * after 14 seconds."), and records the milestone the project's activation
 * counts (UserOnCallLogTimelineService.acknowledgeTestPage).
 *
 * A test is the person's to acknowledge once, whichever of their messages
 * they answer: one already acknowledged - from this message or another of
 * theirs - writes nothing again.
 */

// What answering a test page from a message did.
export enum OnCallTestPageAnswer {
  // Acknowledged now, from this message.
  Acknowledged = "Acknowledged",
  // The person had acknowledged it already, from this message or another.
  AlreadyAcknowledged = "AlreadyAcknowledged",
  /*
   * Nothing was written: the message kept changing under every try
   * (recordAcknowledgement). Never said to be acknowledged - try again.
   */
  NotAcknowledged = "NotAcknowledged",
}

export function isOnCallTestPageAnswer(
  value: unknown,
): value is OnCallTestPageAnswer {
  return Object.values(OnCallTestPageAnswer).includes(
    value as OnCallTestPageAnswer,
  );
}

// What the rule reads of a message: whether it, or the person's page, is answered.
export interface OnCallTestPageMessage {
  isAcknowledged?: UserOnCallLogTimeline["isAcknowledged"] | undefined;
  userNotificationLogId?:
    | UserOnCallLogTimeline["userNotificationLogId"]
    | undefined;
}

export default class OnCallTestPageAcknowledge {
  /*
   * Whether the person already acknowledged the test page: from this
   * message, or from another of theirs - their page says so.
   */
  public static async isAnswered(
    message: OnCallTestPageMessage,
  ): Promise<boolean> {
    if (message.isAcknowledged) {
      return true;
    }

    if (!message.userNotificationLogId) {
      return false;
    }

    const log: UserOnCallLog | null = await UserOnCallLogService.findOneById({
      id: message.userNotificationLogId,
      select: {
        _id: true,
        acknowledgedAt: true,
      },
      props: {
        isRoot: true,
      },
    });

    return Boolean(log?.acknowledgedAt);
  }

  /*
   * Acknowledges the test page from this message: written once, as any
   * acknowledgement is (recordAcknowledgement), unless the person answered
   * it already.
   */
  public static async acknowledge(data: {
    userOnCallLogTimelineId: ObjectID;
    message: OnCallTestPageMessage;
  }): Promise<OnCallTestPageAnswer> {
    if (await this.isAnswered(data.message)) {
      return OnCallTestPageAnswer.AlreadyAcknowledged;
    }

    const isWritten: boolean = await recordAcknowledgement({
      userOnCallLogTimelineId: data.userOnCallLogTimelineId,
      statusMessage: ON_CALL_TEST_PAGE_NOTIFICATION_ACKNOWLEDGED_MESSAGE,
    });

    if (isWritten) {
      return OnCallTestPageAnswer.Acknowledged;
    }

    /*
     * Not written: acknowledged meanwhile - a second press, or another of
     * the person's messages - or a message that kept changing under every
     * try, which is not acknowledged.
     */
    const isAcknowledgedMeanwhile: boolean =
      (await isNotificationAcknowledged(data.userOnCallLogTimelineId)) ||
      (await this.isAnswered({
        isAcknowledged: false,
        userNotificationLogId: data.message.userNotificationLogId,
      }));

    return isAcknowledgedMeanwhile
      ? OnCallTestPageAnswer.AlreadyAcknowledged
      : OnCallTestPageAnswer.NotAcknowledged;
  }
}
