import Dictionary from "../../../Types/Dictionary";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import {
  ChangeEventAttribute,
  RESERVED_CHANGE_ATTRIBUTE_PREFIX,
} from "../../../Utils/Telemetry/ChangeEventFields";
/*
 * Type-only: pulling the ingest service's runtime graph into this pure
 * module would drag ClickHouse/DB deps into every test that touches it.
 */
import type { TelemetryServiceMetadata } from "../../Services/OpenTelemetryIngestService";

/*
 * Change-event ingest parsing + ClickHouse row building. Pure on purpose
 * (no network, no request objects) so App/Tests can pin every validation
 * rule without a server.
 */

/*
 * Events whose source timestamp is outside this window are stamped with
 * the ingestion time instead (original preserved in attributes). The
 * table partitions by toYYYYMMDD(time), so a forged or garbage timestamp
 * must not be allowed to create arbitrary partitions.
 */
export const MAX_CHANGE_EVENT_AGE_IN_DAYS: number = 366;
export const MAX_CHANGE_EVENT_FUTURE_SKEW_IN_MINUTES: number = 60;

// Caps keep a CI script's mistake from becoming a storage problem.
export const MAX_CHANGE_EVENTS_PER_REQUEST: number = 100;
export const MAX_CHANGE_EVENT_TITLE_LENGTH: number = 500;
export const MAX_CHANGE_EVENT_DESCRIPTION_LENGTH: number = 5000;
export const MAX_CHANGE_EVENT_TYPE_LENGTH: number = 50;
export const MAX_CHANGE_EVENT_ATTRIBUTES: number = 50;

export const DEFAULT_CHANGE_EVENT_TYPE: string = "deployment";

/*
 * Serviceless change events (project-wide markers) have no service
 * retention ladder to consult; deploy markers are tiny and valuable for
 * long-baseline comparisons, so keep them a year.
 */
export const DEFAULT_CHANGE_EVENT_RETENTION_IN_DAYS: number = 365;

export interface ParsedChangeEventEntry {
  /** null → stamp with the ingestion time. */
  time: Date | null;
  eventType: string;
  title: string;
  description: string;
  attributes: Dictionary<string>;
}

function parseEntryTime(value: unknown): Date | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    /*
     * Epoch seconds vs milliseconds: anything below 1e12 read as ms would
     * be before 2001 — CI clocks don't say that; treat it as seconds.
     */
    const ms: number = value < 1e12 ? value * 1000 : value;
    const date: Date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const date: Date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

/*
 * Top-level fields a pipeline may send instead of attributes, and the
 * attribute each one is stored under (Common/Utils/Telemetry/
 * ChangeEventFields): { "version": "2.3.1", "commit": "1a2b3c4" } is the
 * same event as { "attributes": { "service.version": "2.3.1",
 * "vcs.ref.head.revision": "1a2b3c4" } }. An attribute posted under the
 * stored name wins over the top-level field.
 */
export const CHANGE_EVENT_TOP_LEVEL_FIELDS: ReadonlyArray<{
  fields: ReadonlyArray<string>;
  attribute: string;
}> = [
  { fields: ["version"], attribute: ChangeEventAttribute.ServiceVersion },
  {
    fields: ["previousVersion"],
    attribute: ChangeEventAttribute.PreviousVersion,
  },
  {
    fields: ["commit", "commitSha", "sha"],
    attribute: ChangeEventAttribute.CommitSha,
  },
  {
    fields: ["repository", "repositoryUrl"],
    attribute: ChangeEventAttribute.RepositoryUrl,
  },
  { fields: ["branch"], attribute: ChangeEventAttribute.Branch },
  { fields: ["pullRequest"], attribute: ChangeEventAttribute.PullRequest },
  { fields: ["environment"], attribute: ChangeEventAttribute.Environment },
];

// The longest value a top-level field is stored with.
export const MAX_CHANGE_EVENT_TOP_LEVEL_FIELD_LENGTH: number = 1000;

function readTopLevelField(
  entry: JSONObject,
  fields: ReadonlyArray<string>,
): string {
  for (const field of fields) {
    const value: unknown = entry[field];

    if (typeof value === "string" && value.trim() !== "") {
      return value.trim().slice(0, MAX_CHANGE_EVENT_TOP_LEVEL_FIELD_LENGTH);
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return "";
}

/**
 * Validate one raw ingest entry. Returns null when the entry cannot be a
 * change event at all (no usable title); every other malformation is
 * repaired (defaults, trims, caps) rather than rejected — CI pipelines
 * should not fail a deploy over a long description.
 *
 * Attribute keys under RESERVED_CHANGE_ATTRIBUTE_PREFIX ("oneuptime.") are
 * dropped: they are OneUptime's own, and investigations match changes to
 * incidents and clusters by them, so a posted event cannot claim to be a
 * fix OneUptime AI ran or to belong to an incident.
 */
export function parseChangeEventIngestEntry(
  entry: JSONObject,
): ParsedChangeEventEntry | null {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }

  const rawEventType: unknown = entry["eventType"] ?? entry["type"];
  const eventType: string =
    typeof rawEventType === "string" && rawEventType.trim() !== ""
      ? rawEventType.trim().toLowerCase().slice(0, MAX_CHANGE_EVENT_TYPE_LENGTH)
      : DEFAULT_CHANGE_EVENT_TYPE;

  const rawTitle: unknown = entry["title"] ?? entry["name"];
  let title: string =
    typeof rawTitle === "string"
      ? rawTitle.trim().slice(0, MAX_CHANGE_EVENT_TITLE_LENGTH)
      : "";

  /*
   * A deploy that names its version needs no title of its own: "Deploy
   * 2.3.1" says what a pipeline would have written anyway.
   */
  if (title === "" && rawTitle === undefined) {
    const version: string = readTopLevelField(entry, ["version"]);

    if (version && eventType === DEFAULT_CHANGE_EVENT_TYPE) {
      title = `Deploy ${version}`.slice(0, MAX_CHANGE_EVENT_TITLE_LENGTH);
    }
  }

  if (title === "") {
    return null;
  }

  const rawDescription: unknown = entry["description"];
  const description: string =
    typeof rawDescription === "string"
      ? rawDescription.trim().slice(0, MAX_CHANGE_EVENT_DESCRIPTION_LENGTH)
      : "";

  const attributes: Dictionary<string> = {};
  const rawAttributes: unknown = entry["attributes"];
  if (
    rawAttributes &&
    typeof rawAttributes === "object" &&
    !Array.isArray(rawAttributes)
  ) {
    for (const key of Object.keys(rawAttributes as JSONObject)) {
      if (key.trim() === "") {
        continue;
      }
      if (key.trim().startsWith(RESERVED_CHANGE_ATTRIBUTE_PREFIX)) {
        continue;
      }
      if (Object.keys(attributes).length >= MAX_CHANGE_EVENT_ATTRIBUTES) {
        break;
      }
      const value: unknown = (rawAttributes as JSONObject)[key];
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        attributes[key] = String(value);
      }
    }
  }

  /*
   * The top-level fields fill the attributes they name, after the cap: they
   * are a fixed handful, and they are what the event is about.
   */
  for (const topLevel of CHANGE_EVENT_TOP_LEVEL_FIELDS) {
    if (attributes[topLevel.attribute] !== undefined) {
      continue;
    }

    const value: string = readTopLevelField(entry, topLevel.fields);

    if (value) {
      attributes[topLevel.attribute] = value;
    }
  }

  return {
    time: parseEntryTime(entry["time"] ?? entry["timestamp"]),
    eventType,
    title,
    description,
    attributes,
  };
}

/**
 * The service an entry lands under; "" means a project-wide event.
 *
 * A key pinned to one service writes everything under that service. The
 * key's Pinned Service Name field promises that for traces, logs and
 * metrics (PinServiceName), and it holds here too: a key scoped to one
 * service cannot put a deploy marker on another service's charts, nor a
 * project-wide marker on every chart. Otherwise the entry's own
 * serviceName wins, then the x-oneuptime-service-name header.
 */
export function resolveChangeEventServiceName(data: {
  entry: JSONObject;
  headerServiceName: string;
  pinnedServiceName?: string | null | undefined;
}): string {
  const pinnedServiceName: string =
    typeof data.pinnedServiceName === "string"
      ? data.pinnedServiceName.trim()
      : "";

  if (pinnedServiceName) {
    return pinnedServiceName;
  }

  const entryServiceName: unknown = data.entry["serviceName"];

  if (typeof entryServiceName === "string" && entryServiceName.trim() !== "") {
    return entryServiceName.trim();
  }

  return data.headerServiceName.trim();
}

/**
 * Accept the shapes CI scripts actually send: a bare object (one event),
 * a bare array, or { events: [...] }.
 */
export function extractChangeEventEntries(body: unknown): Array<JSONObject> {
  if (!body) {
    return [];
  }

  if (Array.isArray(body)) {
    return (body as JSONArray).filter((item: unknown): boolean => {
      return typeof item === "object" && item !== null && !Array.isArray(item);
    }) as Array<JSONObject>;
  }

  if (typeof body !== "object") {
    return [];
  }

  const asObject: JSONObject = body as JSONObject;
  const nested: unknown = asObject["events"];
  if (Array.isArray(nested)) {
    return extractChangeEventEntries(nested);
  }

  // A single bare event object — but not the {events: <non-array>} shape.
  if (nested === undefined && Object.keys(asObject).length > 0) {
    return [asObject];
  }

  return [];
}

/**
 * ParsedChangeEventEntry -> ChangeEvent ClickHouse row.
 */
export function buildChangeEventDbRow(data: {
  parsed: ParsedChangeEventEntry;
  projectId: ObjectID;
  serviceMetadata: TelemetryServiceMetadata | null;
  retentionDays: number;
  /*
   * What OneUptime itself says about the event - where it came from
   * (oneuptime.change.source) and the like. Written over the parsed
   * attributes, so a posted value never stands in for one of these.
   */
  systemAttributes?: Dictionary<string> | undefined;
}): JSONObject {
  const { parsed, projectId, serviceMetadata, retentionDays } = data;

  const ingestionDate: Date = OneUptimeDate.getCurrentDate();

  let eventTime: Date = parsed.time || ingestionDate;
  let attributes: Dictionary<string> = {
    ...parsed.attributes,
    ...(data.systemAttributes || {}),
  };

  const ageInDays: number = OneUptimeDate.getNumberOfDaysBetweenDates(
    eventTime,
    ingestionDate,
  );
  const futureSkewInMinutes: number =
    (eventTime.getTime() - ingestionDate.getTime()) / (60 * 1000);

  if (
    Number.isNaN(eventTime.getTime()) ||
    ageInDays > MAX_CHANGE_EVENT_AGE_IN_DAYS ||
    futureSkewInMinutes > MAX_CHANGE_EVENT_FUTURE_SKEW_IN_MINUTES
  ) {
    attributes = {
      ...attributes,
      "oneuptime.original_time": String(parsed.time),
    };
    eventTime = ingestionDate;
  }

  const retentionDate: Date = OneUptimeDate.addRemoveDays(
    ingestionDate,
    retentionDays,
  );

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(ingestionDate),
    projectId: projectId.toString(),
    ...(serviceMetadata
      ? {
          primaryEntityId: serviceMetadata.primaryEntityId.toString(),
          primaryEntityType: serviceMetadata.primaryEntityType,
        }
      : {}),
    time: OneUptimeDate.toClickhouseDateTime64(eventTime),
    eventType: parsed.eventType,
    title: parsed.title,
    description: parsed.description,
    attributes,
    attributeKeys: Object.keys(attributes).sort(),
    retentionDate: OneUptimeDate.toClickhouseDateTime(retentionDate),
  } satisfies JSONObject;
}
