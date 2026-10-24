import SecurityCasePriority from "Common/Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "Common/Models/DatabaseModels/SecurityCaseStatus";
import ObjectID from "Common/Types/ObjectID";
import { isArchivedValue } from "Common/Utils/ArchivableValues";
import SecurityCasePriorities from "Common/Utils/SecurityCase/SecurityCasePriorities";
import SecurityCaseStatuses from "Common/Utils/SecurityCase/SecurityCaseStatuses";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";

/*
 * A project's case priorities and statuses as the dropdowns offer them, in
 * the project's order - most urgent priority first, statuses as a case
 * comes through them - each with its colour.
 *
 *   - A picker (setting a case's priority, a playbook's step) never offers
 *     an archived value, but keeps the one already picked (`keepId`),
 *     marked Archived, so it can be kept or changed.
 *   - A filter offers every value, archived ones too, marked: a case at an
 *     archived priority is still found by it.
 *
 * React-free, so the options are tested apart from the pages.
 */

type SecurityCaseValue = SecurityCasePriority | SecurityCaseStatus;

function toOption(value: SecurityCaseValue): DropdownOption {
  return {
    value: value.id?.toString() || "",
    label: value.name || "",
    ...(value.color ? { color: value.color } : {}),
    ...(isArchivedValue(value) ? { isArchived: true } : {}),
  };
}

function pick<T extends SecurityCaseValue>(
  sorted: Array<T>,
  data: { keepId?: ObjectID | string | null | undefined; forFilter: boolean },
): Array<DropdownOption> {
  const keepId: string = data.keepId ? data.keepId.toString() : "";

  return sorted
    .filter((value: T): boolean => {
      return (
        data.forFilter ||
        !isArchivedValue(value) ||
        value.id?.toString() === keepId
      );
    })
    .map(toOption);
}

export function getSecurityCasePriorityOptions(
  priorities: ReadonlyArray<SecurityCasePriority>,
  data: {
    keepId?: ObjectID | string | null | undefined;
    forFilter?: boolean | undefined;
  } = {},
): Array<DropdownOption> {
  return pick(SecurityCasePriorities.sort(priorities), {
    keepId: data.keepId,
    forFilter: data.forFilter === true,
  });
}

export function getSecurityCaseStatusOptions(
  statuses: ReadonlyArray<SecurityCaseStatus>,
  data: {
    keepId?: ObjectID | string | null | undefined;
    forFilter?: boolean | undefined;
  } = {},
): Array<DropdownOption> {
  return pick(SecurityCaseStatuses.sort(statuses), {
    keepId: data.keepId,
    forFilter: data.forFilter === true,
  });
}
