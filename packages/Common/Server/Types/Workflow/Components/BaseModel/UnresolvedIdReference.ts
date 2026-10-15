import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { TableColumnMetadata } from "../../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../../Types/Database/TableColumnType";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject, JSONValue, ObjectType } from "../../../../../Types/JSON";
import ComponentMetadata, {
  Argument,
} from "../../../../../Types/Workflow/Component";
import {
  ParsedReferencePath,
  ReferenceRootType,
  parseReferencePath,
} from "../../../../../Types/Workflow/TemplateSyntax";
import { normalizeModelKeys } from "./ModelArguments";

/*
 * A {{...}} reference a run cannot resolve is left in the step's arguments
 * as the text it was written as: VMAPI.replaceValueInPlace skips it, and
 * RunWorkflow.logUnresolvedReferences notes it in the run log as a warning.
 * In a title or a message the step can still run with the text. In an ID it
 * cannot - a Query's currentIncidentStateId, the monitorId of a record the
 * step writes. The text went on to Postgres, which refused it as a uuid,
 *
 *   invalid input syntax for type uuid: "{{local.components.monitor-find-o...
 *
 * and the step failed with a database error that named neither the
 * reference nor the argument it was in. One cause is an earlier step that
 * found nothing: a Find One that matches no record returns no model, so
 * {{local.components.monitor-find-one-1.returnValues.model._id}} has nothing
 * to resolve to.
 *
 * So a database step reads the IDs in its Query and in the record it writes
 * before anything else, and one that is still a reference stops the step in
 * words that name the reference, the argument and the column.
 */

// Deeper than any Query or record a step is given; the walk stops there.
const MAX_DEPTH: number = 16;

// How much of a reference the message repeats.
const MAX_REFERENCE_LENGTH: number = 200;

/*
 * Operators that match an ID as text (ILIKE on the id cast to text): their
 * value is never read as a uuid, so a reference left in one is text the
 * step can run with, as in a title.
 */
const TEXT_MATCH_TYPES: ReadonlySet<string> = new Set<string>([
  ObjectType.Search,
  ObjectType.MultiSearch,
  ObjectType.StartsWith,
  ObjectType.EndsWith,
  ObjectType.NotContains,
  ObjectType.Wildcard,
  ObjectType.NotWildcard,
]);

export interface UnresolvedIdReference {
  // The ID column the reference was given for, e.g. currentIncidentStateId.
  columnName: string;
  // The reference, as it was written, e.g. {{local.variables.stateId}}.
  reference: string;
}

type FindReferenceInTextFunction = (text: string) => string | null;

/*
 * The first {{...}} in `text`, or null for none. Found with indexOf rather
 * than a regular expression: what a reference resolves to can be megabytes
 * long.
 */
const findReferenceInText: FindReferenceInTextFunction = (
  text: string,
): string | null => {
  const start: number = text.indexOf("{{");

  if (start === -1) {
    return null;
  }

  const end: number = text.indexOf("}}", start + 2);

  if (end === -1) {
    return null;
  }

  return text.slice(start, end + 2);
};

type FindReferenceInIdsFunction = (
  value: JSONValue,
  relatedModel: BaseModel | null,
  depth: number,
) => string | null;

/*
 * The first reference among the IDs in `value`: the filter on an ID column,
 * or the value written to one. A serialized value or operator
 * ({"_type": "Includes", "value": [...]}) holds IDs throughout. Under a
 * relation, a record or a filter on the related records
 * ({"_id": ..., "name": ...}) holds IDs in the related model's ID columns
 * only - a reference in a related record's name is left to the warning the
 * run already writes.
 */
const findReferenceInIds: FindReferenceInIdsFunction = (
  value: JSONValue,
  relatedModel: BaseModel | null,
  depth: number,
): string | null => {
  if (depth > MAX_DEPTH || value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    return findReferenceInText(value);
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const reference: string | null = findReferenceInIds(
        item,
        relatedModel,
        depth + 1,
      );

      if (reference) {
        return reference;
      }
    }

    return null;
  }

  if (typeof value !== "object") {
    return null;
  }

  const object: JSONObject = value as JSONObject;

  if (TEXT_MATCH_TYPES.has(object["_type"] as string)) {
    return null;
  }

  const isRelatedRecord: boolean =
    relatedModel !== null && object["_type"] === undefined;

  for (const key of Object.keys(object)) {
    if (
      isRelatedRecord &&
      relatedModel?.getTableColumnMetadata(key)?.type !==
        TableColumnType.ObjectID
    ) {
      continue;
    }

    const reference: string | null = findReferenceInIds(
      object[key] as JSONValue,
      null,
      depth + 1,
    );

    if (reference) {
      return reference;
    }
  }

  return null;
};

type FindUnresolvedIdReferenceFunction = (
  json: JSONObject,
  model: BaseModel,
) => UnresolvedIdReference | null;

/*
 * The first ID in `json` - a step's Query, or a record it writes - that is
 * still a {{...}} reference, or null when every ID resolved. An ID is the
 * value of a uuid column (TableColumnType.ObjectID: `_id`, and every key
 * naming another record) or an ID given for a relation.
 */
export const findUnresolvedIdReference: FindUnresolvedIdReferenceFunction = (
  json: JSONObject,
  model: BaseModel,
): UnresolvedIdReference | null => {
  // "id" is the `_id` column, as everywhere else a step reads (ModelArguments).
  const normalized: JSONObject = normalizeModelKeys(json, model);

  for (const columnName of Object.keys(normalized)) {
    const column: TableColumnMetadata | undefined =
      model.getTableColumnMetadata(columnName);

    if (!column) {
      continue;
    }

    let relatedModel: BaseModel | null = null;

    if (
      (column.type === TableColumnType.Entity ||
        column.type === TableColumnType.EntityArray) &&
      column.modelType
    ) {
      relatedModel = new column.modelType();
    } else if (column.type !== TableColumnType.ObjectID) {
      continue;
    }

    const reference: string | null = findReferenceInIds(
      normalized[columnName] as JSONValue,
      relatedModel,
      0,
    );

    if (reference) {
      return { columnName: columnName, reference: reference };
    }
  }

  return null;
};

type DescribeUnresolvedIdReferenceFunction = (data: {
  unresolved: UnresolvedIdReference;
  argumentName: string;
  // The record's place in a list of records (Create Many's JSON Array).
  itemNumber?: number | undefined;
}) => string;

// What the step says when it stops on a reference. See the comment at the top.
export const describeUnresolvedIdReference: DescribeUnresolvedIdReferenceFunction =
  (data: {
    unresolved: UnresolvedIdReference;
    argumentName: string;
    itemNumber?: number | undefined;
  }): string => {
    const isLong: boolean =
      data.unresolved.reference.length > MAX_REFERENCE_LENGTH;

    const reference: string = isLong
      ? `${data.unresolved.reference.slice(0, MAX_REFERENCE_LENGTH)}…`
      : data.unresolved.reference;

    // A reference too long to repeat is not read for advice: that repeats it.
    const path: ParsedReferencePath = isLong
      ? { rootType: ReferenceRootType.Unknown }
      : parseReferencePath(data.unresolved.reference.slice(2, -2).trim());

    let advice: string = "Check the reference.";

    if (path.rootType === ReferenceRootType.ComponentReturnValue) {
      advice = `Step "${path.componentId}" has not run, or did not return this value - a Find One that finds no record returns no model. Check the step id and the return value name, or handle the empty result before this step.`;
    } else if (
      path.rootType === ReferenceRootType.LocalVariable ||
      path.rootType === ReferenceRootType.GlobalVariable
    ) {
      advice = `Check that the variable "${path.variableName}" exists.`;
    } else if (path.reason) {
      advice = `It is not a reference this workflow can resolve: ${path.reason}.`;
    }

    const item: string = data.itemNumber ? ` (item ${data.itemNumber})` : "";

    /*
     * What happened first - the step stopped, and changed nothing - then
     * why, then what to do: the run window shows this under the step's
     * Error output, where it is read before anything else about the step.
     */
    return `The step stopped before reading or writing anything: ${reference} in "${data.argumentName}"${item} did not resolve, so "${data.unresolved.columnName}" has no ID. ${advice}`;
  };

type AssertIdsAreResolvedFunction = (data: {
  json: JSONObject;
  model: BaseModel;
  // The step's metadata and the argument `json` came from, to name it.
  metadata: ComponentMetadata;
  argumentId: string;
  itemNumber?: number | undefined;
}) => void;

/*
 * Refuses, with a BadDataException the step's error port reports, a Query
 * or a record whose IDs are not all resolved.
 */
export const assertIdsAreResolved: AssertIdsAreResolvedFunction = (data: {
  json: JSONObject;
  model: BaseModel;
  metadata: ComponentMetadata;
  argumentId: string;
  itemNumber?: number | undefined;
}): void => {
  const unresolved: UnresolvedIdReference | null = findUnresolvedIdReference(
    data.json,
    data.model,
  );

  if (!unresolved) {
    return;
  }

  const argument: Argument | undefined = data.metadata.arguments.find(
    (candidate: Argument) => {
      return candidate.id === data.argumentId;
    },
  );

  throw new BadDataException(
    describeUnresolvedIdReference({
      unresolved: unresolved,
      argumentName: argument?.name || data.argumentId,
      itemNumber: data.itemNumber,
    }),
  );
};
