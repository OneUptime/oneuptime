/*
 * Running a workflow whose trigger acts on a record - On Create, On Update,
 * On Create or Update or On Delete Incident, and the same trigger of every
 * other model a workflow can watch - with a record a person can name.
 *
 * Run Workflow used to ask for the record's ID, a UUID nobody knows by heart:
 * "Instead of UUID can I enter the user-facing incident ID, for convenience?
 * Can you please make this generic". So the record is named the way people
 * name it:
 *
 *   - by its number, the one the product shows on every page and message:
 *     INC-8, an alert's ALT-12, a scheduled maintenance event's SM-3, an
 *     episode's IE-2 - with its prefix or without one ("8", "#8");
 *   - by its title or name ("Database is down");
 *   - or by its ID, as before.
 *
 * This module is the pure part: what a typed reference means, which columns
 * of a model it is looked up in, and how a record is named in the list. It is
 * generic: a model has a number when it has a numeric column with a
 * "<column>WithPrefix" text column beside it (incidentNumber and
 * incidentNumberWithPrefix), and a name when ModelExamples finds one, so a
 * new model gets both without anything here changing.
 *
 * The server looks the records up, in the workflow's project and with the
 * permissions of the person asking (Server/Utils/Workflow/RunRecordSearch);
 * the Run Workflow panel lists them (UI/Components/Workflow/RunRecordField).
 */

import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  NUMBER_WITH_PREFIX_SUFFIX,
  RecordNumberColumns,
  formatRecordNumber,
  getRecordNumberColumns,
} from "../../Utils/Project/RecordNumber";
import Dictionary from "../Dictionary";
import { JSONObject } from "../JSON";
import ObjectID from "../ObjectID";
import ComponentMetadata, { Argument, ComponentType } from "./Component";
import {
  WHAT_HAPPENED_ID,
  WhatHappened,
  readWhatHappened,
} from "./CreateOrUpdateTrigger";
import { DatabaseOperation, getDatabaseOperation } from "./DatabaseOperation";
import {
  ID_COLUMN_ID,
  getDisplayColumn,
  getWorkflowModel,
} from "./Documentation/ModelExamples";

// The run argument a record trigger is started with (Components/BaseModel).
export const RUN_RECORD_ARGUMENT_ID: string = "_id";

// The most records one search lists.
export const RUN_RECORD_SEARCH_LIMIT: number = 10;

// The longest search the server reads; anything longer is refused.
export const RUN_RECORD_SEARCH_MAX_LENGTH: number = 200;

// The most words of a name one search asks the database for.
export const RUN_RECORD_SEARCH_MAX_WORDS: number = 12;

/*
 * The largest record number there can be. Record numbers are Postgres
 * integers, and a number past this one is an error in the query, not a
 * record that does not exist.
 */
export const MAX_RUN_RECORD_NUMBER: number = 2147483647;

/*
 * Which columns number a model's records, and how a number is shown, are
 * the product's one rule for every place that names a numbered record
 * (Utils/Project/RecordNumber); a run looks records up by the same columns.
 */
export { NUMBER_WITH_PREFIX_SUFFIX, getRecordNumberColumns };
export type { RecordNumberColumns };

export enum RunRecordReferenceKind {
  // Nothing typed: the newest records are listed.
  Empty = "Empty",
  // A record's ID, a UUID.
  Id = "Id",
  // Ends in a number - INC-8, #8, 8 - and may be a record's number.
  Number = "Number",
  // Anything else: part of a title or a name.
  Text = "Text",
}

export interface RunRecordReference {
  kind: RunRecordReferenceKind;
  // What was typed, trimmed, with wide digits and letters made plain.
  text: string;
  // Kind Id: the ID, in lower case.
  id?: string | undefined;
  // Kind Number: the number at the end.
  number?: number | undefined;
  // Kind Number: what comes before it, as typed ("INC-", "#", "").
  prefix?: string | undefined;
}

// A UUID, the shape every record ID has.
const UUID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/*
 * A number at the end of what was typed, and what comes before it. Fifteen
 * digits at most: anything longer is no record's number, and is read as
 * text.
 */
const TRAILING_NUMBER_PATTERN: RegExp = /^([\s\S]*?)(\d{1,15})$/;

const WHITESPACE_PATTERN: RegExp = /\s+/g;

type ParseRunRecordReferenceFunction = (value: unknown) => RunRecordReference;

/**
 * What a reference typed into the Run Workflow panel means. NFKC turns a
 * full-width "ＩＮＣ－８" into "INC-8", so it is read the same.
 */
export const parseRunRecordReference: ParseRunRecordReferenceFunction = (
  value: unknown,
): RunRecordReference => {
  const text: string =
    typeof value === "string" ? value.normalize("NFKC").trim() : "";

  if (text === "") {
    return { kind: RunRecordReferenceKind.Empty, text: "" };
  }

  if (UUID_PATTERN.test(text)) {
    return {
      kind: RunRecordReferenceKind.Id,
      text: text,
      id: text.toLowerCase(),
    };
  }

  const numberMatch: RegExpMatchArray | null = text.match(
    TRAILING_NUMBER_PATTERN,
  );

  if (numberMatch) {
    const number: number = Number(numberMatch[2]);

    if (Number.isSafeInteger(number) && number <= MAX_RUN_RECORD_NUMBER) {
      return {
        kind: RunRecordReferenceKind.Number,
        text: text,
        number: number,
        prefix: numberMatch[1] || "",
      };
    }
  }

  return { kind: RunRecordReferenceKind.Text, text: text };
};

type NormalizeReferenceFunction = (text: string) => string;

// "INC - 8" and "inc-8" are one reference.
const normalizeReference: NormalizeReferenceFunction = (
  text: string,
): string => {
  return text.normalize("NFKC").replace(WHITESPACE_PATTERN, "").toLowerCase();
};

type IsRunRecordNumberMatchFunction = (data: {
  reference: RunRecordReference;
  // The record's number with its prefix, as stored: "INC-8", "#8".
  numberWithPrefix: string | null | undefined;
}) => boolean;

/**
 * Whether a record with the reference's number is the record meant. A bare
 * number ("8", "#8") names it whatever its prefix; a number with a prefix
 * names it only when that is the prefix it carries, so ALT-8 typed for an
 * incident is not INC-8. A record keeps the prefix it was numbered with, so
 * an incident numbered before the project's prefix changed is named by its
 * old one, as its page shows it.
 */
export const isRunRecordNumberMatch: IsRunRecordNumberMatchFunction = (data: {
  reference: RunRecordReference;
  numberWithPrefix: string | null | undefined;
}): boolean => {
  if (data.reference.kind !== RunRecordReferenceKind.Number) {
    return false;
  }

  const prefix: string = normalizeReference(data.reference.prefix || "");

  if (prefix === "" || prefix === "#") {
    return true;
  }

  if (!data.numberWithPrefix) {
    return false;
  }

  return (
    normalizeReference(data.numberWithPrefix) ===
    normalizeReference(data.reference.text)
  );
};

export interface RunRecordColumns {
  number: RecordNumberColumns | null;
  // The column that names a record - an incident's title - or null.
  nameColumn: string | null;
  // What the name column is called: "Title", "Name".
  nameTitle: string | null;
}

type GetRunRecordColumnsFunction = (model: BaseModel) => RunRecordColumns;

/** Where a record of this model is looked up: its number and its name. */
export const getRunRecordColumns: GetRunRecordColumnsFunction = (
  model: BaseModel,
): RunRecordColumns => {
  const display: { id: string; title: string } = getDisplayColumn(model);
  const hasName: boolean = display.id !== ID_COLUMN_ID;

  return {
    number: getRecordNumberColumns(model),
    nameColumn: hasName ? display.id : null,
    nameTitle: hasName ? display.title : null,
  };
};

// How a record was found, which orders the list: exact matches first.
export enum RunRecordMatch {
  Id = "Id",
  Number = "Number",
  Name = "Name",
  // Nothing was typed: one of the newest records.
  Recent = "Recent",
}

/** One record the Run Workflow panel lists. */
export interface RunRecordOption {
  id: string;
  // "INC-8", when the model numbers its records.
  number?: string | undefined;
  // "Database is down", when the model names its records.
  name?: string | undefined;
  // When it was created, as an ISO date.
  createdAt?: string | undefined;
  matchedBy: RunRecordMatch;
}

export interface RunRecordSearchResponse {
  records: Array<RunRecordOption>;
}

const RUN_RECORD_MATCHES: Array<string> = Object.values(RunRecordMatch);

type ParseRunRecordSearchResponseFunction = (
  data: unknown,
) => Array<RunRecordOption>;

/**
 * The records an answer from /run-records lists, keeping only what has the
 * shape of one: anything else in it is dropped rather than drawn.
 */
export const parseRunRecordSearchResponse: ParseRunRecordSearchResponseFunction =
  (data: unknown): Array<RunRecordOption> => {
    const records: unknown =
      data && typeof data === "object"
        ? (data as Dictionary<unknown>)["records"]
        : undefined;

    if (!Array.isArray(records)) {
      return [];
    }

    const options: Array<RunRecordOption> = [];

    for (const record of records) {
      if (!record || typeof record !== "object") {
        continue;
      }

      const values: Dictionary<unknown> = record as Dictionary<unknown>;
      const id: unknown = values["id"];
      const matchedBy: unknown = values["matchedBy"];

      if (typeof id !== "string" || id === "") {
        continue;
      }

      const option: RunRecordOption = {
        id: id,
        matchedBy:
          typeof matchedBy === "string" &&
          RUN_RECORD_MATCHES.includes(matchedBy)
            ? (matchedBy as RunRecordMatch)
            : RunRecordMatch.Name,
      };

      for (const key of ["number", "name", "createdAt"] as const) {
        const value: unknown = values[key];

        if (typeof value === "string" && value !== "") {
          option[key] = value;
        }
      }

      options.push(option);
    }

    return options;
  };

type FormatRunRecordNumberFunction = (data: {
  number: unknown;
  numberWithPrefix: unknown;
}) => string | undefined;

/*
 * "INC-8" as stored, else "#8", else nothing: a record's number as every
 * page shows it (RecordNumber's formatRecordNumber).
 */
export const formatRunRecordNumber: FormatRunRecordNumberFunction = (data: {
  number: unknown;
  numberWithPrefix: unknown;
}): string | undefined => {
  return formatRecordNumber(data);
};

type GetRunRecordSearchWordsFunction = (text: string) => Array<string>;

/**
 * The words of what was typed. A record is found by its name when the name
 * holds every one of them, in any order - how a title half remembered is
 * typed: "database down" finds "Database is down", and so does "down
 * database". At most RUN_RECORD_SEARCH_MAX_WORDS: the rest are left out
 * rather than sent to the database.
 */
export const getRunRecordSearchWords: GetRunRecordSearchWordsFunction = (
  text: string,
): Array<string> => {
  return text
    .normalize("NFKC")
    .split(WHITESPACE_PATTERN)
    .filter((word: string): boolean => {
      return word.length > 0;
    })
    .slice(0, RUN_RECORD_SEARCH_MAX_WORDS);
};

// The longest name the list shows; the rest is cut with an ellipsis.
export const RUN_RECORD_NAME_MAX_LENGTH: number = 120;

type ReadRunRecordTextFunction = (value: unknown) => string | undefined;

/*
 * A name as one line of text: a string, or a value the API sends as
 * { _type, value } (a Name, an Email). Anything else is no name. Cut at
 * RUN_RECORD_NAME_MAX_LENGTH characters, counted so an emoji is never split.
 */
export const readRunRecordText: ReadRunRecordTextFunction = (
  value: unknown,
): string | undefined => {
  let text: string = "";

  if (typeof value === "string") {
    text = value;
  } else if (
    value &&
    typeof value === "object" &&
    typeof (value as Dictionary<unknown>)["value"] === "string"
  ) {
    text = (value as Dictionary<unknown>)["value"] as string;
  } else if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { toString?: unknown }).toString === "function" &&
    (value as { toString: unknown }).toString !== Object.prototype.toString
  ) {
    text = String(value);
  }

  text = text.replace(WHITESPACE_PATTERN, " ").trim();

  if (text === "") {
    return undefined;
  }

  const characters: Array<string> = Array.from(text);

  if (characters.length <= RUN_RECORD_NAME_MAX_LENGTH) {
    return text;
  }

  return `${characters
    .slice(0, RUN_RECORD_NAME_MAX_LENGTH - 1)
    .join("")
    .trimEnd()}…`;
};

type GetRunRecordArgumentFunction = (
  metadata: ComponentMetadata | null | undefined,
) => Argument | null;

/**
 * The run argument that names the record a record trigger runs with, or null
 * for a trigger that does not run on a record (Webhook, Manual, Schedule...).
 */
export const getRunRecordArgument: GetRunRecordArgumentFunction = (
  metadata: ComponentMetadata | null | undefined,
): Argument | null => {
  if (
    !metadata ||
    metadata.componentType !== ComponentType.Trigger ||
    !metadata.tableName
  ) {
    return null;
  }

  return (
    (metadata.runWorkflowManuallyArguments || []).find(
      (argument: Argument): boolean => {
        return argument.id === RUN_RECORD_ARGUMENT_ID;
      },
    ) || null
  );
};

const CAPITALIZED_WORD_PATTERN: RegExp = /^\p{Lu}\p{Ll}+$/u;

type NameInSentenceFunction = (name: string) => string;

/*
 * A model's name in the middle of a sentence: "scheduled maintenance event",
 * keeping a word that is not simply capitalized as it is ("IoT Fleet" keeps
 * IoT).
 */
export const nameInSentence: NameInSentenceFunction = (
  name: string,
): string => {
  return name
    .split(" ")
    .map((word: string): string => {
      return CAPITALIZED_WORD_PATTERN.test(word) ? word.toLowerCase() : word;
    })
    .join(" ");
};

/*
 * What the server says when a record cannot be looked up or found. Server
 * text, read in the Run Workflow panel as the API words it, like every other
 * refusal of a run.
 */
export const RunRecordMessages: {
  cannotRead: (pluralName: string) => string;
  notARecordTrigger: string;
  searchTooLong: string;
  noRecordWithNumber: (data: { singularName: string; text: string }) => string;
  pickFromList: (singularName: string) => string;
} = {
  cannotRead: (pluralName: string): string => {
    return `You don't have permission to read ${nameInSentence(pluralName)}, so you can't look one up here.`;
  },
  notARecordTrigger:
    "This workflow's trigger doesn't run on a record, so there is nothing to look up.",
  searchTooLong: `Type at most ${RUN_RECORD_SEARCH_MAX_LENGTH} characters.`,
  noRecordWithNumber: (data: {
    singularName: string;
    text: string;
  }): string => {
    return `No ${nameInSentence(data.singularName)} in this project has the number ${data.text}.`;
  },
  pickFromList: (singularName: string): string => {
    return `Pick the ${nameInSentence(singularName)} to run with from the list, or type its number or ID.`;
  },
};

// What the run pretends just happened to the record.
export enum RunRecordEvent {
  Created = "Created",
  Updated = "Updated",
  Deleted = "Deleted",
  /*
   * On Create or Update: created or updated, as the run's What Happened
   * says (getRunRecordEvent). Never drawn as it is.
   */
  CreatedOrUpdated = "CreatedOrUpdated",
}

export interface RunRecordTriggerInfo {
  argument: Argument;
  event: RunRecordEvent;
  /*
   * On Create or Update's What Happened, which Run Workflow asks with the
   * record: whether the run is for the record being created or updated.
   */
  whatHappenedArgument?: Argument | undefined;
  // "Incident", "Scheduled Maintenance Event".
  singularName: string;
  pluralName: string;
  // Whether its records have numbers (INC-8) and names to look them up by.
  hasNumber: boolean;
  hasName: boolean;
}

type GetRunRecordTriggerInfoFunction = (
  metadata: ComponentMetadata | null | undefined,
) => RunRecordTriggerInfo | null;

/**
 * Everything the Run Workflow panel needs to ask for a record trigger's
 * record, or null for any other trigger.
 */
export const getRunRecordTriggerInfo: GetRunRecordTriggerInfoFunction = (
  metadata: ComponentMetadata | null | undefined,
): RunRecordTriggerInfo | null => {
  const argument: Argument | null = getRunRecordArgument(metadata);

  if (!argument || !metadata || !metadata.tableName) {
    return null;
  }

  const operation: DatabaseOperation | null = getDatabaseOperation({
    componentId: metadata.id,
    tableName: metadata.tableName,
  });

  const event: RunRecordEvent | null =
    operation === DatabaseOperation.OnCreate
      ? RunRecordEvent.Created
      : operation === DatabaseOperation.OnUpdate
        ? RunRecordEvent.Updated
        : operation === DatabaseOperation.OnDelete
          ? RunRecordEvent.Deleted
          : operation === DatabaseOperation.OnCreateOrUpdate
            ? RunRecordEvent.CreatedOrUpdated
            : null;

  const model: BaseModel | null = getWorkflowModel(metadata.tableName);

  if (!event || !model) {
    return null;
  }

  const columns: RunRecordColumns = getRunRecordColumns(model);

  const whatHappenedArgument: Argument | undefined =
    event === RunRecordEvent.CreatedOrUpdated
      ? (metadata.runWorkflowManuallyArguments || []).find(
          (runArgument: Argument): boolean => {
            return runArgument.id === WHAT_HAPPENED_ID;
          },
        )
      : undefined;

  return {
    argument: argument,
    event: event,
    ...(whatHappenedArgument
      ? { whatHappenedArgument: whatHappenedArgument }
      : {}),
    singularName: model.singularName || metadata.tableName,
    pluralName: model.pluralName || model.singularName || metadata.tableName,
    hasNumber: Boolean(columns.number),
    hasName: Boolean(columns.nameColumn),
  };
};

type GetRunRecordEventFunction = (
  info: RunRecordTriggerInfo,
  // What Run Workflow holds for the trigger.
  values: JSONObject | null | undefined,
) => RunRecordEvent;

/**
 * What a run pretends just happened to its record: the trigger's own event,
 * or for On Create or Update, what its What Happened asks - created until it
 * says updated, as an empty choice is its first.
 */
export const getRunRecordEvent: GetRunRecordEventFunction = (
  info: RunRecordTriggerInfo,
  values: JSONObject | null | undefined,
): RunRecordEvent => {
  if (info.event !== RunRecordEvent.CreatedOrUpdated) {
    return info.event;
  }

  return readWhatHappened(values?.[WHAT_HAPPENED_ID]) === WhatHappened.Updated
    ? RunRecordEvent.Updated
    : RunRecordEvent.Created;
};

type WithRunRecordEventFunction = (
  info: RunRecordTriggerInfo,
  values: JSONObject | null | undefined,
) => RunRecordTriggerInfo;

/**
 * The trigger's info with the event a run is for (getRunRecordEvent), for
 * what says it in words: the record field's help and the confirmation.
 */
export const withRunRecordEvent: WithRunRecordEventFunction = (
  info: RunRecordTriggerInfo,
  values: JSONObject | null | undefined,
): RunRecordTriggerInfo => {
  const event: RunRecordEvent = getRunRecordEvent(info, values);

  return event === info.event ? info : { ...info, event: event };
};

type IsRunRecordIdFunction = (value: unknown) => boolean;

/** Whether a value is a record's ID as it is sent to the run: a UUID. */
export const isRunRecordId: IsRunRecordIdFunction = (
  value: unknown,
): boolean => {
  return (
    typeof value === "string" &&
    UUID_PATTERN.test(value.trim()) &&
    ObjectID.isValidUUID(value.trim())
  );
};
