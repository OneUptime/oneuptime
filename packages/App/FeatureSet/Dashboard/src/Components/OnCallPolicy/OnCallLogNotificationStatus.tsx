import { NOT_ANSWERED_STATUS_LABEL } from "./NotAnsweredStatus";
import { PASS_ON_PAGE_TEXT } from "./PassOn/PassOnPage";
import {
  getOnCallLogNotificationChannel,
  OnCallLogNotificationRow,
} from "./ExecutionLogs/OnCallLogLineWords";
import {
  NotificationLogStatusReading,
  readPageNotificationLogStatus,
} from "../NotificationLogs/NotificationLogStatus";
import NotificationLogStatusPill from "../NotificationLogs/NotificationLogStatusPill";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * WHAT BECAME OF ONE NOTIFICATION OF A PAGE, IN A PERSON'S ON-CALL LOGS
 * (#11416).
 *
 * The notification says Sent once its provider took the message - of a
 * call still ringing and of one that was answered, of an SMS waiting for
 * its carrier's receipt and of an email that went for good - and the
 * timeline drew every Sent in the green of Acknowledged, so it read as
 * "they got it". It drew Error and Sending in yellow too, where every log
 * draws an error red and a message still going grey.
 *
 * Where the notification says what its own log holds for certain - an
 * email's, a push's, a Telegram or a workspace message's and a webhook's
 * Success, an SMS or a call the server's own gateway took, a call Twilio
 * said was answered - it is drawn as that log draws it, with what it means
 * on hover, tap or focus (NotificationLogStatus). Anything else is the
 * notification's own status, in the colour of where it stands: Sent in the
 * blue of a message whose provider is still to say how it ended, as a test
 * page's result and Who Was Told draw it.
 */

export interface OnCallLogNotificationStatusRow
  extends OnCallLogNotificationRow {
  status?: UserNotificationStatus | string | undefined;
}

// The notification's own status: its words, and the colour of where it stands.
export const PAGE_NOTIFICATION_STATUS_CHIPS: Readonly<
  Record<UserNotificationStatus, { text: string; tone: PillTone }>
> = {
  [UserNotificationStatus.Sending]: { text: "Sending", tone: PillTone.Neutral },
  [UserNotificationStatus.Sent]: { text: "Sent", tone: PillTone.Info },
  [UserNotificationStatus.Acknowledged]: {
    text: "Acknowledged",
    tone: PillTone.Success,
  },
  // A call that rang out, or found the line busy: it reached the phone.
  [UserNotificationStatus.NotAnswered]: {
    text: NOT_ANSWERED_STATUS_LABEL,
    tone: PillTone.Warning,
  },
  // The notification the person escalated the page from.
  [UserNotificationStatus.PassedOn]: {
    text: PASS_ON_PAGE_TEXT.passedOnStatus,
    tone: PillTone.Warning,
  },
  [UserNotificationStatus.Skipped]: {
    text: "Skipped",
    tone: PillTone.Warning,
  },
  [UserNotificationStatus.Error]: { text: "Error", tone: PillTone.Danger },
};

export const ON_CALL_LOG_NOTIFICATION_STATUS_TEST_ID: string =
  "on-call-log-notification-status";

// What its own log holds, where the notification says it for certain.
export function getOnCallLogNotificationLogStatus(
  row: OnCallLogNotificationStatusRow,
): NotificationLogStatusReading | null {
  return readPageNotificationLogStatus({
    channel: getOnCallLogNotificationChannel(row),
    status: row.status,
    statusMessage: row.statusMessage,
  });
}

const OnCallLogNotificationStatus: FunctionComponent<{
  notification: OnCallLogNotificationStatusRow;
}> = (props: {
  notification: OnCallLogNotificationStatusRow;
}): ReactElement => {
  const logStatus: NotificationLogStatusReading | null =
    getOnCallLogNotificationLogStatus(props.notification);

  if (logStatus) {
    return (
      <NotificationLogStatusPill
        kind={logStatus.kind}
        status={logStatus.status}
        line={logStatus.line}
        isAwayFromItsLog={true}
        dataTestId={ON_CALL_LOG_NOTIFICATION_STATUS_TEST_ID}
      />
    );
  }

  const status: string = props.notification.status?.toString() || "";

  if (!status) {
    return <TableEmptyValue />;
  }

  const chip: { text: string; tone: PillTone } | undefined =
    PAGE_NOTIFICATION_STATUS_CHIPS[status as UserNotificationStatus];

  // A status this build does not know: as written, in the grey of an unknown one.
  if (!chip) {
    return (
      <Pill
        text={status}
        isUserContent={true}
        tone={PillTone.Neutral}
        dataTestId={ON_CALL_LOG_NOTIFICATION_STATUS_TEST_ID}
      />
    );
  }

  return (
    <Pill
      text={chip.text}
      tone={chip.tone}
      dataTestId={ON_CALL_LOG_NOTIFICATION_STATUS_TEST_ID}
    />
  );
};

export default OnCallLogNotificationStatus;
