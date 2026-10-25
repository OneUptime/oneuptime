import ObjectID from "../../Types/ObjectID";
import SecurityCasePriorityLevel from "../../Types/SecurityCase/SecurityCasePriorityLevel";
import { isArchivedValue } from "../ArchivableValues";
import { StateListRow } from "../StateOrder";
import SecurityCasePriorities from "./SecurityCasePriorities";

/*
 * THE PRIORITY A PERSON HEARS ABOUT NEW SECURITY CASES AT.
 *
 * Everyone who can see a project's security cases is told about a case that
 * opens, or rises, at the priority they chose on their New Security Case
 * setting (UserNotificationSetting.minimumSecurityCasePriorityId) or above,
 * by its place in the project's ranked list (SecurityCasePriorities).
 * Nobody has to choose: an empty choice is the project's high priority, so
 * a project that only turned Security on hears about its High and Critical
 * cases (and any of its own ranked above High), and the rest wait in the
 * queue.
 *
 * A case is told about once per person: the case keeps the highest priority
 * people were told about it at (SecurityCase.notifiedSecurityCasePriorityId),
 * and a rise is news only to the people whose chosen priority it reaches for
 * the first time. A Medium case that rises to Critical reaches the people who
 * chose High or Critical; the people who chose Medium heard about it when it
 * opened.
 */

export enum SecurityCaseNotificationChoiceKind {
  // The most urgent priority: "Critical only".
  Only = "Only",
  // Any priority between: "High and above".
  AndAbove = "AndAbove",
  // The least urgent: every case.
  Every = "Every",
}

// One choice a person picks from: the lowest priority that notifies them.
export interface SecurityCaseNotificationPriorityChoice {
  priorityId: string;
  // The priority's name, as the project calls it.
  name: string;
  kind: SecurityCaseNotificationChoiceKind;
}

// How each choice reads, with {{priority}} for the priority's name.
export const SECURITY_CASE_NOTIFICATION_CHOICE_TEMPLATES: Readonly<
  Record<SecurityCaseNotificationChoiceKind, string>
> = {
  [SecurityCaseNotificationChoiceKind.Only]: "{{priority}} only",
  [SecurityCaseNotificationChoiceKind.AndAbove]: "{{priority}} and above",
  [SecurityCaseNotificationChoiceKind.Every]: "Every case",
};

// Everybody's choice until they make one: the project's high priority.
export function getDefaultSecurityCaseNotificationMinimum<T>(
  priorities: ReadonlyArray<T>,
): T | null {
  return SecurityCasePriorities.getPriorityOfLevel(
    priorities,
    SecurityCasePriorityLevel.High,
  );
}

/*
 * A person's choice as stored: one of the project's priorities, or - empty,
 * or a priority the project no longer has - the default. Null only for a
 * project with no high priority, which is never left without one.
 */
export function readSecurityCaseNotificationMinimum<T>(
  priorities: ReadonlyArray<T>,
  chosenId: ObjectID | string | null | undefined,
): T | null {
  return (
    SecurityCasePriorities.find(priorities, chosenId) ||
    getDefaultSecurityCaseNotificationMinimum(priorities)
  );
}

/*
 * Whether a case now at `priorityId`, last told about at
 * `notifiedPriorityId` (nothing yet: undefined), is news to a person who
 * chose `minimumId`: it reaches their priority now, and did not when people
 * were last told.
 */
export function reachesNotificationPriorityNow(data: {
  priorities: ReadonlyArray<unknown>;
  priorityId: ObjectID | string | null | undefined;
  notifiedPriorityId: ObjectID | string | null | undefined;
  minimumId: ObjectID | string | null | undefined;
}): boolean {
  if (
    !SecurityCasePriorities.isAtLeast(
      data.priorities,
      data.priorityId,
      data.minimumId,
    )
  ) {
    return false;
  }

  // Never told: anything known to the project is news.
  if (
    SecurityCasePriorities.getRank(data.priorities, data.notifiedPriorityId) ===
    null
  ) {
    return true;
  }

  return !SecurityCasePriorities.isAtLeast(
    data.priorities,
    data.notifiedPriorityId,
    data.minimumId,
  );
}

/*
 * The choices a person picks from, most urgent first, one per priority:
 * each is the lowest priority that notifies. What each says follows from
 * where it ranks in the whole list - the top one "only", the last one every
 * case - and an archived priority is offered only to whoever has it
 * chosen already (`currentId`): nobody picks it again.
 */
export function getSecurityCaseNotificationPriorityChoices(data: {
  priorities: ReadonlyArray<unknown>;
  currentId?: ObjectID | string | null | undefined;
}): Array<SecurityCaseNotificationPriorityChoice> {
  const sorted: Array<unknown> = SecurityCasePriorities.sort(data.priorities);
  const rows: Array<StateListRow> = SecurityCasePriorities.toRows(sorted);
  const currentId: string = data.currentId
    ? data.currentId.toString().toLowerCase()
    : "";

  const choices: Array<SecurityCaseNotificationPriorityChoice> = [];

  rows.forEach((row: StateListRow, index: number) => {
    const isCurrent: boolean = row.id.toLowerCase() === currentId;

    if (isArchivedValue(sorted[index]) && !isCurrent) {
      return;
    }

    choices.push({
      priorityId: row.id,
      name: row.name,
      kind:
        index === rows.length - 1
          ? SecurityCaseNotificationChoiceKind.Every
          : index === 0
            ? SecurityCaseNotificationChoiceKind.Only
            : SecurityCaseNotificationChoiceKind.AndAbove,
    });
  });

  return choices;
}

// A choice in English: "Critical only", "High and above", "Every case".
export function describeSecurityCaseNotificationChoice(
  choice: Pick<SecurityCaseNotificationPriorityChoice, "name" | "kind">,
): string {
  return SECURITY_CASE_NOTIFICATION_CHOICE_TEMPLATES[choice.kind]
    .split("{{priority}}")
    .join(choice.name);
}
