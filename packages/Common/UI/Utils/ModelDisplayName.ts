/*
 * What one record is called when a sentence has to name it.
 *
 * A delete confirmation used to ask "Are you sure you want to delete this
 * workflow?" - a sentence equally true of every workflow in the project, and
 * no help at the one moment the user wants to be sure which one is about to
 * go. This module is where the product decides what a record's name is, so
 * the Delete page, the table's row and bulk deletes and the custom dialogs all
 * say the same thing about the same record.
 */

/*
 * The parts of a model this module reads. Database and analytics models both
 * have hasColumn; only database models carry the slug and the declared
 * display column, so those two are optional.
 */
export interface DisplayNameModel {
  hasColumn: (columnName: string) => boolean;
  getSlugifyColumn?: (() => string | null) | undefined;
  getDisplayNameColumn?: (() => string | null) | undefined;
}

/*
 * The columns a record is worth naming itself by, in the order a person would
 * pick one:
 *
 *   - templateName: a template's own name. Incident and scheduled maintenance
 *     templates also carry a `title`, but that is the title of the incident or
 *     event the template creates, not the template's name.
 *   - name, title: almost everything. Incidents, alerts, episodes, scheduled
 *     maintenance and announcements key on `title`, and those are exactly the
 *     lists where deleting the row next to the one you meant hurts most.
 *   - displayName: inventory items and status page resources.
 *   - fullDomain, domain: custom domains, which have no name but the domain.
 *   - email, subscriberEmail, subscriberPhone, phoneNumber, username: people
 *     and subscriptions, which are known by how they are reached.
 */
export const DISPLAY_NAME_COLUMNS: ReadonlyArray<string> = [
  "templateName",
  "name",
  "title",
  "displayName",
  "fullDomain",
  "domain",
  "email",
  "subscriberEmail",
  "subscriberPhone",
  "phoneNumber",
  "username",
];

/*
 * Read from a record when none of the above is on it, but never chosen as the
 * column to fetch: a slug is derived from the record's name, so a model with
 * a slug always has the better column it was made from.
 */
const LAST_RESORT_COLUMNS: ReadonlyArray<string> = ["slug"];

/*
 * Names are shown in full up to this many characters. An exception message or
 * an incident title pasted from a stack trace can run to thousands, and the
 * dialog only has to say which one - the start of it does that.
 */
export const MAX_DISPLAY_NAME_LENGTH: number = 120;

/*
 * The column that names a record of this model, or null when it has none.
 *
 * A model may declare it (@TableMetadata's displayNameColumn) where the
 * inference below would pick the wrong column or none. Otherwise a model that
 * builds its slug from a column has told us its name column already (Incident
 * slugs its title, a template its templateName). Failing both, the first
 * column of DISPLAY_NAME_COLUMNS the model has.
 */
export const getDisplayNameColumn: (
  model: DisplayNameModel | null | undefined,
) => string | null = (
  model: DisplayNameModel | null | undefined,
): string | null => {
  if (!model) {
    return null;
  }

  const declaredColumn: string | null | undefined =
    model.getDisplayNameColumn?.();

  if (declaredColumn && model.hasColumn(declaredColumn)) {
    return declaredColumn;
  }

  const slugSourceColumn: string | null | undefined =
    model.getSlugifyColumn?.();

  if (slugSourceColumn && model.hasColumn(slugSourceColumn)) {
    return slugSourceColumn;
  }

  for (const column of DISPLAY_NAME_COLUMNS) {
    if (model.hasColumn(column)) {
      return column;
    }
  }

  return null;
};

/*
 * A value as one line of text, or "" when it is not something to call a
 * record by.
 *
 * Name, Email, Phone and Domain values arrive as objects whose toString is the
 * text; over the wire, before they are turned back into objects, they are
 * `{ _type, value }`. Dates, booleans, arrays and plain objects are never a
 * name - "[object Object]" in a confirmation is worse than no name at all.
 * Line breaks and runs of spaces are collapsed: the name sits inside a
 * sentence.
 */
export const readDisplayText: (value: unknown) => string = (
  value: unknown,
): string => {
  const collapse: (text: string) => string = (text: string): string => {
    return text.replace(/\s+/g, " ").trim();
  };

  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return collapse(value);
  }

  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }

  if (typeof value !== "object") {
    return "";
  }

  if (value instanceof Date || Array.isArray(value)) {
    return "";
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;

  if (typeof record["_type"] === "string" && "value" in record) {
    return readDisplayText(record["value"]);
  }

  if (
    typeof (value as { toString?: unknown }).toString !== "function" ||
    (value as { toString: unknown }).toString === Object.prototype.toString
  ) {
    return "";
  }

  const text: string = String(value);

  return text.startsWith("[object ") ? "" : collapse(text);
};

/*
 * Cuts a long name down to maxLength characters, ending in an ellipsis.
 * Counted in code points, so an emoji is never split in half.
 */
export const shortenDisplayName: (
  name: string,
  maxLength?: number,
) => string = (
  name: string,
  maxLength: number = MAX_DISPLAY_NAME_LENGTH,
): string => {
  const characters: Array<string> = Array.from(name);

  if (characters.length <= maxLength) {
    return name;
  }

  return `${characters
    .slice(0, Math.max(1, maxLength - 1))
    .join("")
    .trimEnd()}…`;
};

export interface GetRecordDisplayNameOptions {
  // The model the record belongs to; its display column is read first.
  model?: DisplayNameModel | null | undefined;
  // A column to read before any other - what the caller knows names it.
  column?: string | null | undefined;
  // Defaults to MAX_DISPLAY_NAME_LENGTH. 0 leaves the name whole.
  maxLength?: number | undefined;
}

/*
 * The name of one record, or "" when nothing on it names it.
 *
 * Reads only what is on the record: a table row carries the columns the table
 * selected and nothing else, so this never guesses at a name it was not given.
 * Relations are not followed. A team member row carries its user's name, but
 * "delete Jane Doe" would be a lie about a row that only takes Jane off a
 * team.
 */
export const getRecordDisplayName: (
  record: unknown,
  options?: GetRecordDisplayNameOptions,
) => string = (
  record: unknown,
  options?: GetRecordDisplayNameOptions,
): string => {
  if (!record || typeof record !== "object") {
    return "";
  }

  const fields: Record<string, unknown> = record as Record<string, unknown>;

  const columns: Array<string> = [];

  const addColumn: (column: string | null | undefined) => void = (
    column: string | null | undefined,
  ): void => {
    if (column && !columns.includes(column)) {
      columns.push(column);
    }
  };

  addColumn(options?.column);
  addColumn(getDisplayNameColumn(options?.model));
  DISPLAY_NAME_COLUMNS.forEach(addColumn);
  LAST_RESORT_COLUMNS.forEach(addColumn);

  for (const column of columns) {
    const text: string = readDisplayText(fields[column]);

    if (text) {
      return options?.maxLength === 0
        ? text
        : shortenDisplayName(text, options?.maxLength);
    }
  }

  return "";
};

export interface NameListSummary {
  // The names to list, in the order given.
  shownNames: Array<string>;
  // How many of the records are not in shownNames: the rest of a long list,
  // and every record that has no name.
  remainingCount: number;
}

/*
 * Which names a confirmation about many records lists, and how many it then
 * counts as "and N more".
 *
 * At most maxShown names - except that a list of exactly one more than that is
 * shown whole, because "and 1 more" takes the same line the name would have.
 * Records without a name are never listed, only counted. Two records with the
 * same name are both listed: the user selected two things.
 */
export const summarizeNames: (data: {
  names: Array<string>;
  totalCount: number;
  maxShown?: number | undefined;
}) => NameListSummary = (data: {
  names: Array<string>;
  totalCount: number;
  maxShown?: number | undefined;
}): NameListSummary => {
  const maxShown: number = Math.max(1, data.maxShown ?? 5);

  const names: Array<string> = data.names
    .map((name: string) => {
      return readDisplayText(name);
    })
    .filter((name: string) => {
      return name.length > 0;
    });

  const totalCount: number = Math.max(data.totalCount, names.length);

  const shownNames: Array<string> =
    names.length === totalCount && totalCount <= maxShown + 1
      ? names
      : names.slice(0, maxShown);

  return {
    shownNames: shownNames,
    remainingCount: totalCount - shownNames.length,
  };
};
