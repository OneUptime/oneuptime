/*
 * What a {{...}} in a step's setting comes to when it finds no value.
 *
 * A workflow's message used to go out with the reference in it, braces and all,
 * whatever the reason there was no value (issue 5761, an alert raised by an SLO:
 * "Monitor: {{local.components.alert-on-create-1.returnValues.model.monitor.name}}").
 * Those reasons are not alike, and neither is what the people reading the message
 * and the person who wrote the workflow need:
 *
 *   - The record has nothing there: the monitor of an alert no monitor raised, a
 *     description nobody wrote, the record of a Find One that found none, a
 *     custom field this incident does not hold. Nothing is wrong, so the value
 *     comes through empty, and a run's full log says so.
 *   - The step does not pass the field on. The workflow has a mistake, and the
 *     builder says what the value is here: empty. It comes through empty, with a
 *     warning on the step saying what to add to its Fields to pass on.
 *   - The reference points at nothing: a mistyped step, value or field, or a step
 *     that did not run. Nothing can be said about what was meant, so it is left as
 *     written for someone to see, with a warning on the step.
 *
 * A step that reads or writes records is the exception, and so are the settings
 * below: they keep the reference as written. An ID that is left blank is not
 * harmless the way it is in a message - a Query's {"monitorId": null} matches
 * every record with no monitor, on a Delete Many too - so those steps stop on the
 * reference instead (UnresolvedIdReference), before reading or writing anything.
 */

import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { TableColumnMetadata } from "../Database/TableColumn";
import TableColumnType from "../Database/TableColumnType";
import { JSONObject, JSONValue } from "../JSON";
import ComponentMetadata, {
  Argument,
  ComponentInputType,
  NodeDataProp,
  ReturnValue,
} from "./Component";
import { SELECT_FIELDS_NAME } from "./Components/BaseModel";
import { getWorkflowModel } from "./Documentation/ModelExamples";
import {
  getFieldPathInRecord,
  getFieldPathSegments,
  isFieldPassedOn,
  namesNoFieldsUnder,
} from "./PassedOnFields";
import {
  ParsedReferencePath,
  ReferenceRootType,
  parseReferencePath,
  pathPastReturnValue,
} from "./TemplateSyntax";

/*
 * Settings that say something to someone, or carry data for another system. Not
 * here, and so keeping a reference as written: a URL, whose address must not
 * quietly become another; JavaScript, where `const x = {{...}};` must stay code;
 * and what must be exactly one thing to mean anything - a password, a date, a
 * number, a true or false, a cron schedule, an email address, a choice and every
 * list picked from the project's own records.
 */
const SETTINGS_THAT_TAKE_EMPTY_VALUES: ReadonlyArray<ComponentInputType> = [
  ComponentInputType.Text,
  ComponentInputType.LongText,
  ComponentInputType.Markdown,
  ComponentInputType.HTML,
  ComponentInputType.AnyValue,
  ComponentInputType.JSON,
  ComponentInputType.JSONArray,
  ComponentInputType.StringDictionary,
  ComponentInputType.SwitchCases,
];

type TakesEmptyValuesFunction = (data: {
  metadata: ComponentMetadata;
  argument: Argument;
}) => boolean;

/** Whether a reference with no value comes through empty in this setting. */
export const takesEmptyValues: TakesEmptyValuesFunction = (data: {
  metadata: ComponentMetadata;
  argument: Argument;
}): boolean => {
  return (
    !data.metadata.tableName &&
    SETTINGS_THAT_TAKE_EMPTY_VALUES.includes(data.argument.type)
  );
};

export enum RecordFieldReadingKind {
  // Empty, and a mistake: the step does not pass the field on.
  NotPassedOn = "NotPassedOn",
  // Empty, and fine: inside a JSON field that holds no such key.
  NotInJSONField = "NotInJSONField",
  // No such field on the record: mistyped, and left as written.
  NoSuchField = "NoSuchField",
}

export interface RecordFieldReading {
  kind: RecordFieldReadingKind;
  // The step whose record it reads.
  step: NodeDataProp;
  // What it reads in the record: "monitor.name".
  fieldPath: string;
}

type ReadRecordFieldFunction = (data: {
  // The reference's path: local.components.x.returnValues.model.monitor.name.
  path: string;
  // A step of the workflow, by its id.
  getStep: (componentId: string) => NodeDataProp | undefined;
  // The run's values, as a reference reads them.
  storageMap: JSONObject;
}) => RecordFieldReading | null;

type ReturnedValueFunction = (data: {
  storageMap: JSONObject;
  componentId: string;
  returnValueId: string;
}) => JSONValue | undefined;

// What the step returned by that name, or undefined when it has not returned it.
const returnedValue: ReturnedValueFunction = (data: {
  storageMap: JSONObject;
  componentId: string;
  returnValueId: string;
}): JSONValue | undefined => {
  const local: JSONObject | undefined = data.storageMap["local"] as
    | JSONObject
    | undefined;
  const components: JSONObject | undefined = local?.["components"] as
    | JSONObject
    | undefined;
  const component: JSONObject | undefined = components?.[data.componentId] as
    | JSONObject
    | undefined;
  const returnValues: JSONObject | undefined = component?.["returnValues"] as
    | JSONObject
    | undefined;

  return returnValues?.[data.returnValueId] as JSONValue | undefined;
};

/**
 * What a reference that found nothing reads of an earlier step's record, when it
 * reads one that step did return. Null for anything else, which nothing can be
 * said about: not a record, a step that did not run, a model it does not know.
 */
export const readRecordField: ReadRecordFieldFunction = (data: {
  path: string;
  getStep: (componentId: string) => NodeDataProp | undefined;
  storageMap: JSONObject;
}): RecordFieldReading | null => {
  const parsed: ParsedReferencePath = parseReferencePath(data.path);

  if (parsed.rootType !== ReferenceRootType.ComponentReturnValue) {
    return null;
  }

  const componentId: string = parsed.componentId as string;
  const returnValueId: string = parsed.returnValueId as string;
  const step: NodeDataProp | undefined = data.getStep(componentId);

  if (!step?.metadata?.tableName) {
    return null;
  }

  const returnValue: ReturnValue | undefined = (
    step.metadata.returnValues || []
  ).find((candidate: ReturnValue): boolean => {
    return candidate.id === returnValueId;
  });

  const fieldPath: string | null = getFieldPathInRecord(
    returnValue,
    pathPastReturnValue(data.path),
  );

  if (
    !fieldPath ||
    returnedValue({
      storageMap: data.storageMap,
      componentId: componentId,
      returnValueId: returnValueId,
    }) === undefined
  ) {
    return null;
  }

  const model: BaseModel | null = getWorkflowModel(step.metadata.tableName);

  if (!model) {
    return null;
  }

  const segments: Array<string> = getFieldPathSegments(fieldPath);
  const relatedName: string | undefined = segments[1];

  const column: TableColumnMetadata | undefined = segments[0]
    ? model.getTableColumnMetadata(segments[0])
    : undefined;

  const reading: (kind: RecordFieldReadingKind) => RecordFieldReading = (
    kind: RecordFieldReadingKind,
  ): RecordFieldReading => {
    return { kind: kind, step: step, fieldPath: fieldPath };
  };

  if (!column) {
    return reading(RecordFieldReadingKind.NoSuchField);
  }

  if (
    relatedName &&
    column.modelType &&
    !new column.modelType().getTableColumnMetadata(relatedName)
  ) {
    return reading(RecordFieldReadingKind.NoSuchField);
  }

  if (!isFieldPassedOn(step, fieldPath)) {
    return reading(RecordFieldReadingKind.NotPassedOn);
  }

  /*
   * A related record asked for without naming any of its fields passes on none
   * of them: {"monitor": true} reads the monitor's ID and nothing else
   * (SelectUtil.sanitizeSelect), so its name has to be named to be there.
   */
  if (
    relatedName &&
    column.modelType &&
    segments.length === 2 &&
    namesNoFieldsUnder(step, segments[0] as string)
  ) {
    return reading(RecordFieldReadingKind.NotPassedOn);
  }

  // A key inside a JSON field: a custom field this record does not hold.
  if (relatedName && column.type === TableColumnType.JSON) {
    return reading(RecordFieldReadingKind.NotInJSONField);
  }

  return null;
};

type IsEmptyRecordFieldFunction = (
  reading: RecordFieldReading | null,
) => boolean;

/** Whether what a reference reads of a record comes through empty. */
export const isEmptyRecordField: IsEmptyRecordFieldFunction = (
  reading: RecordFieldReading | null,
): boolean => {
  return (
    reading?.kind === RecordFieldReadingKind.NotPassedOn ||
    reading?.kind === RecordFieldReadingKind.NotInJSONField
  );
};

type WhatToDoAboutFunction = (reading: RecordFieldReading) => string;

/**
 * What a run's warning says about a field of a record, for whoever wrote the
 * workflow to act on: a sentence naming the step and what to change on it.
 */
export const whatToDoAboutRecordField: WhatToDoAboutFunction = (
  reading: RecordFieldReading,
): string => {
  const title: string = reading.step.metadata?.title || reading.step.id;

  if (reading.kind === RecordFieldReadingKind.NoSuchField) {
    return `"${title}" returns no field called ${reading.fieldPath}. Check its spelling.`;
  }

  // Passed on, and not there: nothing to add, on a setting that keeps it as written.
  if (reading.kind === RecordFieldReadingKind.NotInJSONField) {
    return `The record "${title}" returned holds no ${reading.fieldPath}.`;
  }

  if ((reading.step.metadataId || "").endsWith("-on-delete")) {
    return `"${title}" passes on only the ID: the record is already gone.`;
  }

  return `"${title}" does not pass on ${reading.fieldPath}. Add it to that step's ${SELECT_FIELDS_NAME}.`;
};
