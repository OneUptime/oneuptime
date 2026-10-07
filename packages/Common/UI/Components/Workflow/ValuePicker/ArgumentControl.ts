/*
 * Which control a step's setting gets, now that every setting that can hold a
 * value from an earlier step offers one.
 *
 * - Text of any length is the chip editor (ValueTextField): one line for
 *   short values - a URL, an address, an ID, a subject - and a box that grows
 *   for messages, prompts and the Log value.
 * - A number, a password, a switch or a date keeps its own control, with { }
 *   beside it; a picked value replaces it as a chip (ValueSingleField).
 * - JSON and HTML keep their code editor, whose toolbar gets "Insert value".
 * - Request headers keep their key/value rows, each value a chip editor.
 * - JavaScript gets nothing: a step's values reach the code through its
 *   Arguments setting, which is JSON and does get the picker. Its help says so.
 * - Choices from a fixed list (an operator, a value type, a workflow, an
 *   incident template) get nothing either: a value from a run is not one of
 *   the choices.
 *
 * The row editor, field picker and schedule picker are chosen before this, in
 * ArgumentsForm, for the settings that have them.
 *
 * Pure, so the whole table can be tested.
 */

import { ComponentInputType } from "../../../../Types/Workflow/Component";
import { containsTemplateExpression } from "./TemplateText";

export enum ArgumentControl {
  /** The chip editor, one line. */
  Text = "Text",
  /** The chip editor, growing with what is in it. */
  MultiLineText = "MultiLineText",
  Number = "Number",
  Password = "Password",
  Boolean = "Boolean",
  Date = "Date",
  DateTime = "DateTime",
  /** A JSON document in the code editor, with "Insert value". */
  JSONCode = "JSONCode",
  /** HTML in the code editor, with "Insert value". */
  HTMLCode = "HTMLCode",
  /** Key/value rows whose values are chip editors. */
  KeyValueRows = "KeyValueRows",
  /** The control componentInputTypeToFormFieldType picks, with no picker. */
  Plain = "Plain",
}

const ONE_LINE_TEXT_TYPES: Array<ComponentInputType> = [
  ComponentInputType.Text,
  ComponentInputType.URL,
  ComponentInputType.Email,
];

// Utils.MULTI_LINE_TEXT_INPUT_TYPES, repeated so this file stays pure.
const MULTI_LINE_TEXT_TYPES: Array<ComponentInputType> = [
  ComponentInputType.LongText,
  ComponentInputType.Markdown,
  ComponentInputType.AnyValue,
];

const JSON_TYPES: Array<ComponentInputType> = [
  ComponentInputType.JSON,
  ComponentInputType.JSONArray,
  ComponentInputType.BaseModel,
  ComponentInputType.BaseModelArray,
  ComponentInputType.Query,
  ComponentInputType.Select,
];

const CHOICE_TYPES: Array<ComponentInputType> = [
  ComponentInputType.Operator,
  ComponentInputType.ValueType,
  ComponentInputType.WorkflowSelect,
  ComponentInputType.IncidentTemplateSelect,
  ComponentInputType.CronTab,
];

export type ArgumentControlForFunction = (data: {
  type: ComponentInputType;
  value: unknown;
  /**
   * For a dictionary: whether its value can be shown as rows
   * (Utils.parseStringDictionaryValue). One that cannot stays JSON.
   */
  isRowsDictionary?: boolean | undefined;
}) => ArgumentControl;

export const argumentControlFor: ArgumentControlForFunction = (data: {
  type: ComponentInputType;
  value: unknown;
  isRowsDictionary?: boolean | undefined;
}): ArgumentControl => {
  const type: ComponentInputType = data.type;

  if (ONE_LINE_TEXT_TYPES.includes(type)) {
    return ArgumentControl.Text;
  }

  if (MULTI_LINE_TEXT_TYPES.includes(type)) {
    return ArgumentControl.MultiLineText;
  }

  if (
    type === ComponentInputType.Number ||
    type === ComponentInputType.Decimal
  ) {
    return ArgumentControl.Number;
  }

  if (type === ComponentInputType.Password) {
    return ArgumentControl.Password;
  }

  if (type === ComponentInputType.Boolean) {
    return ArgumentControl.Boolean;
  }

  if (type === ComponentInputType.Date) {
    return ArgumentControl.Date;
  }

  if (type === ComponentInputType.DateTime) {
    return ArgumentControl.DateTime;
  }

  if (type === ComponentInputType.HTML) {
    return ArgumentControl.HTMLCode;
  }

  if (type === ComponentInputType.StringDictionary) {
    return data.isRowsDictionary
      ? ArgumentControl.KeyValueRows
      : ArgumentControl.JSONCode;
  }

  if (JSON_TYPES.includes(type)) {
    return ArgumentControl.JSONCode;
  }

  /*
   * A choice that somehow holds a reference (an imported workflow, say) is
   * shown as the reference it is, rather than as a choice it is not.
   */
  if (CHOICE_TYPES.includes(type) && containsTemplateExpression(data.value)) {
    return ArgumentControl.Text;
  }

  return ArgumentControl.Plain;
};
