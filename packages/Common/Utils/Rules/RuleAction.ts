import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";

/*
 * WHAT A LABEL OR OWNER RULE ADDS, AND WHETHER IT ADDS ANYTHING.
 *
 * A label rule adds the labels it lists (labelsToAdd); an owner rule adds
 * the people and teams it lists (ownerUsers, ownerTeams). An incident,
 * alert or scheduled maintenance rule can also inherit: six switches add the
 * labels - or the owners - of the monitors, hosts, Kubernetes clusters,
 * Docker and Podman hosts and services the event touches.
 *
 * A rule that adds nothing matches and does nothing, so a NEW rule must add
 * something wherever it is made: the Dashboard's form asks for it
 * (Dashboard Utils/Form/ResourceRuleForm), the server refuses a create
 * without it (Server/Services/LabelAndOwnerRuleBaseService) - the API,
 * Terraform, workflows and label rule imports all create through it - and a
 * label rule import says so for every such rule before it creates any
 * (Utils/LabelRuleImportExport). An EDIT may still empty a rule, and a rule
 * saved before any of them asked may add nothing: it can still be renamed,
 * switched off or deleted, and its table marks it "Adds nothing"
 * (UI/Components/RuleRun/RuleAction, RuleTable).
 *
 * Server-free and React-free: the server, the import and the Dashboard read
 * the same columns the same way.
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

// Whether the rule adds labels; otherwise it adds owners.
export const isLabelRuleAction: (action: RuleActionColumns) => boolean = (
  action: RuleActionColumns,
): boolean => {
  return LABEL_RULE_LIST_COLUMNS.every((column: string): boolean => {
    return action.listColumns.includes(column);
  });
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
 * Whether any of these switches is on, in a form's values, a saved rule or
 * a rule being created. Only true is on: the API takes a switch as a JSON
 * boolean, and every form sends one.
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

/*
 * Whether one entry of a list names something: an id - as text, an ObjectID
 * or a { _id } (a related row from the API, a model the Dashboard built) -
 * or, in a label rule import, a label's name. An entry that names nothing
 * links nothing.
 */
const namesSomething: (entry: unknown) => boolean = (
  entry: unknown,
): boolean => {
  if (typeof entry === "string") {
    return entry.trim().length > 0;
  }

  if (!entry || typeof entry !== "object") {
    return false;
  }

  // An ObjectID too: it keeps its id in _id.
  const reference: { _id?: unknown; id?: unknown } = entry as {
    _id?: unknown;
    id?: unknown;
  };
  const id: unknown = reference._id || reference.id;

  return id !== undefined && id !== null && String(id).trim().length > 0;
};

/**
 * Whether a rule being created adds something: one of its lists names at
 * least one label, person or team, or one of its switches is on. Read from
 * what the create writes: a list it leaves out starts empty, and a switch it
 * leaves out starts off - their columns' defaults.
 */
export const doesNewRuleAddSomething: (
  rule: unknown,
  action: RuleActionColumns,
) => boolean = (rule: unknown, action: RuleActionColumns): boolean => {
  const namesAnything: boolean = action.listColumns.some(
    (column: string): boolean => {
      const value: unknown = readValue(rule, column);

      return Array.isArray(value) && value.some(namesSomething);
    },
  );

  return namesAnything || isAnyColumnSwitchedOn(rule, action.switchColumns);
};

/*
 * The answer to a new rule that adds nothing - from the API, Terraform, a
 * workflow or a label rule import - in the words of the fields it names
 * (their titles, as the API documents them). An event's rule may inherit
 * instead, and is told so.
 */
export const LABEL_RULE_ADDS_NOTHING_MESSAGE: string =
  "This label rule adds nothing. Choose at least one label in Labels to Add.";

export const INHERITING_LABEL_RULE_ADDS_NOTHING_MESSAGE: string =
  "This label rule adds nothing. Choose at least one label in Labels to Add, or turn on an Inherit Labels switch.";

export const OWNER_RULE_ADDS_NOTHING_MESSAGE: string =
  "This owner rule adds nothing. Choose at least one user or team in Owner Users or Owner Teams.";

export const INHERITING_OWNER_RULE_ADDS_NOTHING_MESSAGE: string =
  "This owner rule adds nothing. Choose at least one user or team in Owner Users or Owner Teams, or turn on an Inherit Owners switch.";

export const getRuleAddsNothingMessage: (
  action: RuleActionColumns,
) => string = (action: RuleActionColumns): string => {
  const inherits: boolean = action.switchColumns.length > 0;

  if (isLabelRuleAction(action)) {
    return inherits
      ? INHERITING_LABEL_RULE_ADDS_NOTHING_MESSAGE
      : LABEL_RULE_ADDS_NOTHING_MESSAGE;
  }

  return inherits
    ? INHERITING_OWNER_RULE_ADDS_NOTHING_MESSAGE
    : OWNER_RULE_ADDS_NOTHING_MESSAGE;
};
