import ObjectID from "../../../Types/ObjectID";

/*
 * The people picker's plain data: what kinds of record it picks, how a pick
 * is written down, and how a form value is read back. No React and no
 * network here, so a React-free module (BurnRateRuleForm.ts, the Forms On
 * Submit editor) can declare a picker field and an App test can read it.
 *
 * One picker searches every kind it is given in one list - people and teams
 * for owners - and keeps each kind's picks as a list of ids, in the form
 * value that kind always had (ownerUsers, ownerTeams). So a form that used
 * to ask with two dropdowns asks with one picker and saves exactly what it
 * saved before.
 *
 * Kinds are pluggable: a new one (on-call schedules, say) is a member here
 * and a definition in PeoplePickerKinds.ts - search, look up by id, avatar -
 * and every picker can offer it.
 */

export enum PeoplePickerKind {
  User = "user",
  Team = "team",
}

// One record the picker can show: in its search list, or as a picked chip.
export interface PeoplePickerOption {
  kind: PeoplePickerKind;
  id: string;
  name: string;
  // The line under the name in the search list: a person's email.
  description?: string | undefined;
  // A person's own id, to draw their profile picture.
  userId?: string | undefined;
  hasProfilePicture?: boolean | undefined;
  /*
   * Picked once, but no longer found: a person who left the project, a
   * deleted team. Still shown, so it can be removed.
   */
  isUnknown?: boolean | undefined;
}

// The picks, as ids per kind.
export type PeoplePickerValue = Partial<Record<PeoplePickerKind, Array<string>>>;

// A kind a form field offers, and the form value its picks are kept in.
export interface PeoplePickerFieldKind {
  kind: PeoplePickerKind;
  valueKey: string;
}

export interface PeoplePickerFieldConfig {
  // In the order the search list shows them.
  kinds: Array<PeoplePickerFieldKind>;
  // The button that opens the search list, e.g. "Add owner".
  addButtonText?: string | undefined;
  searchPlaceholder?: string | undefined;
  // What the search list says when there is nothing to pick at all.
  emptyText?: string | undefined;
}

/*
 * One pick, as a key: the kind and the id. Ids are compared without case -
 * a form may hold an id as it was typed into a setting and the server
 * answers with its own spelling.
 */
export const getPeoplePickerOptionKey: (
  kind: PeoplePickerKind,
  id: string,
) => string = (kind: PeoplePickerKind, id: string): string => {
  return `${kind}:${id.toLowerCase()}`;
};

/*
 * The id one entry of a form value names. A form value holds whatever put it
 * there: a picker's id strings, ObjectIDs from initial values, related rows
 * ({ _id }) from a fetched record, or a dropdown's { value } options.
 */
const readId: (entry: unknown) => string | null = (
  entry: unknown,
): string | null => {
  if (entry === undefined || entry === null) {
    return null;
  }

  if (typeof entry === "string") {
    return entry.trim() || null;
  }

  if (entry instanceof ObjectID) {
    return entry.toString().trim() || null;
  }

  if (typeof entry === "object") {
    const record: Record<string, unknown> = entry as Record<string, unknown>;

    for (const key of ["_id", "value"]) {
      const candidate: unknown = record[key];

      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }

      if (candidate instanceof ObjectID) {
        return candidate.toString().trim() || null;
      }
    }
  }

  return null;
};

// The ids a form value names, in order, each once.
export const toPeoplePickerIds: (value: unknown) => Array<string> = (
  value: unknown,
): Array<string> => {
  const entries: Array<unknown> = Array.isArray(value)
    ? value
    : value === undefined || value === null || value === ""
      ? []
      : [value];

  const ids: Array<string> = [];

  for (const entry of entries) {
    const id: string | null = readId(entry);

    if (id && !ids.includes(id)) {
      ids.push(id);
    }
  }

  return ids;
};

export const getPeoplePickerKinds: (
  config: PeoplePickerFieldConfig,
) => Array<PeoplePickerKind> = (
  config: PeoplePickerFieldConfig,
): Array<PeoplePickerKind> => {
  return config.kinds.map((entry: PeoplePickerFieldKind): PeoplePickerKind => {
    return entry.kind;
  });
};

// Every form value a picker field writes.
export const getPeoplePickerValueKeys: (
  config: PeoplePickerFieldConfig,
) => Array<string> = (config: PeoplePickerFieldConfig): Array<string> => {
  return config.kinds.map((entry: PeoplePickerFieldKind): string => {
    return entry.valueKey;
  });
};

// A picker field's picks, read from the form's values.
export const readPeoplePickerFormValue: (
  config: PeoplePickerFieldConfig,
  formValues: unknown,
) => PeoplePickerValue = (
  config: PeoplePickerFieldConfig,
  formValues: unknown,
): PeoplePickerValue => {
  const values: Record<string, unknown> =
    formValues && typeof formValues === "object"
      ? (formValues as Record<string, unknown>)
      : {};

  const result: PeoplePickerValue = {};

  for (const entry of config.kinds) {
    result[entry.kind] = toPeoplePickerIds(values[entry.valueKey]);
  }

  return result;
};

// The form values a picker field's picks are written to.
export const toPeoplePickerFormValues: (
  config: PeoplePickerFieldConfig,
  value: PeoplePickerValue,
) => Record<string, Array<string>> = (
  config: PeoplePickerFieldConfig,
  value: PeoplePickerValue,
): Record<string, Array<string>> => {
  const result: Record<string, Array<string>> = {};

  for (const entry of config.kinds) {
    result[entry.valueKey] = toPeoplePickerIds(value[entry.kind]);
  }

  return result;
};

export const countPeoplePickerValue: (value: PeoplePickerValue) => number = (
  value: PeoplePickerValue,
): number => {
  let count: number = 0;

  for (const ids of Object.values(value)) {
    count += (ids || []).length;
  }

  return count;
};

// The value with one pick added (once) or taken away.
export const addToPeoplePickerValue: (
  value: PeoplePickerValue,
  kind: PeoplePickerKind,
  id: string,
) => PeoplePickerValue = (
  value: PeoplePickerValue,
  kind: PeoplePickerKind,
  id: string,
): PeoplePickerValue => {
  const ids: Array<string> = value[kind] || [];

  if (ids.includes(id)) {
    return value;
  }

  return { ...value, [kind]: [...ids, id] };
};

export const removeFromPeoplePickerValue: (
  value: PeoplePickerValue,
  kind: PeoplePickerKind,
  id: string,
) => PeoplePickerValue = (
  value: PeoplePickerValue,
  kind: PeoplePickerKind,
  id: string,
): PeoplePickerValue => {
  return {
    ...value,
    [kind]: (value[kind] || []).filter((candidate: string): boolean => {
      return candidate !== id;
    }),
  };
};
