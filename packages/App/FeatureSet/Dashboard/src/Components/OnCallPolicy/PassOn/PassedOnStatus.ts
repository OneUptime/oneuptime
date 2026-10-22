import { ON_CALL_PAGE_PASSED_ON_STATUS_VALUE } from "Common/Types/OnCallDutyPolicy/OnCallPagePassOn";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { PASS_ON_PAGE_TEXT } from "./PassOnPage";

/*
 * THE STATUS OF AN ESCALATED PAGE, AS THE LISTS DRAW IT.
 *
 * A page somebody escalated is stored with the status "Passed On" - the
 * action's first name, kept so the logs written before the rename, the API
 * and every saved filter keep working. People read it as "Escalated": the
 * run's Execution Timeline, User Settings > Notification Logs and its
 * Timeline draw the pill with that word (PASS_ON_PAGE_TEXT.passedOnStatus),
 * and their status filters offer it by that word while filtering by the
 * stored value.
 */

// A status filter's options, the stored "Passed On" labelled "Escalated".
export function withEscalatedStatusLabel(
  options: Array<DropdownOption>,
): Array<DropdownOption> {
  return options.map((option: DropdownOption): DropdownOption => {
    return option.value === ON_CALL_PAGE_PASSED_ON_STATUS_VALUE
      ? { ...option, label: PASS_ON_PAGE_TEXT.passedOnStatus }
      : option;
  });
}
