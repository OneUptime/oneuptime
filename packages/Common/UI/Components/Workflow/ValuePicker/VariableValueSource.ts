/*
 * The workflow's variables and the project's global ones, as picker groups.
 *
 * Only the mapping lives here; loading them is in DefaultValueSources, so this
 * stays testable without the API.
 */

import IconProp from "../../../../Types/Icon/IconProp";
import {
  globalVariableReference,
  variableReference,
} from "../../../../Types/Workflow/TemplateSyntax";
import {
  ValueSuggestion,
  ValueSuggestionGroup,
  ValueSuggestionGroupKind,
} from "./ValueSuggestion";

export const VARIABLE_SOURCE_ID: string = "variables";
export const WORKFLOW_VARIABLES_GROUP_ID: string = "variables:workflow";
export const GLOBAL_VARIABLES_GROUP_ID: string = "variables:global";

// After every step: there will never be a thousand steps before one.
const WORKFLOW_VARIABLES_ORDER: number = 1000;
const GLOBAL_VARIABLES_ORDER: number = 1001;

export const SECRET_BADGE: string = "Secret";
export const OAUTH_BADGE: string = "OAuth 2.0 token";

export interface WorkflowVariableSummary {
  name: string;
  description?: string | undefined;
  /** A project-wide variable, rather than this workflow's own. */
  isGlobal: boolean;
  isSecret?: boolean | undefined;
  /** Resolves to an access token fetched from an identity provider. */
  isOAuth?: boolean | undefined;
}

type VariableItemFunction = (
  variable: WorkflowVariableSummary,
) => ValueSuggestion;

const variableItem: VariableItemFunction = (
  variable: WorkflowVariableSummary,
): ValueSuggestion => {
  const badges: Array<string> = [];

  if (variable.isOAuth) {
    badges.push(OAUTH_BADGE);
  } else if (variable.isSecret) {
    badges.push(SECRET_BADGE);
  }

  return {
    reference: variable.isGlobal
      ? globalVariableReference(variable.name)
      : variableReference(variable.name),
    label: variable.name,
    description: variable.description || undefined,
    badges: badges.length > 0 ? badges : undefined,
  };
};

type CompareByNameFunction = (
  a: WorkflowVariableSummary,
  b: WorkflowVariableSummary,
) => number;

const compareByName: CompareByNameFunction = (
  a: WorkflowVariableSummary,
  b: WorkflowVariableSummary,
): number => {
  return a.name.localeCompare(b.name);
};

export type BuildVariableGroupsFunction = (
  variables: Array<WorkflowVariableSummary>,
) => Array<ValueSuggestionGroup>;

/**
 * This workflow's variables, then the project's global ones, each by name.
 * A group with nothing in it is left out.
 */
export const buildVariableGroups: BuildVariableGroupsFunction = (
  variables: Array<WorkflowVariableSummary>,
): Array<ValueSuggestionGroup> => {
  const named: Array<WorkflowVariableSummary> = variables.filter(
    (variable: WorkflowVariableSummary) => {
      return Boolean(variable.name);
    },
  );

  const workflowVariables: Array<WorkflowVariableSummary> = named
    .filter((variable: WorkflowVariableSummary) => {
      return !variable.isGlobal;
    })
    .sort(compareByName);

  const globalVariables: Array<WorkflowVariableSummary> = named
    .filter((variable: WorkflowVariableSummary) => {
      return variable.isGlobal;
    })
    .sort(compareByName);

  const groups: Array<ValueSuggestionGroup> = [];

  if (workflowVariables.length > 0) {
    groups.push({
      id: WORKFLOW_VARIABLES_GROUP_ID,
      kind: ValueSuggestionGroupKind.WorkflowVariables,
      title: "Workflow variables",
      iconProp: IconProp.Variable,
      order: WORKFLOW_VARIABLES_ORDER,
      items: workflowVariables.map(variableItem),
    });
  }

  if (globalVariables.length > 0) {
    groups.push({
      id: GLOBAL_VARIABLES_GROUP_ID,
      kind: ValueSuggestionGroupKind.GlobalVariables,
      title: "Global variables",
      subtitle: "Shared by every workflow in this project",
      iconProp: IconProp.Globe,
      order: GLOBAL_VARIABLES_ORDER,
      items: globalVariables.map(variableItem),
    });
  }

  return groups;
};
