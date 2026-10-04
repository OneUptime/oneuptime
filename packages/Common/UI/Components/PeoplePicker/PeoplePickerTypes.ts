import ObjectID from "../../../Types/ObjectID";
import type { DropdownOption } from "../Dropdown/Dropdown";
import type { DropdownChange } from "../Dropdown/DropdownChange";

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
 * Kinds are pluggable: a new one is a member here and a definition in
 * PeoplePickerKinds.ts - search, look up by id, avatar - and every picker can
 * offer it. An escalation rule's Notify field offers on-call schedules,
 * teams and people in one list.
 *
 * A picker takes any number of picks, unless its field says it takes one
 * (PeoplePickerFieldConfig.isSinglePick): an incoming call rule calls one
 * on-call schedule or one person. A pick then replaces the last one, and
 * each kind's form value holds that one id, or null, instead of a list - the
 * shape of a record's own column for one related record (userId,
 * onCallDutyPolicyScheduleId), which can then be the value key itself.
 *
 * Two pickers in one form can ask about two different people: a user
 * override asks who is away and who covers. The second one's search list
 * leaves out whoever the first one holds (PeoplePickerFieldConfig.
 * excludePicksOf), so nobody is offered to cover for themselves.
 */

export enum PeoplePickerKind {
  User = "user",
  Team = "team",
  // Pages whoever is on call in it: an escalation rule's responders.
  OnCallSchedule = "onCallSchedule",
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
export type PeoplePickerValue = Partial<
  Record<PeoplePickerKind, Array<string>>
>;

/*
 * What a change picked, by name: the picks the picker holds now and the ones
 * it held before, in the order it shows them. A form can then name
 * something after the people and teams picked without a request of its own
 * - an owner rule is named "Add Platform as owners". Only picks the picker
 * can name are in it: one whose name is still being looked up, or that is no
 * longer found, is left out rather than handed over by its id.
 */
export interface PeoplePickerChange {
  selectedOptions: Array<PeoplePickerOption>;
  previousOptions: Array<PeoplePickerOption>;
}

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
  /*
   * One pick at most, of any kind. Picking replaces what was picked and
   * closes the list, and each kind's form value is one id, or null, rather
   * than a list (PeoplePickerFormValue). Leave it out for any number.
   */
  isSinglePick?: boolean | undefined;
  /*
   * Other form values whose picks this picker's search list leaves out, as
   * the form holds them now: a user override's "Who covers?" never offers
   * the person who is away. Only the list - a pick already made is shown as
   * it is, and the field's own validation says what is wrong with it.
   */
  excludePicksOf?: Array<PeoplePickerFieldKind> | undefined;
}

/*
 * What a picker field writes to one kind's form value: the kind's ids, or,
 * when the field takes a single pick, the one id or null.
 */
export type PeoplePickerFormValue = Array<string> | string | null;

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

/*
 * What a picker field's search list leaves out: the picks held now in the
 * form values its excludePicksOf names, as ids per kind. Empty when it names
 * none.
 */
export const readPeoplePickerExcludedValue: (
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

  for (const entry of config.excludePicksOf || []) {
    const ids: Array<string> = [...(result[entry.kind] || [])];

    for (const id of toPeoplePickerIds(values[entry.valueKey])) {
      if (!ids.includes(id)) {
        ids.push(id);
      }
    }

    result[entry.kind] = ids;
  }

  return result;
};

// A value's picks as keys (getPeoplePickerOptionKey), to look a row up in.
export const getPeoplePickerValueKeySet: (
  value: PeoplePickerValue | undefined,
) => Set<string> = (value: PeoplePickerValue | undefined): Set<string> => {
  const keys: Set<string> = new Set<string>();

  for (const kind of Object.keys(value || {}) as Array<PeoplePickerKind>) {
    for (const id of (value || {})[kind] || []) {
      keys.add(getPeoplePickerOptionKey(kind, id));
    }
  }

  return keys;
};

/*
 * One kind's form value in the shape the field writes it: whatever a form
 * holds (ids, ObjectIDs, related rows) as its list of ids, or - for a field
 * that takes a single pick - its first id, or null when there is none.
 */
export const toPeoplePickerFormValue: (
  config: PeoplePickerFieldConfig,
  value: unknown,
) => PeoplePickerFormValue = (
  config: PeoplePickerFieldConfig,
  value: unknown,
): PeoplePickerFormValue => {
  const ids: Array<string> = toPeoplePickerIds(value);

  if (config.isSinglePick) {
    return ids[0] || null;
  }

  return ids;
};

// The form values a picker field's picks are written to.
export const toPeoplePickerFormValues: (
  config: PeoplePickerFieldConfig,
  value: PeoplePickerValue,
) => Record<string, PeoplePickerFormValue> = (
  config: PeoplePickerFieldConfig,
  value: PeoplePickerValue,
): Record<string, PeoplePickerFormValue> => {
  const result: Record<string, PeoplePickerFormValue> = {};

  for (const entry of config.kinds) {
    result[entry.valueKey] = toPeoplePickerFormValue(config, value[entry.kind]);
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

/*
 * The value of a picker that takes a single pick, once this one is picked:
 * it alone, whatever kind was picked before.
 */
export const replacePeoplePickerValue: (
  kind: PeoplePickerKind,
  id: string,
) => PeoplePickerValue = (
  kind: PeoplePickerKind,
  id: string,
): PeoplePickerValue => {
  return { [kind]: [id] };
};

/*
 * The names of a value's picks, in the order the picker shows them: by kind,
 * then as picked. A pick the picker cannot name yet (getOption has nothing)
 * or no longer finds (isUnknown) is left out.
 */
export const getPeoplePickerNamedOptions: (data: {
  kinds: Array<PeoplePickerKind>;
  value: PeoplePickerValue;
  getOption: (
    kind: PeoplePickerKind,
    id: string,
  ) => PeoplePickerOption | undefined;
}) => Array<PeoplePickerOption> = (data: {
  kinds: Array<PeoplePickerKind>;
  value: PeoplePickerValue;
  getOption: (
    kind: PeoplePickerKind,
    id: string,
  ) => PeoplePickerOption | undefined;
}): Array<PeoplePickerOption> => {
  const options: Array<PeoplePickerOption> = [];

  for (const kind of data.kinds) {
    for (const id of data.value[kind] || []) {
      const option: PeoplePickerOption | undefined = data.getOption(kind, id);

      if (option && !option.isUnknown && option.name) {
        options.push(option);
      }
    }
  }

  return options;
};

/*
 * A picker's change in the words a form field's onChange hears it in
 * (Forms/Types/Field): each pick as an option labelled with its name, whose
 * value is the pick's key (getPeoplePickerOptionKey), so a person and a team
 * of one name stay two picks.
 */
export const toPeoplePickerDropdownChange: (
  change: PeoplePickerChange,
) => DropdownChange = (change: PeoplePickerChange): DropdownChange => {
  const toDropdownOption: (option: PeoplePickerOption) => DropdownOption = (
    option: PeoplePickerOption,
  ): DropdownOption => {
    return {
      value: getPeoplePickerOptionKey(option.kind, option.id),
      label: option.name,
    };
  };

  return {
    selectedOptions: change.selectedOptions.map(toDropdownOption),
    previousOptions: change.previousOptions.map(toDropdownOption),
  };
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
