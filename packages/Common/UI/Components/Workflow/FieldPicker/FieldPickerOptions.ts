/*
 * The fields a record step's two field lists offer, and how a stored value
 * reads as the fields it names.
 *
 *   - Fields to pass on (stored as "select"), on the On Create and On Update
 *     triggers and the Find steps: the record's fields the next steps can
 *     use. A related record's fields can be passed on too ("Current Incident
 *     State › Name").
 *   - Fields to watch (stored as "listen-on"), on the On Update trigger: the
 *     fields whose change runs the workflow. Only what an update can change:
 *     a related record is watched by the column holding its ID, which is
 *     what an update changes (Types/Workflow/WatchedFields), and never by one
 *     of its own fields, which no update of this record reports.
 *
 * Grouped the way people think of a record, as the "Add a field" picker of
 * the Query and record editors is (ColumnPickerOptions): its main fields, the
 * other ones, its related records, and what OneUptime fills in.
 *
 * Kept free of React and of the API, so every rule is tested on its own.
 */

import { JSONObject } from "../../../../Types/JSON";
import { isAlwaysEmptyColumnId } from "../../../../Types/Workflow/SystemColumns";
import { columnTypeLabel } from "../ColumnEditor/ColumnControl";
import { isColumnDescriptionInformative } from "../ColumnEditor/ColumnPickerOptions";
import { isSystemColumn } from "../ColumnEditor/ColumnUse";
import { ModelSchemaColumn } from "../ModelSchema";
import {
  translateTemplate,
  translationKey,
} from "../../../Utils/TranslateTemplate";

export enum FieldPickerMode {
  // Fields to pass on: what the next steps get.
  PassOn = "PassOn",
  // Fields to watch: what an update has to change to run the workflow.
  Watch = "Watch",
}

export enum FieldGroupId {
  Main = "main",
  Other = "other",
  Related = "related",
  System = "system",
}

// The separator between a related record and one of its fields.
export const FIELD_PATH_SEPARATOR: string = ".";
export const FIELD_TITLE_SEPARATOR: string = " › ";

const ID_COLUMN: string = "_id";

// What a related record is called by, listed first among its fields.
const RELATED_NAME_COLUMNS: Array<string> = ["name", "title"];

/*
 * Never changed by an update, so never worth watching: set once, when the
 * record is created.
 */
const SET_ON_CREATE_COLUMNS: Array<string> = [
  ID_COLUMN,
  "createdAt",
  "createdByUserId",
  "createdByUser",
];

export interface FieldOption {
  /*
   * What picking it stores: "title", a related record's field
   * "currentIncidentState.name", a watched relation's ID column
   * "currentIncidentStateId".
   */
  path: string;
  // As the list and its chip name it: "Title", "Current Incident State › Name".
  title: string;
  // Its own name, for a related record's field listed under that record: "Name".
  shortTitle: string;
  // The kind of value, in a word: "Text", "Date and time", "Record".
  typeLabel: string;
  // The column's type as the schema gives it, which a search reads.
  columnType: string;
  description?: string | undefined;
  group: FieldGroupId;
  // A related record's field: the related record's path ("currentIncidentState").
  relationPath?: string | undefined;
  // ... and its name ("Current Incident State").
  relationTitle?: string | undefined;
  // Pass on only: a related record, opened to its fields rather than picked.
  isRelation?: boolean | undefined;
  // How many fields a related record has, to say so before it is opened.
  fieldCount?: number | undefined;
  /*
   * A related record's fields are listed name first, then its own fields,
   * then what OneUptime fills in: 0, 1, 2.
   */
  rank?: number | undefined;
  /*
   * Keys a stored value may name it by besides its path: a watched relation
   * stored as "currentIncidentState" by the old list, now stored by its ID
   * column.
   */
  aliases: Array<string>;
}

export interface FieldGroup {
  id: FieldGroupId;
  label: string;
  hint?: string | undefined;
  options: Array<FieldOption>;
}

export const FieldPickerOptionsCopy: {
  readonly mainFields: string;
  readonly otherFields: string;
  readonly relatedRecords: string;
  readonly relatedHint: string;
  readonly filledIn: string;
  readonly record: string;
  readonly records: string;
  readonly noSuchField: string;
  readonly wholeRelation: string;
  readonly unexpectedValue: string;
  readonly tooDeep: string;
  readonly notAnObject: string;
} = {
  mainFields: translationKey("Main fields"),
  otherFields: translationKey("Other fields"),
  relatedRecords: translationKey("Related records"),
  relatedHint: translationKey("Open one to pick its fields"),
  filledIn: translationKey("Filled in by OneUptime"),
  record: translationKey("Record"),
  records: translationKey("Records"),
  noSuchField: translationKey(
    "There is no field called “{{key}}”, so the run leaves it out.",
  ),
  wholeRelation: translationKey(
    "“{{key}}” passes on the whole related record. Pick the fields of it the next steps need.",
  ),
  unexpectedValue: translationKey("“{{key}}” has an unexpected value."),
  tooDeep: translationKey("“{{key}}” goes more than one related record deep."),
  notAnObject: translationKey("The current value isn't valid JSON."),
};

type IsRelationColumnFunction = (column: ModelSchemaColumn) => boolean;

const isManyRelation: IsRelationColumnFunction = (
  column: ModelSchemaColumn,
): boolean => {
  return column.isRelation && column.type === "Entity Array";
};

type TypeLabelFunction = (column: ModelSchemaColumn) => string;

const typeLabelOf: TypeLabelFunction = (column: ModelSchemaColumn): string => {
  if (column.isRelation) {
    return isManyRelation(column)
      ? FieldPickerOptionsCopy.records
      : FieldPickerOptionsCopy.record;
  }

  return columnTypeLabel(column);
};

export interface GetFieldOptionsOptions {
  columns: Array<ModelSchemaColumn>;
  mode: FieldPickerMode;
  // The column that names a record: its title or name (ModelExamples).
  displayColumnId?: string | undefined;
  /*
   * The columns a stored value already names, kept listed even where the
   * list would leave them out (Deleted At), so they can be seen and removed.
   */
  storedPaths?: Array<string> | undefined;
}

type GetFieldOptionsFunction = (
  options: GetFieldOptionsOptions,
) => Array<FieldOption>;

/**
 * Every field the list offers, in no particular order: its groups and the
 * search put them in one.
 */
export const getFieldOptions: GetFieldOptionsFunction = (
  options: GetFieldOptionsOptions,
): Array<FieldOption> => {
  const stored: Array<string> = options.storedPaths || [];
  const columns: Array<ModelSchemaColumn> = options.columns.filter(
    (column: ModelSchemaColumn): boolean => {
      return !column.isTenantColumn;
    },
  );

  // The ID columns a relation to one record stands for, when watching.
  const relationIdColumns: Set<string> = new Set<string>();

  if (options.mode === FieldPickerMode.Watch) {
    for (const column of columns) {
      if (
        column.isRelation &&
        !isManyRelation(column) &&
        column.relationIdColumn &&
        columns.some((candidate: ModelSchemaColumn): boolean => {
          return candidate.id === column.relationIdColumn;
        })
      ) {
        relationIdColumns.add(column.relationIdColumn);
      }
    }
  }

  // Number columns a record is given once, when it is created.
  const numberColumns: Set<string> = new Set<string>();

  for (const column of columns) {
    if (
      columns.some((candidate: ModelSchemaColumn): boolean => {
        return candidate.id === `${column.id}WithPrefix`;
      })
    ) {
      numberColumns.add(column.id);
      numberColumns.add(`${column.id}WithPrefix`);
    }
  }

  /*
   * Passing on, a relation to one record is listed with its fields, so the
   * column holding its ID ("Current Incident State ID") is one of the other
   * fields rather than a main one beside it.
   */
  const listedRelationIdColumns: Set<string> = new Set<string>(
    columns
      .filter((column: ModelSchemaColumn): boolean => {
        return column.isRelation && Boolean(column.relationIdColumn);
      })
      .map((column: ModelSchemaColumn): string => {
        return column.relationIdColumn as string;
      }),
  );

  const requiredIdColumns: Set<string> = new Set<string>(
    columns
      .filter((column: ModelSchemaColumn): boolean => {
        return Boolean(column.required) && !isSystemColumn(column);
      })
      .map((column: ModelSchemaColumn): string => {
        return column.id;
      }),
  );

  type GroupOfFunction = (column: ModelSchemaColumn) => FieldGroupId;

  const groupOf: GroupOfFunction = (column: ModelSchemaColumn): FieldGroupId => {
    if (column.id === options.displayColumnId) {
      return FieldGroupId.Main;
    }

    if (column.isRelation) {
      // A relation is main when the record cannot be without it.
      const idColumn: string | undefined = column.relationIdColumn;

      if (idColumn && requiredIdColumns.has(idColumn)) {
        return FieldGroupId.Main;
      }

      return options.mode === FieldPickerMode.Watch
        ? FieldGroupId.Other
        : FieldGroupId.Related;
    }

    if (isSystemColumn(column)) {
      return FieldGroupId.System;
    }

    if (
      options.mode === FieldPickerMode.PassOn &&
      listedRelationIdColumns.has(column.id)
    ) {
      return FieldGroupId.Other;
    }

    return column.required ? FieldGroupId.Main : FieldGroupId.Other;
  };

  const result: Array<FieldOption> = [];

  for (const column of columns) {
    const isStored: boolean = stored.includes(column.id);

    if (isAlwaysEmptyColumnId(column.id) && !isStored) {
      continue;
    }

    const description: string | undefined = isColumnDescriptionInformative(
      column,
    )
      ? column.description
      : undefined;

    if (options.mode === FieldPickerMode.Watch) {
      if (
        (SET_ON_CREATE_COLUMNS.includes(column.id) ||
          numberColumns.has(column.id)) &&
        !isStored
      ) {
        continue;
      }

      // Its relation stands for it.
      if (relationIdColumns.has(column.id)) {
        continue;
      }

      if (column.isRelation) {
        const idColumn: string | undefined = isManyRelation(column)
          ? undefined
          : column.relationIdColumn;

        // A relation to one record without its ID column cannot be watched.
        if (!isManyRelation(column) && !relationIdColumns.has(idColumn || "")) {
          continue;
        }

        result.push({
          path: idColumn || column.id,
          title: column.title || column.id,
          shortTitle: column.title || column.id,
          typeLabel: typeLabelOf(column),
          columnType: column.type,
          description: description,
          group: groupOf(column),
          aliases: idColumn ? [column.id] : [],
        });
        continue;
      }

      result.push({
        path: column.id,
        title: column.title || column.id,
        shortTitle: column.title || column.id,
        typeLabel: typeLabelOf(column),
        columnType: column.type,
        description: description,
        group: groupOf(column),
        aliases: [],
      });
      continue;
    }

    if (column.isRelation) {
      const storedSubPaths: Array<string> = stored
        .filter((path: string): boolean => {
          return path.startsWith(`${column.id}${FIELD_PATH_SEPARATOR}`);
        })
        .map((path: string): string => {
          return path.slice(column.id.length + 1);
        });

      const subColumns: Array<ModelSchemaColumn> = (
        column.relatedColumns || []
      ).filter((sub: ModelSchemaColumn): boolean => {
        return (
          !sub.isRelation &&
          (!isAlwaysEmptyColumnId(sub.id) || storedSubPaths.includes(sub.id))
        );
      });

      if (subColumns.length === 0) {
        continue;
      }

      const group: FieldGroupId = groupOf(column);

      result.push({
        path: column.id,
        title: column.title || column.id,
        shortTitle: column.title || column.id,
        typeLabel: typeLabelOf(column),
        columnType: column.type,
        description: description,
        group: group,
        isRelation: true,
        fieldCount: subColumns.length,
        aliases: [],
      });

      for (const sub of subColumns) {
        const rank: number = RELATED_NAME_COLUMNS.includes(sub.id)
          ? 0
          : isSystemColumn(sub)
            ? 2
            : 1;

        result.push({
          path: `${column.id}${FIELD_PATH_SEPARATOR}${sub.id}`,
          title: `${column.title || column.id}${FIELD_TITLE_SEPARATOR}${
            sub.title || sub.id
          }`,
          shortTitle: sub.title || sub.id,
          typeLabel: typeLabelOf(sub),
          columnType: sub.type,
          description: isColumnDescriptionInformative(sub)
            ? sub.description
            : undefined,
          group: group,
          relationPath: column.id,
          relationTitle: column.title || column.id,
          rank: rank,
          aliases: [],
        });
      }

      continue;
    }

    result.push({
      path: column.id,
      title: column.title || column.id,
      shortTitle: column.title || column.id,
      typeLabel: typeLabelOf(column),
      columnType: column.type,
      description: description,
      group: groupOf(column),
      aliases: [],
    });
  }

  return result;
};

type CompareOptionsFunction = (a: FieldOption, b: FieldOption) => number;

const byTitle: CompareOptionsFunction = (
  a: FieldOption,
  b: FieldOption,
): number => {
  return a.shortTitle.localeCompare(b.shortTitle);
};

// A related record's fields: its name first, then its fields, then OneUptime's.
const byRankThenTitle: CompareOptionsFunction = (
  a: FieldOption,
  b: FieldOption,
): number => {
  return (a.rank || 0) - (b.rank || 0) || byTitle(a, b);
};

type GetFieldGroupsFunction = (data: {
  options: Array<FieldOption>;
  displayColumnId?: string | undefined;
}) => Array<FieldGroup>;

/**
 * The groups the list is browsed in, empty ones left out. The field that
 * names a record leads its group; the record ID leads what OneUptime fills
 * in. A related record's fields are listed under it, not here.
 */
export const getFieldGroups: GetFieldGroupsFunction = (data: {
  options: Array<FieldOption>;
  displayColumnId?: string | undefined;
}): Array<FieldGroup> => {
  type InGroupFunction = (id: FieldGroupId) => Array<FieldOption>;

  const inGroup: InGroupFunction = (id: FieldGroupId): Array<FieldOption> => {
    return data.options
      .filter((option: FieldOption): boolean => {
        return option.group === id && !option.relationPath;
      })
      .sort((a: FieldOption, b: FieldOption): number => {
        for (const first of [data.displayColumnId, ID_COLUMN]) {
          if (a.path === first) {
            return -1;
          }

          if (b.path === first) {
            return 1;
          }
        }

        return byTitle(a, b);
      });
  };

  const groups: Array<FieldGroup> = [
    {
      id: FieldGroupId.Main,
      label: FieldPickerOptionsCopy.mainFields,
      options: inGroup(FieldGroupId.Main),
    },
    {
      id: FieldGroupId.Other,
      label: FieldPickerOptionsCopy.otherFields,
      options: inGroup(FieldGroupId.Other),
    },
    {
      id: FieldGroupId.Related,
      label: FieldPickerOptionsCopy.relatedRecords,
      hint: FieldPickerOptionsCopy.relatedHint,
      options: inGroup(FieldGroupId.Related),
    },
    {
      id: FieldGroupId.System,
      label: FieldPickerOptionsCopy.filledIn,
      options: inGroup(FieldGroupId.System),
    },
  ];

  return groups.filter((group: FieldGroup): boolean => {
    return group.options.length > 0;
  });
};

const WHITESPACE: RegExp = /\s+/g;
const NOT_LETTER_OR_DIGIT: RegExp = /[^a-z0-9]/g;
const WORD_SPLIT: RegExp = /[^a-z0-9]+/;

type NormalizeFunction = (text: string) => string;

const normalizeText: NormalizeFunction = (text: string): string => {
  return text.toLowerCase().replace(WHITESPACE, " ").trim();
};

// "currentIncidentStateId" and "Current Incident State ID" read the same.
const compactText: NormalizeFunction = (text: string): string => {
  return text.toLowerCase().replace(NOT_LETTER_OR_DIGIT, "");
};

interface ScoredOption {
  option: FieldOption;
  score: number;
  position: number;
}

interface TextMatch {
  score: number;
  position: number;
}

type MatchNameFunction = (name: string, query: string) => TextMatch | null;

/*
 * How well a name matches what was typed: it is what was typed (0), starts
 * with it (1), has a word that starts with it (2), or holds it (3). Lower is
 * better; null is no match. The position is where the match starts, for
 * ties: the match nearest the start of the name wins.
 */
const matchName: MatchNameFunction = (
  name: string,
  query: string,
): TextMatch | null => {
  const text: string = normalizeText(name);
  const position: number = text.indexOf(query);

  if (text === query) {
    return { score: 0, position: 0 };
  }

  if (text.startsWith(query)) {
    return { score: 1, position: 0 };
  }

  if (
    text.split(WORD_SPLIT).some((word: string): boolean => {
      return word.startsWith(query);
    })
  ) {
    return { score: 2, position: position < 0 ? text.length : position };
  }

  if (position >= 0) {
    return { score: 3, position: position };
  }

  return null;
};

// How far behind its record's own fields a related record's field ranks.
const RELATED_BY_ITS_RECORD: number = 0.5;
const RELATED_BY_ITS_OWN_NAME: number = 4;

type ScoreOptionFunction = (
  option: FieldOption,
  query: string,
  tokens: Array<string>,
) => ScoredOption | null;

/*
 * Lower is better; null is no match.
 *
 * A record's own field is matched by its name, then its key ("incidentSev"
 * finds incidentSeverityId), then by every word appearing in its name, key,
 * description or kind of value - so "desc" + Enter picks Description and
 * "date" finds the date fields.
 *
 * A related record's field is found through that record first: "state"
 * lists Current Incident State's fields, name first, right after the
 * incident's own Current Incident State ID. A field found only by its own
 * name - every related record has a Name, and Docker Resources has a State
 * - comes after everything the record itself offers.
 */
const scoreOption: ScoreOptionFunction = (
  option: FieldOption,
  query: string,
  tokens: Array<string>,
): ScoredOption | null => {
  const compactQuery: string = compactText(query);
  const isRelated: boolean = Boolean(option.relationPath);

  type ResultFunction = (score: number, position: number) => ScoredOption;

  const result: ResultFunction = (
    score: number,
    position: number,
  ): ScoredOption => {
    return { option: option, score: score, position: position };
  };

  if (isRelated) {
    const byRecord: TextMatch | null = matchName(
      option.relationTitle || "",
      query,
    );

    if (byRecord && byRecord.score <= 2) {
      return result(byRecord.score + RELATED_BY_ITS_RECORD, byRecord.position);
    }

    const byOwnName: TextMatch | null = matchName(option.shortTitle, query);

    if (byOwnName) {
      return result(byOwnName.score + RELATED_BY_ITS_OWN_NAME, byOwnName.position);
    }
  } else {
    const byName: TextMatch | null = matchName(option.title, query);

    if (byName) {
      return result(byName.score, byName.position);
    }

    if (compactQuery && compactText(option.path).startsWith(compactQuery)) {
      return result(3, option.title.length);
    }
  }

  const haystack: string = normalizeText(
    [option.title, option.path, option.description || "", option.typeLabel].join(
      " ",
    ),
  );

  if (
    tokens.every((token: string): boolean => {
      return haystack.includes(token);
    })
  ) {
    return result(
      (isRelated ? RELATED_BY_ITS_OWN_NAME : 0) + 6,
      option.title.length,
    );
  }

  return null;
};

type SearchFieldOptionsFunction = (
  options: Array<FieldOption>,
  query: string,
) => Array<FieldOption>;

/**
 * The fields that match what was typed, best match first, a related
 * record's fields among them: "state name" finds Current Incident State ›
 * Name. A related record itself is not listed: its fields are.
 */
export const searchFieldOptions: SearchFieldOptionsFunction = (
  options: Array<FieldOption>,
  query: string,
): Array<FieldOption> => {
  const normalizedQuery: string = normalizeText(query);

  if (normalizedQuery === "") {
    return options.filter((option: FieldOption): boolean => {
      return !option.isRelation;
    });
  }

  const tokens: Array<string> = normalizedQuery.split(" ");
  const scored: Array<ScoredOption> = [];

  for (const option of options) {
    if (option.isRelation) {
      continue;
    }

    const scoredOption: ScoredOption | null = scoreOption(
      option,
      normalizedQuery,
      tokens,
    );

    if (scoredOption) {
      scored.push(scoredOption);
    }
  }

  // A related record the record cannot be without comes first among them.
  const isMainRelation: (option: FieldOption) => number = (
    option: FieldOption,
  ): number => {
    return option.relationPath && option.group !== FieldGroupId.Main ? 1 : 0;
  };

  scored.sort((a: ScoredOption, b: ScoredOption): number => {
    return (
      a.score - b.score ||
      a.position - b.position ||
      isMainRelation(a.option) - isMainRelation(b.option) ||
      (a.option.relationPath || "").localeCompare(b.option.relationPath || "") ||
      byRankThenTitle(a.option, b.option)
    );
  });

  return scored.map((scoredOption: ScoredOption): FieldOption => {
    return scoredOption.option;
  });
};

export interface ChosenFields {
  // What the value names, in its order, as the options' paths.
  paths: Array<string>;
  // Keys it names that are no field of the record.
  unknownPaths: Array<string>;
  /*
   * What the list cannot show. When there is any, the value is kept as JSON
   * and these say why.
   */
  problems: Array<string>;
}

type ReadStoredValueFunction = (
  value: unknown,
) => { text: string; parsed: JSONObject | null; isEmpty: boolean };

/** A stored value as text and, when it is a JSON object, that object. */
export const readStoredValue: ReadStoredValueFunction = (
  value: unknown,
): { text: string; parsed: JSONObject | null; isEmpty: boolean } => {
  if (value === null || value === undefined || value === "") {
    return { text: "", parsed: null, isEmpty: true };
  }

  if (typeof value === "string") {
    if (value.trim() === "") {
      return { text: value, parsed: null, isEmpty: true };
    }

    try {
      const parsed: unknown = JSON.parse(value);

      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return { text: value, parsed: parsed as JSONObject, isEmpty: false };
      }
    } catch {
      // Not JSON: kept as typed.
    }

    return { text: value, parsed: null, isEmpty: false };
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    return {
      text: JSON.stringify(value, null, 2),
      parsed: value as JSONObject,
      isEmpty: Object.keys(value as JSONObject).length === 0,
    };
  }

  return { text: String(value), parsed: null, isEmpty: false };
};

type StoredPathsFunction = (value: unknown) => Array<string>;

/*
 * Every key a stored value names, a related record's fields as
 * "relation.field", for listing them even where the list would not.
 */
export const getStoredPaths: StoredPathsFunction = (
  value: unknown,
): Array<string> => {
  const parsed: JSONObject | null = readStoredValue(value).parsed;

  if (!parsed) {
    return [];
  }

  const paths: Array<string> = [];

  for (const key of Object.keys(parsed)) {
    paths.push(key);

    const inner: unknown = parsed[key];

    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      for (const subKey of Object.keys(inner as JSONObject)) {
        paths.push(`${key}${FIELD_PATH_SEPARATOR}${subKey}`);
      }
    }
  }

  return paths;
};

type ReadChosenFieldsFunction = (data: {
  value: unknown;
  options: Array<FieldOption>;
  mode: FieldPickerMode;
}) => ChosenFields;

/**
 * The fields a stored value names. Watching, every key counts, whatever it
 * holds - as the trigger reads it - and a relation stored by its own name is
 * the field its ID column now stands for. Passing on, a field set to true is
 * chosen and one set to false is not; anything else the list cannot show,
 * and says why.
 */
export const readChosenFields: ReadChosenFieldsFunction = (data: {
  value: unknown;
  options: Array<FieldOption>;
  mode: FieldPickerMode;
}): ChosenFields => {
  const stored: { text: string; parsed: JSONObject | null; isEmpty: boolean } =
    readStoredValue(data.value);
  const chosen: ChosenFields = { paths: [], unknownPaths: [], problems: [] };

  if (stored.isEmpty) {
    return chosen;
  }

  if (!stored.parsed) {
    chosen.problems.push(FieldPickerOptionsCopy.notAnObject);
    return chosen;
  }

  type FindOptionFunction = (key: string) => FieldOption | undefined;

  const findOption: FindOptionFunction = (
    key: string,
  ): FieldOption | undefined => {
    return data.options.find((option: FieldOption): boolean => {
      return option.path === key || option.aliases.includes(key);
    });
  };

  type ChooseFunction = (path: string, isKnown: boolean) => void;

  const choose: ChooseFunction = (path: string, isKnown: boolean): void => {
    if (chosen.paths.includes(path)) {
      return;
    }

    chosen.paths.push(path);

    if (!isKnown) {
      chosen.unknownPaths.push(path);
    }
  };

  for (const key of Object.keys(stored.parsed)) {
    const value: unknown = stored.parsed[key];

    if (data.mode === FieldPickerMode.Watch) {
      const option: FieldOption | undefined = findOption(key);
      choose(option ? option.path : key, Boolean(option));
      continue;
    }

    const option: FieldOption | undefined = findOption(key);

    if (option?.isRelation) {
      if (value === true) {
        chosen.problems.push(
          translateTemplate(FieldPickerOptionsCopy.wholeRelation, { key: key }),
        );
        continue;
      }

      if (!value || typeof value !== "object" || Array.isArray(value)) {
        if (value !== false) {
          chosen.problems.push(
            translateTemplate(FieldPickerOptionsCopy.unexpectedValue, {
              key: key,
            }),
          );
        }

        continue;
      }

      for (const subKey of Object.keys(value as JSONObject)) {
        const subValue: unknown = (value as JSONObject)[subKey];
        const path: string = `${key}${FIELD_PATH_SEPARATOR}${subKey}`;

        if (subValue === false) {
          continue;
        }

        if (subValue && typeof subValue === "object") {
          chosen.problems.push(
            translateTemplate(FieldPickerOptionsCopy.tooDeep, { key: path }),
          );
          continue;
        }

        if (subValue !== true) {
          chosen.problems.push(
            translateTemplate(FieldPickerOptionsCopy.unexpectedValue, {
              key: path,
            }),
          );
          continue;
        }

        choose(path, Boolean(findOption(path)));
      }

      continue;
    }

    if (value === false) {
      continue;
    }

    if (value !== true) {
      chosen.problems.push(
        translateTemplate(FieldPickerOptionsCopy.unexpectedValue, { key: key }),
      );
      continue;
    }

    choose(option ? option.path : key, Boolean(option));
  }

  return chosen;
};

type WriteChosenFieldsFunction = (data: {
  paths: Array<string>;
  mode: FieldPickerMode;
}) => string;

/**
 * The value the fields are stored as: `{"title": true, "currentIncidentState":
 * {"name": true}}`, or "" for none - which the form reads as not filled in.
 */
export const writeChosenFields: WriteChosenFieldsFunction = (data: {
  paths: Array<string>;
  mode: FieldPickerMode;
}): string => {
  const value: JSONObject = {};

  for (const path of data.paths) {
    const separator: number = path.indexOf(FIELD_PATH_SEPARATOR);

    if (data.mode === FieldPickerMode.PassOn && separator > 0) {
      const relation: string = path.slice(0, separator);
      const field: string = path.slice(separator + 1);
      const existing: unknown = value[relation];
      const fields: JSONObject =
        existing && typeof existing === "object" && !Array.isArray(existing)
          ? (existing as JSONObject)
          : {};

      fields[field] = true;
      value[relation] = fields;
      continue;
    }

    value[path] = true;
  }

  return Object.keys(value).length > 0 ? JSON.stringify(value) : "";
};

export enum PanelRowKind {
  Heading = "Heading",
  Option = "Option",
}

export interface PanelRow {
  kind: PanelRowKind;
  // Heading rows: the group.
  group?: FieldGroup | undefined;
  // Option rows: the field, or a related record that opens to its fields.
  option?: FieldOption | undefined;
  // 1 for a related record's field listed under it.
  depth: number;
}

type GetPanelRowsFunction = (data: {
  options: Array<FieldOption>;
  groups: Array<FieldGroup>;
  query: string;
  // The related records opened to their fields.
  expanded: Array<string>;
}) => Array<PanelRow>;

/**
 * The rows the list shows. Browsing: each group under its heading, a
 * related record followed by its fields once it is opened. Searching: the
 * matching fields, best first, with no headings - what was typed says more
 * about the field wanted than which group it sits in.
 */
export const getPanelRows: GetPanelRowsFunction = (data: {
  options: Array<FieldOption>;
  groups: Array<FieldGroup>;
  query: string;
  expanded: Array<string>;
}): Array<PanelRow> => {
  if (data.query.trim() !== "") {
    return searchFieldOptions(data.options, data.query.trim()).map(
      (option: FieldOption): PanelRow => {
        return { kind: PanelRowKind.Option, option: option, depth: 0 };
      },
    );
  }

  const rows: Array<PanelRow> = [];
  // A lone heading over the whole list says nothing.
  const showHeadings: boolean = data.groups.length > 1;

  for (const group of data.groups) {
    if (showHeadings) {
      rows.push({ kind: PanelRowKind.Heading, group: group, depth: 0 });
    }

    for (const option of group.options) {
      rows.push({ kind: PanelRowKind.Option, option: option, depth: 0 });

      if (option.isRelation && data.expanded.includes(option.path)) {
        const fields: Array<FieldOption> = data.options
          .filter((candidate: FieldOption): boolean => {
            return candidate.relationPath === option.path;
          })
          .sort(byRankThenTitle);

        for (const field of fields) {
          rows.push({ kind: PanelRowKind.Option, option: field, depth: 1 });
        }
      }
    }
  }

  return rows;
};

type FindFieldOptionFunction = (
  options: Array<FieldOption>,
  path: string,
) => FieldOption | undefined;

/** The field a chosen path is, when the record has it. */
export const findFieldOption: FindFieldOptionFunction = (
  options: Array<FieldOption>,
  path: string,
): FieldOption | undefined => {
  return options.find((option: FieldOption): boolean => {
    return option.path === path && !option.isRelation;
  });
};
