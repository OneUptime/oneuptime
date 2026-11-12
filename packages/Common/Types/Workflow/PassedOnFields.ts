/*
 * Which fields of a record a step passes on to the steps after it: its Fields
 * to pass on (stored as "select").
 *
 * Everything that talks about a field a step does not pass on reads it here,
 * so they agree: the value picker lists such a field apart, a chip that reads
 * one turns amber, the workflow's checks say so, and a run warns about it
 * (EmptyValues).
 *
 * Paths are read with loops: what a reference reads can be any length, and a
 * regular expression's quantifier is not safe on a long one
 * (Docs/notifications/README.md, "Megabyte-long values").
 */

import { JSONObject } from "../JSON";
import { ComponentInputType, NodeDataProp, ReturnValue } from "./Component";

// The record ID, which a record step always passes on.
const ID_COLUMN: string = "_id";

export const RELATION_FIELD_SEPARATOR: string = ".";

type SelectedColumnIdsFunction = (
  component: NodeDataProp,
) => Array<string> | null;

/**
 * The fields a database step actually reads, from its Fields to pass on
 * (stored as "select"); null when that cannot be told, in which case every
 * field is offered alike. A related record's fields are "relation.field".
 * The record's ID is always passed on.
 *
 * An On Delete trigger receives the record's ID and nothing else.
 */
export const selectedColumnIds: SelectedColumnIdsFunction = (
  component: NodeDataProp,
): Array<string> | null => {
  if ((component.metadataId || "").endsWith("-on-delete")) {
    return [ID_COLUMN];
  }

  const hasSelectArgument: boolean = Boolean(
    component.metadata?.arguments?.some((arg: { id: string }) => {
      return arg.id === "select";
    }),
  );

  if (!hasSelectArgument) {
    return null;
  }

  let select: unknown = component.arguments?.["select"];

  if (typeof select === "string") {
    if (select.trim() === "") {
      return null;
    }

    try {
      select = JSON.parse(select);
    } catch {
      return null;
    }
  }

  if (!select || typeof select !== "object" || Array.isArray(select)) {
    return null;
  }

  const ids: Array<string> = [];

  for (const key of Object.keys(select as JSONObject)) {
    const value: unknown = (select as JSONObject)[key];

    if (!value) {
      continue;
    }

    ids.push(key);

    if (typeof value === "object" && !Array.isArray(value)) {
      for (const subKey of Object.keys(value as JSONObject)) {
        if ((value as JSONObject)[subKey]) {
          ids.push(`${key}${RELATION_FIELD_SEPARATOR}${subKey}`);
        }
      }
    }
  }

  if (ids.length === 0) {
    return null;
  }

  return ids.includes(ID_COLUMN) ? ids : [ID_COLUMN, ...ids];
};

type IsFieldCharacterFunction = (character: string) => boolean;

const isFieldCharacter: IsFieldCharacterFunction = (
  character: string,
): boolean => {
  return (
    (character >= "a" && character <= "z") ||
    (character >= "A" && character <= "Z") ||
    (character >= "0" && character <= "9") ||
    character === "_" ||
    character === "-"
  );
};

type FieldNameOfFunction = (segment: string) => string;

// The name a path's segment starts with: "items" of "items[0]".
const fieldNameOf: FieldNameOfFunction = (segment: string): string => {
  let end: number = 0;

  while (end < segment.length && isFieldCharacter(segment.charAt(end))) {
    end++;
  }

  return segment.slice(0, end);
};

type GetFieldPathSegmentsFunction = (path: string) => Array<string>;

/**
 * The fields a path into a record names, each as its name alone:
 * "monitor.name" is ["monitor", "name"].
 */
export const getFieldPathSegments: GetFieldPathSegmentsFunction = (
  path: string,
): Array<string> => {
  return path.split(RELATION_FIELD_SEPARATOR).map(fieldNameOf);
};

type IsFieldPassedOnFunction = (step: NodeDataProp, path: string) => boolean;

/**
 * Whether a record step passes on the field a path into its record reads:
 * "title", or a related record's field "currentIncidentState.name". True
 * when the step's Fields to pass on cannot be read, as nothing can be said.
 */
export const isFieldPassedOn: IsFieldPassedOnFunction = (
  step: NodeDataProp,
  path: string,
): boolean => {
  const selected: Array<string> | null = selectedColumnIds(step);

  if (!selected) {
    return true;
  }

  const segments: Array<string> = getFieldPathSegments(path);
  const field: string = segments[0] || "";

  if (!field) {
    return true;
  }

  if (!selected.includes(field)) {
    return false;
  }

  // A related record's field is passed on only when it is named...
  const relatedField: string = segments[1] || "";
  const passesRelatedFields: boolean = selected.some((id: string): boolean => {
    return id.startsWith(`${field}${RELATION_FIELD_SEPARATOR}`);
  });

  return (
    !relatedField ||
    // ... but for its ID, which comes with it whichever fields are named.
    relatedField === ID_COLUMN ||
    !passesRelatedFields ||
    selected.includes(`${field}${RELATION_FIELD_SEPARATOR}${relatedField}`)
  );
};

type NamesNoFieldsUnderFunction = (
  step: NodeDataProp,
  field: string,
) => boolean;

/**
 * Whether a step's Fields to pass on name a key and none of the fields under
 * it: {"monitor": true}. For a related record that reads its ID alone
 * (SelectUtil.sanitizeSelect), and for a JSON field all of its keys, which only
 * a model can tell apart.
 */
export const namesNoFieldsUnder: NamesNoFieldsUnderFunction = (
  step: NodeDataProp,
  field: string,
): boolean => {
  const selected: Array<string> | null = selectedColumnIds(step);

  return (
    Boolean(selected) &&
    selected!.includes(field) &&
    !selected!.some((id: string): boolean => {
      return id.startsWith(`${field}${RELATION_FIELD_SEPARATOR}`);
    })
  );
};

type GetFieldPathInRecordFunction = (
  returnValue: ReturnValue | undefined,
  pathPastValue: string,
) => string | null;

/**
 * The field of a record that what follows a step's return value reads: past
 * "model", "monitor.name"; past "models", the "monitor.name" of "[0].monitor.name".
 * Null when the return value is not a record or a list of them, or what follows
 * does not read a field of one - the "length" of a list.
 */
export const getFieldPathInRecord: GetFieldPathInRecordFunction = (
  returnValue: ReturnValue | undefined,
  pathPastValue: string,
): string | null => {
  if (!pathPastValue) {
    return null;
  }

  if (returnValue?.type === ComponentInputType.BaseModel) {
    return pathPastValue;
  }

  if (
    returnValue?.type !== ComponentInputType.BaseModelArray ||
    !pathPastValue.startsWith("[")
  ) {
    return null;
  }

  const separator: string = `]${RELATION_FIELD_SEPARATOR}`;
  const end: number = pathPastValue.indexOf(separator);

  return end === -1 ? null : pathPastValue.slice(end + separator.length);
};

type ReadsFieldNotPassedOnFunction = (data: {
  step: NodeDataProp;
  returnValue: ReturnValue | undefined;
  pathPastValue: string;
}) => boolean;

/**
 * Whether what follows a step's return value reads a field of its record that
 * the step does not pass on.
 */
export const readsFieldNotPassedOn: ReadsFieldNotPassedOnFunction = (data: {
  step: NodeDataProp;
  returnValue: ReturnValue | undefined;
  pathPastValue: string;
}): boolean => {
  const fieldPath: string | null = getFieldPathInRecord(
    data.returnValue,
    data.pathPastValue,
  );

  return Boolean(fieldPath) && !isFieldPassedOn(data.step, fieldPath as string);
};
