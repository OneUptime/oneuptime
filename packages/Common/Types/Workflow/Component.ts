import IconProp from "../Icon/IconProp";
import { JSONObject } from "../JSON";
import ProviderLogo from "../ProviderLogo/ProviderLogo";
import { parseTemplateExpressions } from "./TemplateSyntax";

export enum ComponentInputType {
  Text = "Text",
  Password = "Password",
  Date = "Date",
  DateTime = "Date Time",
  Boolean = "True or False",
  Number = "Number",
  Decimal = "Decimal",
  JavaScript = "JavaScript",
  AnyValue = "Any Type",
  JSON = "JSON",
  StringDictionary = "Dictionary of String",
  URL = "URL",
  Email = "Email",
  CronTab = "CronTab",
  Query = "Database Query",
  Select = "Database Select",
  BaseModel = "Database Record",
  BaseModelArray = "Database Records",
  JSONArray = "List of JSON",
  LongText = "Long Text",
  HTML = "HTML",
  Operator = "Operator",
  Markdown = "Markdown",
  ValueType = "Value Type",
  WorkflowSelect = "Workflow Select",
  /*
   * One of the project's incident templates, picked from a list: Create One
   * Incident's Incident Template (Types/Workflow/CreateFromTemplate).
   */
  IncidentTemplateSelect = "Incident Template Select",
  /*
   * A Switch / Case step's list of cases, each a comparison and a value
   * (Types/Workflow/Components/SwitchCases). Stored as a list, not as text,
   * and edited in the step's own settings (Workflow/Switch). Each case is an
   * output of the step, so its outputs depend on this setting
   * (ComponentOutPorts).
   */
  SwitchCases = "Switch Cases",
  /*
   * One of the setting's own choices (Argument.choices), stored as the
   * choice's value: what a Page step's page is about. An empty setting
   * stands for its first choice.
   */
  Choice = "Choice",
  /*
   * Who a Page step pages: the project's people, teams, on-call schedules
   * or on-call policies, picked from a list. Stored as a list of ids, any of
   * which may instead be a value from an earlier step - an id, several, or
   * for people an email address (Types/Workflow/Components/OnCallPageSettings).
   */
  UserList = "User List",
  TeamList = "Team List",
  OnCallScheduleList = "On-Call Schedule List",
  OnCallPolicyList = "On-Call Policy List",
  // One of the project's alert severities, picked from a list.
  AlertSeveritySelect = "Alert Severity Select",
  /*
   * One of the project's incident severities, picked from a list: the
   * severity each Huntress severity opens at (Components/Huntress).
   */
  IncidentSeveritySelect = "Incident Severity Select",
}

/*
 * The settings that hold a list of the project's records, picked in the
 * step's settings (the Page steps' who-to-page settings).
 */
const RECORD_LIST_INPUT_TYPES: Array<ComponentInputType> = [
  ComponentInputType.UserList,
  ComponentInputType.TeamList,
  ComponentInputType.OnCallScheduleList,
  ComponentInputType.OnCallPolicyList,
];

export type IsRecordListInputTypeFunction = (
  type: ComponentInputType,
) => boolean;

export const isRecordListInputType: IsRecordListInputTypeFunction = (
  type: ComponentInputType,
): boolean => {
  return RECORD_LIST_INPUT_TYPES.includes(type);
};

/*
 * Argument types whose value is a JSON document but is read with
 * JSONFunctions.parse — that is, JSON5 — rather than JSON.parse. Unquoted keys,
 * single quotes and trailing commas therefore work in these, and a workflow
 * written that way runs fine today.
 *
 * The distinction matters wherever a JSON document is checked for syntax
 * before it runs: applying JSON.parse's rules to one of these would report a
 * mistake in a workflow that does not have one. The strict set is everything
 * else — RunWorkflow.getComponentArguments calls JSON.parse directly on
 * JSON, Query and Select, so those really must be JSON.
 */
const JSON5_TOLERANT_INPUT_TYPES: Array<ComponentInputType> = [
  ComponentInputType.StringDictionary,
  ComponentInputType.JSONArray,
  ComponentInputType.BaseModel,
  ComponentInputType.BaseModelArray,
];

export type IsJSON5ToleratedInputTypeFunction = (
  type: ComponentInputType,
) => boolean;

export const isJSON5ToleratedInputType: IsJSON5ToleratedInputTypeFunction = (
  type: ComponentInputType,
): boolean => {
  return JSON5_TOLERANT_INPUT_TYPES.includes(type);
};

export enum ComponentType {
  Trigger = "Trigger",
  Component = "Component",
}

export enum NodeType {
  Node = "Node",
  PlaceholderNode = "PlaceholderNode",
}

export interface NodeDataProp {
  error: string;
  id: string;
  nodeType: NodeType;
  onClick?: (node: NodeDataProp) => void | undefined;
  isPreview?: boolean | undefined; // is this used to show in the components modal?
  metadata: ComponentMetadata;
  metadataId: string;
  internalId: string;
  arguments: JSONObject;
  returnValues: JSONObject;
  componentType: ComponentType;
}

export interface Port {
  title: string;
  description: string;
  id: string;
}

/*
 * A required setting that another setting can make unnecessary: If / Else's
 * Compare with is required, except for the comparisons that look at one value
 * only ("is empty"). `values` are matched as isArgumentRequired normalises
 * them: trimmed, lower case, one space between words.
 *
 * Without `values`, any value of the other setting does: Create One
 * Incident's JSON Object is not needed once an Incident Template is picked,
 * whichever template it is.
 */
export interface ArgumentNotRequiredWhen {
  argumentId: string;
  values?: Array<string> | undefined;
}

/*
 * A setting that is part of the step only while another setting says so: a
 * Page step's Title while it pages about a new alert, its Incident ID while
 * it pages about an incident. While it is not shown, the settings do not
 * draw it, it is not required, and the step does not read it.
 *
 * `values` are the other setting's stored values this one is shown for.
 * `includesEmpty` says it is shown while the other setting is empty as
 * well: an empty choice stands for its first one, so the settings that go
 * with the first choice say so.
 */
export interface ArgumentShownWhen {
  argumentId: string;
  values: Array<string>;
  includesEmpty?: boolean | undefined;
}

// One of a Choice setting's choices.
export interface ArgumentChoice {
  // What is stored.
  value: string;
  // What the settings show.
  label: string;
  // One line under the label, saying what choosing it means.
  description?: string | undefined;
}

export interface Argument {
  name: string;
  description: string;
  required: boolean;
  /*
   * Read `required` through isArgumentRequired, which applies this. Anything
   * that ignores it errs on the safe side and calls the setting required.
   */
  notRequiredWhen?: ArgumentNotRequiredWhen | undefined;
  /*
   * Read through isArgumentShown. A setting that is not shown is not
   * required either (isArgumentRequired).
   */
  shownWhen?: ArgumentShownWhen | undefined;
  // The choices of a Choice setting, the first being what an empty one means.
  choices?: Array<ArgumentChoice> | undefined;
  type: ComponentInputType;
  id: string;
  isAdvanced?: boolean | undefined;
  /**
   * When true, the resolved value is replaced with a redaction marker in this
   * component's WorkflowLog argument entry. The real value is still passed to
   * the component at runtime. If it is reused by another component, that
   * component's own argument metadata controls its logging.
   */
  isSensitive?: boolean | undefined;
  placeholder?: string | undefined;
}

// A setting whose value comes from an earlier step or a variable: {{...}}.
const holdsTemplateExpression: (value: unknown) => boolean = (
  value: unknown,
): boolean => {
  return (
    typeof value === "string" && parseTemplateExpressions(value).length > 0
  );
};

export type IsArgumentShownFunction = (
  argument: Argument,
  values: JSONObject | undefined | null,
) => boolean;

/**
 * Whether a setting is part of the step as its other settings stand now
 * (Argument.shownWhen). One with no such rule always is.
 *
 * The other setting's value is compared without case and without the space
 * around it, the way the step reads it when it runs: a workflow written by
 * hand that says "Incident" shows the settings of "incident".
 *
 * While the other setting takes its value from an earlier step, what it
 * comes to is known only when the step runs - so every setting that could
 * go with it is part of the step, and none of them is required
 * (isArgumentRequired): the step says what it lacks when it runs.
 */
export const isArgumentShown: IsArgumentShownFunction = (
  argument: Argument,
  values: JSONObject | undefined | null,
): boolean => {
  const rule: ArgumentShownWhen | undefined = argument.shownWhen;

  if (!rule) {
    return true;
  }

  const other: unknown = values ? values[rule.argumentId] : undefined;

  if (other === undefined || other === null || other === "") {
    return Boolean(rule.includesEmpty);
  }

  if (typeof other !== "string") {
    return false;
  }

  const normalized: string = other.trim().toLowerCase();

  if (normalized === "") {
    return Boolean(rule.includesEmpty);
  }

  if (holdsTemplateExpression(other)) {
    return true;
  }

  return rule.values.some((value: string): boolean => {
    return value.toLowerCase() === normalized;
  });
};

export type GetArgumentChoiceFunction = (
  argument: Argument,
  value: unknown,
) => ArgumentChoice | null;

/**
 * The choice a Choice setting holds: the one whose value is stored, or its
 * first while nothing is. Null for a stored value that is none of its
 * choices, and for a setting with no choices.
 *
 * Compared without case and without the space around it, the way the step
 * reads the setting when it runs.
 */
export const getArgumentChoice: GetArgumentChoiceFunction = (
  argument: Argument,
  value: unknown,
): ArgumentChoice | null => {
  const choices: Array<ArgumentChoice> = argument.choices || [];

  if (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "")
  ) {
    return choices[0] || null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized: string = value.trim().toLowerCase();

  return (
    choices.find((choice: ArgumentChoice): boolean => {
      return choice.value.toLowerCase() === normalized;
    }) || null
  );
};

export type IsArgumentRequiredFunction = (
  argument: Argument,
  values: JSONObject | undefined | null,
) => boolean;

/**
 * Whether a step must have this setting filled in, given what its other
 * settings hold now.
 */
export const isArgumentRequired: IsArgumentRequiredFunction = (
  argument: Argument,
  values: JSONObject | undefined | null,
): boolean => {
  if (!argument.required) {
    return false;
  }

  // A setting that is not part of the step now has nothing to fill in.
  if (!isArgumentShown(argument, values)) {
    return false;
  }

  /*
   * Shown because the setting it goes with takes its value from an earlier
   * step: whether the step reads this one is known only when it runs.
   */
  if (
    argument.shownWhen &&
    holdsTemplateExpression(values?.[argument.shownWhen.argumentId])
  ) {
    return false;
  }

  const rule: ArgumentNotRequiredWhen | undefined = argument.notRequiredWhen;

  if (!rule) {
    return true;
  }

  const other: unknown = values ? values[rule.argumentId] : undefined;

  if (typeof other !== "string") {
    return true;
  }

  const normalized: string = other.trim().replace(/\s+/g, " ").toLowerCase();

  // Any value of the other setting makes this one unnecessary.
  if (!rule.values) {
    return normalized === "";
  }

  return !rule.values.includes(normalized);
};

export interface ReturnValue {
  id: string;
  name: string;
  description: string;
  type: ComponentInputType;
  required: boolean;
  /**
   * When true, the returned value is available to downstream components but is
   * redacted from this component's WorkflowLog return-value entry. A downstream
   * component may still log the resolved value under its own metadata.
   */
  isSensitive?: boolean | undefined;
  placeholder?: string | undefined;
}

export default interface ComponentMetadata {
  id: string;
  title: string;
  category: string;
  description: string;
  iconProp: IconProp;
  /*
   * The official logo of the product the step talks to (Slack, Discord),
   * drawn in the icon's place in the Add Component picker and on the
   * step's header in the builder.
   */
  logo?: ProviderLogo | undefined;
  componentType: ComponentType;
  arguments: Array<Argument>;
  returnValues: Array<ReturnValue>;
  inPorts: Array<Port>;
  outPorts: Array<Port>;
  tableName?: string | undefined;
  /*
   * A step's "How to use" help is not part of its metadata. It is built from
   * the metadata by Types/Workflow/Documentation, which has an entry for every
   * ComponentID (a full Record, so a new step without help does not compile).
   */
  runWorkflowManuallyArguments?: Array<Argument> | undefined;
}

export interface ComponentCategory {
  name: string;
  description: string;
  icon: IconProp;
  // The product's official logo, for a category of one product's steps.
  logo?: ProviderLogo | undefined;
  /*
   * Set on the category of a database model's steps, which is named after
   * the model's singular name. Two models can share that name, so the Add
   * Component picker matches a model's steps to their category by table.
   */
  tableName?: string | undefined;
}
