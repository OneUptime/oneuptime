import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import RecordActorType, {
  CREATED_BY_ACTOR_ID_COLUMN,
  CREATED_BY_ACTOR_TYPE_COLUMN,
  LAST_MODIFIED_AT_COLUMN,
  LAST_MODIFIED_BY_ACTOR_ID_COLUMN,
  LAST_MODIFIED_BY_ACTOR_TYPE_COLUMN,
  LAST_MODIFIED_BY_USER_COLUMN,
  RecordActorUtil,
} from "../../../Types/Database/RecordActor";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { CREATED_BY_USER_COLUMN } from "../../../Types/Database/UserAttribution";
import { getRecordIdText } from "../ObjectID/RecordIdText";
import { getRecordTimeValue } from "./DetailRecordTime";

/*
 * WHO MADE A RECORD AND WHO LAST MODIFIED IT, AS ITS RECORD LINE SAYS
 * (#10290).
 *
 * A record's line - "ID dafafe92… · Created Sep 30 2026, 14:25" under its
 * details - also says who created it and who last modified it, and when:
 *
 *   ID dafafe92…  Created by Nawaz Dhandala · Sep 30 2026, 14:25
 *   Last modified by Terraform (API key) · Nov 19 2026, 09:12  History
 *
 * Each "who" is what acted, by kind (Types/Database/RecordActor): a person by
 * their name, an API key or a workflow by its own name - never a person's -
 * an MCP client for the member it acted for, a server admin, OneUptime
 * itself. A record written before OneUptime kept these says only when it
 * was created, as the line always did; nothing missing is ever read as
 * someone.
 *
 * React-free on purpose, so the rule can be read and tested on its own: what
 * a read asks for (getRecordActivitySelect) and what it says once read
 * (readRecordActivity). UseRecordActivity reads it; DetailRecordLine draws it.
 */

export interface RecordActivityActor {
  type: RecordActorType;
  // The person, as their name reads, or their email when they have none.
  personName?: string | undefined;
  /*
   * The record names a person who is no longer in OneUptime: the read asked
   * for them and found nobody.
   */
  isPersonGone?: boolean | undefined;
  // The API key's, workflow's or MCP client authorization's id.
  actorId?: string | undefined;
  // The API key's or workflow's name, once read (UseRecordActivity).
  actorName?: string | undefined;
}

export interface RecordActivityEvent {
  at: Date | null;
  by: RecordActivityActor | null;
}

export interface RecordActivity {
  created: RecordActivityEvent | null;
  lastModified: RecordActivityEvent | null;
}

// What a record line reads of a person who acted: who they are, by name.
export const RECORD_ACTIVITY_PERSON_SELECT: JSONObject = {
  name: true,
  email: true,
};

// The kinds that name a person: the person themselves, or the one acted for.
const PERSON_TYPES: ReadonlySet<RecordActorType> = new Set<RecordActorType>([
  RecordActorType.User,
  RecordActorType.MasterAdmin,
  RecordActorType.McpClient,
]);

export const isPersonActorType: (type: RecordActorType) => boolean = (
  type: RecordActorType,
): boolean => {
  return PERSON_TYPES.has(type);
};

// Whether a model's column is a relation to a person (User).
const isPersonRelation: (model: BaseModel, column: string) => boolean = (
  model: BaseModel,
  column: string,
): boolean => {
  if (!model.isTableColumn(column)) {
    return false;
  }

  const metadata: TableColumnMetadata | undefined =
    model.getTableColumnMetadata(column);

  return (
    metadata?.type === TableColumnType.Entity &&
    metadata.modelType?.name === "User"
  );
};

/*
 * What a read of a record asks for so its line can say who made it and who
 * last modified it: only the columns the reader may read (canReadColumn, the
 * rule a select follows - PermissionGate.canReadColumn), since the server
 * refuses a whole read that names one they may not. The person comes through
 * the relation, as the creator always has, and only who they are.
 */
export const getRecordActivitySelect: (
  model: BaseModel,
  canReadColumn: (column: string) => boolean,
) => Dictionary<boolean | JSONObject> = (
  model: BaseModel,
  canReadColumn: (column: string) => boolean,
): Dictionary<boolean | JSONObject> => {
  const select: Dictionary<boolean | JSONObject> = {};

  for (const column of [
    "createdAt",
    CREATED_BY_ACTOR_TYPE_COLUMN,
    CREATED_BY_ACTOR_ID_COLUMN,
    LAST_MODIFIED_AT_COLUMN,
    LAST_MODIFIED_BY_ACTOR_TYPE_COLUMN,
    LAST_MODIFIED_BY_ACTOR_ID_COLUMN,
  ]) {
    if (model.isTableColumn(column) && canReadColumn(column)) {
      select[column] = true;
    }
  }

  for (const column of [CREATED_BY_USER_COLUMN, LAST_MODIFIED_BY_USER_COLUMN]) {
    if (isPersonRelation(model, column) && canReadColumn(column)) {
      select[column] = { ...RECORD_ACTIVITY_PERSON_SELECT };
    }
  }

  return select;
};

/*
 * A value as text: a string, or what a Name, an Email or the JSON shape of
 * one ({ _type, value }) holds. Anything else is nothing.
 */
const readText: (value: unknown) => string = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "object") {
    const holder: { value?: unknown; toString?: () => string } = value as {
      value?: unknown;
      toString?: () => string;
    };

    if (typeof holder.value === "string") {
      return holder.value.trim();
    }

    if (
      typeof holder.toString === "function" &&
      holder.toString !== Object.prototype.toString
    ) {
      return String(holder.toString()).trim();
    }
  }

  return "";
};

// A person as a record names them: their name, or their email.
export const getPersonName: (person: unknown) => string = (
  person: unknown,
): string => {
  if (!person || typeof person !== "object") {
    return "";
  }

  const record: Record<string, unknown> = person as Record<string, unknown>;

  return readText(record["name"]) || readText(record["email"]);
};

const readActor: (data: {
  type: RecordActorType | null;
  actorId: unknown;
  person: unknown;
  // Whether the read asked for the person: only then is a missing one gone.
  isPersonRead: boolean;
}) => RecordActivityActor | null = (data: {
  type: RecordActorType | null;
  actorId: unknown;
  person: unknown;
  isPersonRead: boolean;
}): RecordActivityActor | null => {
  if (!data.type) {
    return null;
  }

  const actor: RecordActivityActor = { type: data.type };
  const actorId: string = getRecordIdText(data.actorId);

  if (actorId) {
    actor.actorId = actorId;
  }

  if (isPersonActorType(data.type)) {
    const personName: string = getPersonName(data.person);

    if (personName) {
      actor.personName = personName;
    } else if (data.isPersonRead && !data.person) {
      actor.isPersonGone = true;
    } else if (data.type === RecordActorType.User) {
      // A person nobody may name here: the line says when, not who.
      return null;
    }
  }

  return actor;
};

/*
 * What a record's line says of who made it and who last modified it, read
 * off the record as getRecordActivitySelect asked for it. `select` says what
 * was asked: a person the read did not ask for is never "gone", only not
 * named. A record from before these were kept, created by a person, names
 * them through its creator alone, as it always did.
 */
export const readRecordActivity: (
  item: unknown,
  select?: Dictionary<boolean | JSONObject> | undefined,
) => RecordActivity = (
  item: unknown,
  select?: Dictionary<boolean | JSONObject> | undefined,
): RecordActivity => {
  if (!item || typeof item !== "object") {
    return { created: null, lastModified: null };
  }

  const record: Record<string, unknown> = item as Record<string, unknown>;
  const wasRead: (column: string) => boolean = (column: string): boolean => {
    return select ? Boolean(select[column]) : column in record;
  };

  const creator: unknown = record[CREATED_BY_USER_COLUMN];

  /*
   * The kind it was created by, or - on a record from before it was kept -
   * a person, when the record names its creator.
   */
  const createdByType: RecordActorType | null =
    RecordActorUtil.readType(record[CREATED_BY_ACTOR_TYPE_COLUMN]) ||
    (getPersonName(creator) ? RecordActorType.User : null);

  const createdAt: Date | null = getRecordTimeValue(record["createdAt"]);
  const createdBy: RecordActivityActor | null = readActor({
    type: createdByType,
    actorId: record[CREATED_BY_ACTOR_ID_COLUMN],
    person: creator,
    isPersonRead: wasRead(CREATED_BY_USER_COLUMN),
  });

  const lastModifiedAt: Date | null = getRecordTimeValue(
    record[LAST_MODIFIED_AT_COLUMN],
  );
  const lastModifiedBy: RecordActivityActor | null = readActor({
    type: RecordActorUtil.readType(record[LAST_MODIFIED_BY_ACTOR_TYPE_COLUMN]),
    actorId: record[LAST_MODIFIED_BY_ACTOR_ID_COLUMN],
    person: record[LAST_MODIFIED_BY_USER_COLUMN],
    isPersonRead: wasRead(LAST_MODIFIED_BY_USER_COLUMN),
  });

  return {
    created: createdAt || createdBy ? { at: createdAt, by: createdBy } : null,
    // Never modified since it was created, or not since these were kept.
    lastModified: lastModifiedAt
      ? { at: lastModifiedAt, by: lastModifiedBy }
      : null,
  };
};

/*
 * The API keys and workflows a record's activity names, whose own names a
 * reader who may read them reads (UseRecordActivity): each id once.
 */
export const getNamedActorIds: (
  activity: RecordActivity | null,
  type: RecordActorType,
) => Array<string> = (
  activity: RecordActivity | null,
  type: RecordActorType,
): Array<string> => {
  const ids: Set<string> = new Set<string>();

  for (const event of [activity?.created, activity?.lastModified]) {
    if (event?.by?.type === type && event.by.actorId) {
      ids.add(event.by.actorId);
    }
  }

  return [...ids];
};

// The activity with the names of the keys and workflows it names, once read.
export const withActorNames: (
  activity: RecordActivity,
  names: Map<string, string>,
) => RecordActivity = (
  activity: RecordActivity,
  names: Map<string, string>,
): RecordActivity => {
  const named: (
    event: RecordActivityEvent | null,
  ) => RecordActivityEvent | null = (
    event: RecordActivityEvent | null,
  ): RecordActivityEvent | null => {
    if (!event?.by?.actorId || !names.has(event.by.actorId)) {
      return event;
    }

    return {
      ...event,
      by: { ...event.by, actorName: names.get(event.by.actorId) },
    };
  };

  return {
    created: named(activity.created),
    lastModified: named(activity.lastModified),
  };
};
