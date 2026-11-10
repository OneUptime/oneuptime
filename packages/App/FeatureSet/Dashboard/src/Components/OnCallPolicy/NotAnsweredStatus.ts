import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";

/*
 * A CALL THAT RANG AND WAS NOT PICKED UP, AS THE LISTS DRAW IT.
 *
 * Twilio tells how each call of a page ended (the notification server's
 * call status callback): one that rang out, or found the line busy, is
 * stored with the status "Not Answered" (UserNotificationStatus.NotAnswered).
 * User Settings > On-Call Logs > Timeline draws its pill, and offers it in
 * its status filter, as "Not answered" - the words the Dashboard's other
 * call lists use, which every language has.
 */
export const NOT_ANSWERED_STATUS_LABEL: string = "Not answered";

// A status filter's options, the stored "Not Answered" labelled "Not answered".
export function withNotAnsweredStatusLabel(
  options: Array<DropdownOption>,
): Array<DropdownOption> {
  return options.map((option: DropdownOption): DropdownOption => {
    return option.value === UserNotificationStatus.NotAnswered
      ? { ...option, label: NOT_ANSWERED_STATUS_LABEL }
      : option;
  });
}
