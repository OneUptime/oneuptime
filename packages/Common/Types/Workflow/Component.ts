import IconProp from "../Icon/IconProp";
import { JSONObject } from "../JSON";

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
}

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
 */
export interface ArgumentNotRequiredWhen {
  argumentId: string;
  values: Array<string>;
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

  const rule: ArgumentNotRequiredWhen | undefined = argument.notRequiredWhen;

  if (!rule) {
    return true;
  }

  const other: unknown = values ? values[rule.argumentId] : undefined;

  if (typeof other !== "string") {
    return true;
  }

  const normalized: string = other.trim().replace(/\s+/g, " ").toLowerCase();

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
  /*
   * Set on the category of a database model's steps, which is named after
   * the model's singular name. Two models can share that name, so the Add
   * Component picker matches a model's steps to their category by table.
   */
  tableName?: string | undefined;
}
