/*
 * The values Run Workflow starts a run with, as the trigger would receive
 * them for real.
 *
 * The panel's JSON boxes - a Webhook's Request Body, the Manual trigger's
 * JSON - hold text while they are edited. The panel meant to turn that text
 * into JSON before sending it, but read the wrong part of the step for it
 * (its return values, not the values typed into the panel), so the text was
 * sent as it was. A Webhook started from Run Workflow then received its body
 * as one string, where a real request delivers an object: reading
 * `request-body.incident.title` worked for a real request and came back
 * empty for a test, and the value picker could never list a test request's
 * fields. Each value is now sent the way its trigger receives it for real.
 *
 * Text that is not valid JSON is sent as it was typed: the run says what is
 * wrong with it, as before.
 */

import { JSONObject, JSONValue } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import {
  Argument,
  ComponentInputType,
  NodeDataProp,
} from "../../../Types/Workflow/Component";
import {
  WHAT_HAPPENED_ID,
  WhatHappened,
  isCreateOrUpdateTrigger,
  readWhatHappened,
} from "../../../Types/Workflow/CreateOrUpdateTrigger";
import {
  RUN_RECORD_ARGUMENT_ID,
  getRunRecordArgument,
} from "../../../Types/Workflow/RunRecord";

// The run values whose boxes hold JSON as text.
export const JSON_RUN_VALUE_TYPES: ReadonlyArray<ComponentInputType> = [
  ComponentInputType.JSON,
  ComponentInputType.JSONArray,
  ComponentInputType.StringDictionary,
  ComponentInputType.BaseModel,
  ComponentInputType.BaseModelArray,
];

type GetRunValuesFunction = (component: NodeDataProp) => JSONObject;

/** What Run Workflow sends for the trigger: its values, JSON as JSON. */
export const getRunValues: GetRunValuesFunction = (
  component: NodeDataProp,
): JSONObject => {
  const values: JSONObject = { ...((component.arguments as JSONObject) || {}) };

  for (const argument of component.metadata?.runWorkflowManuallyArguments ||
    []) {
    const value: JSONValue | undefined = values[argument.id];

    if (
      typeof value !== "string" ||
      !JSON_RUN_VALUE_TYPES.includes((argument as Argument).type)
    ) {
      continue;
    }

    // An empty box is sent empty, as it always was.
    if (value.trim() === "") {
      continue;
    }

    try {
      values[argument.id] = JSONFunctions.parse(value) as JSONValue;
    } catch {
      // Sent as typed: the run reports what is wrong with it.
    }
  }

  // The record a record trigger runs with, without stray spaces.
  if (
    getRunRecordArgument(component.metadata) &&
    typeof values[RUN_RECORD_ARGUMENT_ID] === "string"
  ) {
    values[RUN_RECORD_ARGUMENT_ID] = (
      values[RUN_RECORD_ARGUMENT_ID] as string
    ).trim();
  }

  /*
   * On Create or Update runs as created until the panel's What Happened
   * says updated, and says so in what it sends rather than leaving the
   * server to assume it.
   */
  if (isCreateOrUpdateTrigger(component.metadata)) {
    values[WHAT_HAPPENED_ID] =
      readWhatHappened(values[WHAT_HAPPENED_ID]) || WhatHappened.Created;
  }

  return values;
};
