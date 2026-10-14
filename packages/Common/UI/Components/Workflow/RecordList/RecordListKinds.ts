/*
 * Which of the project's records each "who to page" setting lists: the
 * people picker's kind for a step's Users, Teams, On-Call Schedules or
 * On-Call Policies setting.
 *
 * Pure, so the whole table can be tested against the setting types.
 */

import { ComponentInputType } from "../../../../Types/Workflow/Component";
import { PeoplePickerKind } from "../../PeoplePicker/PeoplePickerTypes";

export const RECORD_LIST_KINDS: Partial<
  Record<ComponentInputType, PeoplePickerKind>
> = {
  [ComponentInputType.UserList]: PeoplePickerKind.User,
  [ComponentInputType.TeamList]: PeoplePickerKind.Team,
  [ComponentInputType.OnCallScheduleList]: PeoplePickerKind.OnCallSchedule,
  [ComponentInputType.OnCallPolicyList]: PeoplePickerKind.OnCallPolicy,
};

export type GetRecordListKindFunction = (
  type: ComponentInputType,
) => PeoplePickerKind | null;

// The kind a setting of this type lists, or null for any other setting.
export const getRecordListKind: GetRecordListKindFunction = (
  type: ComponentInputType,
): PeoplePickerKind | null => {
  return RECORD_LIST_KINDS[type] || null;
};
