/*
 * What the "Add a field" / "Add a condition" picker lists, in what order, and
 * what a search finds.
 *
 * The picker used to be one alphabetical dropdown in which every option was
 * "Created At · createdAt" over the column's full description, so a model's
 * fields arrived three to a screen and in no order that said which ones
 * mattered. This module decides that order from the model's own metadata, and
 * is kept free of React so it can be tested on its own:
 *
 *   Required     - what a create cannot do without (and has not got yet)
 *   Main fields  - what the model itself requires of every record: an
 *                  incident's title, state, severity and declared time. On a
 *                  create these are the required columns that carry a default,
 *                  so leaving them out is fine, but they are what people set.
 *                  On a query, the record ID leads, since "find this record"
 *                  is the commonest filter there is.
 *   Other fields - everything else
 *   Filled in by OneUptime - a query only: Created At, Created by User, the
 *                  record number and the rest of what OneUptime stamps. They
 *                  are good filters, so they stay, but below the model's own
 *                  fields rather than mixed in with them. A create or an update
 *                  never offers them at all (ColumnUse).
 */

import { ModelSchemaColumn } from "../ModelSchema";
import { columnTypeLabel } from "./ColumnControl";
import { ColumnUse, isSystemColumn } from "./ColumnUse";

export enum ColumnPickerGroupId {
  Required = "required",
  Main = "main",
  Other = "other",
  System = "system",
}

export interface ColumnPickerGroup {
  id: ColumnPickerGroupId;
  label: string;
  /** Says what the group means, where the label alone does not. */
  hint?: string | undefined;
  columns: Array<ModelSchemaColumn>;
}

export interface GroupPickerColumnsOptions {
  /** Already filtered to what may be offered for this use and is not on screen. */
  columns: Array<ModelSchemaColumn>;
  use: ColumnUse;
  /** Columns a create cannot do without - empty for an update or a query. */
  requiredColumnIds: Array<string>;
}

const PRIMARY_KEY_COLUMN: string = "_id";

type CompareColumnsFunction = (
  a: ModelSchemaColumn,
  b: ModelSchemaColumn,
) => number;

const byTitle: CompareColumnsFunction = (
  a: ModelSchemaColumn,
  b: ModelSchemaColumn,
): number => {
  return (a.title || a.id).localeCompare(b.title || b.id);
};

/*
 * The record ID first, then by title - the one place the picker departs from
 * alphabetical order, because "ID" is the condition most queries start with.
 */
const primaryKeyThenTitle: CompareColumnsFunction = (
  a: ModelSchemaColumn,
  b: ModelSchemaColumn,
): number => {
  if (a.id === PRIMARY_KEY_COLUMN) {
    return -1;
  }

  if (b.id === PRIMARY_KEY_COLUMN) {
    return 1;
  }

  return byTitle(a, b);
};

type IsMainColumnFunction = (
  column: ModelSchemaColumn,
  use: ColumnUse,
) => boolean;

const isMainColumn: IsMainColumnFunction = (
  column: ModelSchemaColumn,
  use: ColumnUse,
): boolean => {
  if (column.id === PRIMARY_KEY_COLUMN) {
    return use === ColumnUse.Filter;
  }

  /*
   * A required column OneUptime fills in - "Are Owners Notified Of Resource
   * Creation?" - is required of the database, not of the person building the
   * query, so it is not one of the record's main fields.
   */
  if (isSystemColumn(column)) {
    return false;
  }

  return Boolean(column.required);
};

type MainGroupHintFunction = (use: ColumnUse) => string | undefined;

const mainGroupHint: MainGroupHintFunction = (
  use: ColumnUse,
): string | undefined => {
  /*
   * Only a create needs saying: everything left in its Main group is required
   * but has a default, and a builder looking at a "required" field they have
   * not filled in deserves to know the step still works.
   */
  return use === ColumnUse.Create
    ? "Filled in for you if you leave them out"
    : undefined;
};

export type GroupPickerColumnsFunction = (
  options: GroupPickerColumnsOptions,
) => Array<ColumnPickerGroup>;

/**
 * The picker's groups, in display order, leaving out any that are empty.
 */
export const groupPickerColumns: GroupPickerColumnsFunction = (
  options: GroupPickerColumnsOptions,
): Array<ColumnPickerGroup> => {
  const required: Array<ModelSchemaColumn> = [];
  const main: Array<ModelSchemaColumn> = [];
  const other: Array<ModelSchemaColumn> = [];
  const system: Array<ModelSchemaColumn> = [];

  for (const column of options.columns) {
    if (options.requiredColumnIds.includes(column.id)) {
      required.push(column);
    } else if (isMainColumn(column, options.use)) {
      main.push(column);
    } else if (isSystemColumn(column)) {
      // Only a query is ever handed one; see ColumnUse.canUseColumnFor.
      system.push(column);
    } else {
      other.push(column);
    }
  }

  const groups: Array<ColumnPickerGroup> = [
    {
      id: ColumnPickerGroupId.Required,
      label: "Required",
      hint: "The record can't be created without them",
      columns: required.sort(byTitle),
    },
    {
      id: ColumnPickerGroupId.Main,
      label: "Main fields",
      hint: mainGroupHint(options.use),
      columns: main.sort(primaryKeyThenTitle),
    },
    {
      id: ColumnPickerGroupId.Other,
      label: "Other fields",
      columns: other.sort(byTitle),
    },
    {
      id: ColumnPickerGroupId.System,
      label: "Filled in by OneUptime",
      columns: system.sort(byTitle),
    },
  ];

  return groups.filter((group: ColumnPickerGroup) => {
    return group.columns.length > 0;
  });
};

type NormalizeFunction = (value: string) => string;

const normalize: NormalizeFunction = (value: string): string => {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
};

/*
 * "currentIncidentStateId" and "Current Incident State ID" are one name
 * spelled two ways. Compared with everything but letters and digits stripped,
 * they come out the same.
 */
const compact: NormalizeFunction = (value: string): string => {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
};

export type IsColumnKeyInformativeFunction = (
  column: ModelSchemaColumn,
) => boolean;

/**
 * Whether the column's key says anything its title does not.
 *
 * For most columns the title is the key with spaces put in - "Is Private?" is
 * isPrivate - and printing both is the "Created At · createdAt" noise the
 * picker exists to get rid of. Where they genuinely differ ("Should
 * subscribers be notified?" is shouldStatusPageSubscribersBeNotifiedOnIncidentCreated)
 * the key is the only way to tell the field apart from its neighbours, so it
 * is shown, quietly.
 */
export const isColumnKeyInformative: IsColumnKeyInformativeFunction = (
  column: ModelSchemaColumn,
): boolean => {
  return compact(column.id) !== compact(column.title || "");
};

export type IsColumnDescriptionInformativeFunction = (
  column: ModelSchemaColumn,
) => boolean;

/**
 * Whether the column's description says anything its title does not.
 *
 * Plenty of models describe a column with its own name - Incident's
 * "Incident Severity ID" is described as "Incident Severity ID" - and a
 * second line repeating the first is one more thing to read for nothing.
 */
export const isColumnDescriptionInformative: IsColumnDescriptionInformativeFunction =
  (column: ModelSchemaColumn): boolean => {
    const description: string = compact(column.description || "");

    return description !== "" && description !== compact(column.title || "");
  };

type ScoreColumnFunction = (
  column: ModelSchemaColumn,
  query: string,
  tokens: Array<string>,
) => number | null;

/*
 * Lower is better; null is no match. A title that starts with what was typed
 * beats one that merely contains it, which beats a match in the key, which
 * beats a match buried in the description - so "desc" + Enter picks
 * Description, not the first field whose description mentions a description.
 */
const scoreColumn: ScoreColumnFunction = (
  column: ModelSchemaColumn,
  query: string,
  tokens: Array<string>,
): number | null => {
  const title: string = normalize(column.title || "");
  const key: string = column.id.toLowerCase();
  const compactQuery: string = compact(query);

  if (title === query) {
    return 0;
  }

  if (title.startsWith(query)) {
    return 1;
  }

  const titleWords: Array<string> = title.split(/[^a-z0-9]+/);

  if (
    titleWords.some((word: string) => {
      return word.startsWith(query);
    })
  ) {
    return 2;
  }

  if (compactQuery && key.startsWith(compactQuery)) {
    return 3;
  }

  if (title.includes(query)) {
    return 4;
  }

  if (compactQuery && key.includes(compactQuery)) {
    return 5;
  }

  /*
   * Every word somewhere: the title, the key, the description, or the kind of
   * value - so "date" finds the date fields, and "notify status page" finds
   * "Should subscribers be notified?" by its description.
   */
  const haystack: string = normalize(
    [
      column.title || "",
      column.id,
      column.description || "",
      columnTypeLabel(column),
    ].join(" "),
  );

  if (
    tokens.every((token: string) => {
      return haystack.includes(token);
    })
  ) {
    return 6;
  }

  return null;
};

export type SearchPickerColumnsFunction = (
  columns: Array<ModelSchemaColumn>,
  query: string,
) => Array<ModelSchemaColumn>;

/**
 * The columns that match what was typed, best match first. An empty query
 * matches everything, in the order given.
 */
export const searchPickerColumns: SearchPickerColumnsFunction = (
  columns: Array<ModelSchemaColumn>,
  query: string,
): Array<ModelSchemaColumn> => {
  const normalizedQuery: string = normalize(query);

  if (normalizedQuery === "") {
    return columns;
  }

  const tokens: Array<string> = normalizedQuery.split(" ");

  const scored: Array<{ column: ModelSchemaColumn; score: number }> = [];

  for (const column of columns) {
    const score: number | null = scoreColumn(column, normalizedQuery, tokens);

    if (score !== null) {
      scored.push({ column: column, score: score });
    }
  }

  scored.sort(
    (
      a: { column: ModelSchemaColumn; score: number },
      b: { column: ModelSchemaColumn; score: number },
    ): number => {
      return a.score - b.score || byTitle(a.column, b.column);
    },
  );

  return scored.map((entry: { column: ModelSchemaColumn; score: number }) => {
    return entry.column;
  });
};

export type SummarizeDescriptionFunction = (
  description: string | undefined,
  maxLength?: number,
) => string;

/**
 * A description cut to fit one line of a dropdown option, at a word boundary.
 *
 * Where the picker draws its own list it truncates with CSS and keeps the whole
 * sentence in a tooltip. This is for the shared Dropdown, which wraps an
 * option's description in full - one 200-character description made a single
 * option four lines tall.
 */
export const summarizeDescription: SummarizeDescriptionFunction = (
  description: string | undefined,
  maxLength: number = 80,
): string => {
  const text: string = (description || "").replace(/\s+/g, " ").trim();

  if (text.length <= maxLength) {
    return text;
  }

  const cut: string = text.slice(0, maxLength - 1);
  const lastSpace: number = cut.lastIndexOf(" ");
  const atWord: string =
    lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut;

  return `${atWord.replace(/[\s,;:.\-–—(]+$/, "")}…`;
};
