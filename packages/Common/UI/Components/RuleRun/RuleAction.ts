import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { translationKey } from "../../Utils/TranslateTemplate";

/*
 * WHAT A LABEL OR OWNER RULE ADDS.
 *
 * A label rule adds the labels it lists (labelsToAdd); an owner rule adds
 * the people and teams it lists (ownerUsers, ownerTeams). An incident,
 * alert or scheduled maintenance rule can also inherit: six switches add the
 * labels - or the owners - of the monitors, hosts, Kubernetes clusters,
 * Docker and Podman hosts and services the event touches.
 *
 * The form asks a NEW rule for one of these (Dashboard Utils/Form/
 * ResourceRuleForm), but a rule saved before it did - through the API,
 * Terraform, an import or the old form - may add nothing at all: it matches
 * and does nothing. Editing such a rule does not insist on labels or owners,
 * so it can still be renamed, switched off or deleted; its table marks it
 * "Adds nothing" beside its status instead (RuleTable), so it can be found
 * and fixed.
 *
 * React-free: the Dashboard's rule form reads the switch columns too.
 */

// The lists a label rule and an owner rule add by name.
export const LABEL_RULE_LIST_COLUMNS: ReadonlyArray<string> = ["labelsToAdd"];

export const OWNER_RULE_LIST_COLUMNS: ReadonlyArray<string> = [
  "ownerUsers",
  "ownerTeams",
];

// An incident, alert or scheduled maintenance label rule's Inherit Labels.
export const INHERITED_LABEL_COLUMNS: ReadonlyArray<string> = [
  "inheritLabelsFromMonitors",
  "inheritLabelsFromHosts",
  "inheritLabelsFromKubernetesClusters",
  "inheritLabelsFromDockerHosts",
  "inheritLabelsFromPodmanHosts",
  "inheritLabelsFromServices",
];

// The same rules' Inherit Owners.
export const INHERITED_OWNER_COLUMNS: ReadonlyArray<string> = [
  "inheritOwnersFromMonitors",
  "inheritOwnersFromHosts",
  "inheritOwnersFromKubernetesClusters",
  "inheritOwnersFromDockerHosts",
  "inheritOwnersFromPodmanHosts",
  "inheritOwnersFromServices",
];

// Beside a rule's status in its table, for a rule that adds nothing.
export const RULE_ADDS_NOTHING_TEXT: string = translationKey("Adds nothing");

export const RULE_ADDS_NOTHING_TOOLTIP: string = translationKey(
  "This rule adds nothing when it matches. Edit it to choose what it adds, or delete it.",
);

export interface RuleActionColumns {
  // The lists the rule adds from by name.
  listColumns: Array<string>;
  // The switches that add more when on: an event rule's Inherit switches.
  switchColumns: Array<string>;
}

const LABEL_RULE_TABLE: RegExp = /LabelRule$/;
const OWNER_RULE_TABLE: RegExp = /OwnerRule$/;

const hasEveryColumn: (
  model: BaseModel,
  columns: ReadonlyArray<string>,
) => boolean = (model: BaseModel, columns: ReadonlyArray<string>): boolean => {
  return columns.every((column: string): boolean => {
    return model.hasColumn(column);
  });
};

const columnsOf: (
  model: BaseModel,
  columns: ReadonlyArray<string>,
) => Array<string> = (
  model: BaseModel,
  columns: ReadonlyArray<string>,
): Array<string> => {
  return columns.filter((column: string): boolean => {
    return model.hasColumn(column);
  });
};

/**
 * What a label or owner rule model adds, by column: null for any other
 * model - a rule of another kind, or not a rule.
 */
export const getRuleActionColumns: (
  model: BaseModel,
) => RuleActionColumns | null = (
  model: BaseModel,
): RuleActionColumns | null => {
  const tableName: string = model.tableName || "";

  if (
    LABEL_RULE_TABLE.test(tableName) &&
    hasEveryColumn(model, LABEL_RULE_LIST_COLUMNS)
  ) {
    return {
      listColumns: [...LABEL_RULE_LIST_COLUMNS],
      switchColumns: columnsOf(model, INHERITED_LABEL_COLUMNS),
    };
  }

  if (
    OWNER_RULE_TABLE.test(tableName) &&
    hasEveryColumn(model, OWNER_RULE_LIST_COLUMNS)
  ) {
    return {
      listColumns: [...OWNER_RULE_LIST_COLUMNS],
      switchColumns: columnsOf(model, INHERITED_OWNER_COLUMNS),
    };
  }

  return null;
};

/*
 * What a table selects to tell whether a rule adds anything: the lists by
 * id - nothing more is read of them - and the switches.
 */
export const getRuleActionSelect: (
  action: RuleActionColumns,
) => Record<string, unknown> = (
  action: RuleActionColumns,
): Record<string, unknown> => {
  const select: Record<string, unknown> = {};

  for (const column of action.listColumns) {
    select[column] = { _id: true };
  }

  for (const column of action.switchColumns) {
    select[column] = true;
  }

  return select;
};

const readValue: (values: unknown, column: string) => unknown = (
  values: unknown,
  column: string,
): unknown => {
  if (!values || typeof values !== "object") {
    return undefined;
  }

  return (values as Record<string, unknown>)[column];
};

/**
 * Whether any of these switches is on, in a form's values or a saved rule.
 */
export const isAnyColumnSwitchedOn: (
  values: unknown,
  columns: ReadonlyArray<string>,
) => boolean = (values: unknown, columns: ReadonlyArray<string>): boolean => {
  return columns.some((column: string): boolean => {
    return readValue(values, column) === true;
  });
};

/**
 * Whether a saved rule adds nothing when it matches: every list it adds
 * from is read and empty, and every switch is read and off. A list or a
 * switch the row does not carry - not selected, or not readable by the
 * viewer - is not known to be empty, so such a rule is never said to add
 * nothing.
 */
export const doesRuleAddNothing: (
  rule: unknown,
  action: RuleActionColumns,
) => boolean = (rule: unknown, action: RuleActionColumns): boolean => {
  for (const column of action.listColumns) {
    const value: unknown = readValue(rule, column);

    if (!Array.isArray(value) || value.length > 0) {
      return false;
    }
  }

  for (const column of action.switchColumns) {
    if (readValue(rule, column) !== false) {
      return false;
    }
  }

  return true;
};
