import SecurityCasePriority from "Common/Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "Common/Models/DatabaseModels/SecurityCaseStatus";
import ObjectID from "Common/Types/ObjectID";
import { isArchivedValue } from "Common/Utils/ArchivableValues";
import SecurityCasePriorities, {
  DEFAULT_SECURITY_CASE_PRIORITIES,
  DefaultSecurityCasePriority,
} from "Common/Utils/SecurityCase/SecurityCasePriorities";
import SecurityCaseStatuses, {
  DEFAULT_SECURITY_CASE_STATUSES,
  DefaultSecurityCaseStatus,
} from "Common/Utils/SecurityCase/SecurityCaseStatuses";
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

/*
 * The names a new project's priorities and statuses start with: OneUptime's
 * words, read in the reader's language as their pills read them
 * (SecurityCaseTerms). A name the project gave one of its own is drawn as
 * written, never looked up (DropdownOption.isUserContent): a filter's menu
 * and its chip, and a picker, read it as the project wrote it.
 */
const DEFAULT_VALUE_NAMES: ReadonlySet<string> = new Set<string>([
  ...DEFAULT_SECURITY_CASE_PRIORITIES.map(
    (priority: DefaultSecurityCasePriority): string => {
      return priority.name;
    },
  ),
  ...DEFAULT_SECURITY_CASE_STATUSES.map(
    (status: DefaultSecurityCaseStatus): string => {
      return status.name;
    },
  ),
]);

function toOption(value: SecurityCaseValue): DropdownOption {
  const name: string = value.name || "";

  return {
    value: value.id?.toString() || "",
    label: name,
    isUserContent: !DEFAULT_VALUE_NAMES.has(name),
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
