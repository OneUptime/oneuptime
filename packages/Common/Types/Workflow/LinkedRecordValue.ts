/*
 * What a setting that names the project's records holds, as text and as the
 * list a step writes. No model and no API here: the column editor's pure
 * modules read and write these (Types/Workflow/LinkedRecord says which columns
 * they are).
 */

// The key a record's ID is written under in a list of records.
const ID_KEY: string = "_id";

/*
 * A list of related records as a step writes it: one object per record, each
 * naming the record by its ID. A list of bare IDs is not a list a step can
 * write - the model reads each item as a record's columns - so this one shape
 * is what the builder reads and writes.
 */
export interface LinkedRecordListItem {
  _id: string;
}

export type ReadLinkedRecordListFunction = (
  value: unknown,
) => Array<string> | null;

/**
 * The IDs a stored list names, or null for anything else: an item that says
 * more than its ID, or that spells it another way, is left for the JSON editor
 * rather than rewritten, so opening a workflow and saving it never changes it.
 */
export const readLinkedRecordList: ReadLinkedRecordListFunction = (
  value: unknown,
): Array<string> | null => {
  if (!Array.isArray(value)) {
    return null;
  }

  const ids: Array<string> = [];

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return null;
    }

    const keys: Array<string> = Object.keys(item);
    const id: unknown = (item as Record<string, unknown>)[ID_KEY];

    if (keys.length !== 1 || typeof id !== "string" || id.trim() === "") {
      return null;
    }

    ids.push(id);
  }

  return ids;
};

export type WriteLinkedRecordListFunction = (
  ids: Array<string>,
) => Array<LinkedRecordListItem>;

// The stored list of the IDs given, in their order.
export const writeLinkedRecordList: WriteLinkedRecordListFunction = (
  ids: Array<string>,
): Array<LinkedRecordListItem> => {
  return ids.map((id: string): LinkedRecordListItem => {
    return { _id: id };
  });
};

// A record's ID, the shape every one of them has.
const UUID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type IsRecordIdFunction = (value: string) => boolean;

export const isRecordId: IsRecordIdFunction = (value: string): boolean => {
  return UUID_PATTERN.test(value.trim());
};

export type SplitLinkedRecordIdsFunction = (value: unknown) => Array<string>;

/**
 * The entries of a setting that holds several records as text, separated by
 * commas: From Another Tool's Labels. A comma inside a {{...}} reference does
 * not separate anything.
 */
export const splitLinkedRecordIds: SplitLinkedRecordIdsFunction = (
  value: unknown,
): Array<string> => {
  if (typeof value !== "string") {
    return [];
  }

  const entries: Array<string> = [];
  let current: string = "";
  let depth: number = 0;

  for (let index: number = 0; index < value.length; index++) {
    const character: string = value.charAt(index);
    const next: string = value.charAt(index + 1);

    if (character === "{" && next === "{") {
      depth++;
      current += "{{";
      index++;
      continue;
    }

    if (character === "}" && next === "}" && depth > 0) {
      depth--;
      current += "}}";
      index++;
      continue;
    }

    if (character === "," && depth === 0) {
      entries.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  entries.push(current);

  return entries
    .map((entry: string): string => {
      return entry.trim();
    })
    .filter((entry: string): boolean => {
      return entry !== "";
    });
};
