import { Green, Red, Yellow } from "Common/Types/BrandColors";
import CallStatus from "Common/Types/Call/CallStatus";
import Color from "Common/Types/Color";

export interface CallStatusPill {
  color: Color;
  text: string;
}

/*
 * How a call's status is drawn in the call logs (CallLogsTable). A call
 * placed is Success; how it ended can move it on (the notification server's
 * call status callback): one that rang out is a missed call, one that found
 * the line busy is busy and an on-call call that voicemail answered is
 * voicemail (its answering machine callback, #6594) - none of them is a
 * failure, so none is red - and one that could not be connected is an
 * error.
 */
export function getCallStatusPill(status: CallStatus | string): CallStatusPill {
  switch (status) {
    case CallStatus.Success:
      return { color: Green, text: status };
    // Stored "Missed Call"; drawn in the words the other call lists use.
    case CallStatus.MissedCall:
      return { color: Yellow, text: "Missed call" };
    case CallStatus.Busy:
      return { color: Yellow, text: status };
    // Written out, so the Dashboard's words have it in every language.
    case CallStatus.Voicemail:
      return { color: Yellow, text: "Voicemail" };
    default:
      return { color: Red, text: status };
  }
}
