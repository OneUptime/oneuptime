import { SecurityPlaybookTemplate } from "./SecurityPlaybookTemplates";
import SecurityPlaybook from "Common/Models/DatabaseModels/SecurityPlaybook";
import { SecurityPlaybookTemplateValues } from "Common/Types/SecurityPlaybook/SecurityPlaybookTemplates";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { isPlaybookFromTemplate } from "Common/Utils/SecurityEvent/SecurityTemplateRecords";

/*
 * The playbook templates as the Playbooks page offers them: in place of an
 * empty list, and from Create from Template beside Create Playbook once
 * there are playbooks - the way the Incidents' and Alerts' grouping rules
 * offer theirs. They used to sit in a card of their own above the list,
 * on every visit, every template offering to make one more copy of a
 * playbook the project already had.
 *
 * React-free so the words and what counts as added are pinned in a plain
 * test.
 */

export const PLAYBOOK_TEMPLATES_TITLE: string = translationKey(
  "Start from a template",
);

export const PLAYBOOK_TEMPLATES_DESCRIPTION: string = translationKey(
  "Each template is a working playbook you can save as it is and change later.",
);

// The list's header button, and the dialog it opens.
export const CREATE_FROM_TEMPLATE: string = translationKey(
  "Create from Template",
);

// What the templates say when the one a reader picked could not be added (SecurityTurnOnProblems).
export const PLAYBOOK_NOT_ADDED_TITLE: string = translationKey(
  "The playbook could not be added",
);

/*
 * The project's playbook of a template, if it has one: by the template's
 * name, or as the reader's language words it (otherNames) - the name a
 * template's playbook was made with.
 */
export function findPlaybookOfTemplate<
  TPlaybook extends Pick<SecurityPlaybook, "name">,
>(
  playbooks: ReadonlyArray<TPlaybook>,
  template: Pick<SecurityPlaybookTemplate, "definition">,
  otherNames: ReadonlyArray<string> = [],
): TPlaybook | undefined {
  return playbooks.find((playbook: TPlaybook): boolean => {
    return isPlaybookFromTemplate(playbook, template.definition, otherNames);
  });
}

// What a template's steps name does not change how many there are.
const NO_VALUES: SecurityPlaybookTemplateValues = {
  priorityId: (): string => {
    return "";
  },
  statusId: (): string => {
    return "";
  },
};

// How many steps a template's playbook has.
export function getTemplateStepCount(
  template: Pick<SecurityPlaybookTemplate, "getSteps">,
): number {
  return template.getSteps(NO_VALUES).length;
}
