import {
  PeoplePickerFieldConfig,
  PeoplePickerKind,
} from "Common/UI/Components/PeoplePicker/PeoplePickerTypes";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * Who a case is assigned to: one project member, and the team the case
 * belongs to, each picked from the people picker every OneUptime form uses
 * and written straight to the case's assignedToUserId and assignedToTeamId.
 */

export const SECURITY_CASE_ASSIGNEE_KEY: string = "assignedToUserId";
export const SECURITY_CASE_TEAM_KEY: string = "assignedToTeamId";

export const getSecurityCaseAssigneePickerConfig: () => PeoplePickerFieldConfig =
  (): PeoplePickerFieldConfig => {
    return {
      kinds: [
        { kind: PeoplePickerKind.User, valueKey: SECURITY_CASE_ASSIGNEE_KEY },
      ],
      isSinglePick: true,
      addButtonText: translationKey("Choose someone"),
      searchPlaceholder: translationKey("Search by name or email…"),
      emptyText: translationKey("No project members"),
    };
  };

export const getSecurityCaseTeamPickerConfig: () => PeoplePickerFieldConfig =
  (): PeoplePickerFieldConfig => {
    return {
      kinds: [
        { kind: PeoplePickerKind.Team, valueKey: SECURITY_CASE_TEAM_KEY },
      ],
      isSinglePick: true,
      addButtonText: translationKey("Choose a team"),
      searchPlaceholder: translationKey("Search teams…"),
      emptyText: translationKey("No teams"),
    };
  };
