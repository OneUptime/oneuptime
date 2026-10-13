import { JSONObject, JSONValue, ObjectType } from "../../JSON";
import ObjectID from "../../ObjectID";

/*
 * HOW A PAGE STEP'S SETTINGS ARE STORED AND READ.
 *
 * The four Page steps (Components/OnCall) share their settings: who to
 * page, and what the page is about. This file holds the stored ids of those
 * settings and reads their values - in the Builder, which shows and checks
 * them, and on the server, which runs them - so the two always agree.
 *
 * WHO TO PAGE is a list. In the Builder each entry is a person, a team, a
 * schedule or a policy picked from a list - stored as its id - or a value
 * from an earlier step, stored as its {{reference}}. When the step runs,
 * every reference has been replaced by what it held, and that can be more
 * than one id: an incident's list of owners, a JSON list a webhook sent, a
 * line of ids separated by commas. For people it can also be an email
 * address. readPageIdList takes all of those apart into ids and emails, and
 * keeps what it could not read so the step can say so.
 *
 * Pure: no DOM, no server.
 */

/*
 * The stored ids of the settings. Every saved workflow and template uses
 * them, so they never change; only the names shown for them do.
 */
export const PAGE_ARGUMENT_IDS: {
  readonly users: string;
  readonly teams: string;
  readonly onCallSchedules: string;
  readonly onCallPolicies: string;
  readonly about: string;
  readonly title: string;
  readonly message: string;
  readonly alertSeverity: string;
  readonly incidentId: string;
  readonly alertId: string;
} = {
  users: "users",
  teams: "teams",
  onCallSchedules: "on-call-schedules",
  onCallPolicies: "on-call-policies",
  about: "about",
  title: "title",
  message: "message",
  alertSeverity: "alert-severity",
  incidentId: "incident-id",
  alertId: "alert-id",
};

// The stored ids of what a Page step returns.
export const PAGE_RETURN_VALUE_IDS: {
  readonly summary: string;
  readonly pagedUsers: string;
  readonly alertId: string;
  readonly incidentId: string;
  readonly error: string;
} = {
  summary: "summary",
  pagedUsers: "paged-users",
  alertId: "alert-id",
  incidentId: "incident-id",
  error: "error",
};

export const PAGE_SUCCESS_PORT_ID: string = "success";
export const PAGE_ERROR_PORT_ID: string = "error";
export const PAGE_IN_PORT_ID: string = "in";

/*
 * What a page is about, as the Page About setting stores it. A page is
 * always about an incident or an alert; about something new, it creates the
 * alert itself.
 */
export enum PageAbout {
  NewAlert = "new-alert",
  Incident = "incident",
  Alert = "alert",
}

// What an empty Page About stands for.
export const DEFAULT_PAGE_ABOUT: PageAbout = PageAbout.NewAlert;

/*
 * What a Page About setting holds: its stored value, the default while it
 * is empty, or null for a value that is none of the three (a workflow
 * edited by hand, a reference that resolved to something else).
 */
export function readPageAbout(value: unknown): PageAbout | null {
  if (value === undefined || value === null) {
    return DEFAULT_PAGE_ABOUT;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized: string = value.trim().toLowerCase();

  if (normalized === "") {
    return DEFAULT_PAGE_ABOUT;
  }

  return (
    Object.values(PageAbout).find((about: PageAbout): boolean => {
      return about === normalized;
    }) || null
  );
}

// A who-to-page setting, taken apart.
export interface PageIdList {
  // Record ids, each once, in the order they were named.
  ids: Array<string>;
  // Email addresses, lower-cased, each once (people only).
  emails: Array<string>;
  /*
   * What could not be read as an id or an email address, as it was written:
   * a name, a reference that resolved to nothing and was left as written.
   */
  unreadable: Array<string>;
}

// A list entry no page could mean: cut short when it is quoted back.
const MAX_UNREADABLE_ENTRY_LENGTH: number = 80;

// What separates ids written on one line: commas, semicolons and white space.
const ID_SEPARATOR: RegExp = /[\s,;]+/;

// The keys a record's own id is found under.
const RECORD_ID_KEYS: Array<string> = ["_id", "id"];

/*
 * An email address, near enough to tell one from an id or a name: something,
 * an @, a host with a dot. Whether anybody has it is the server's to say.
 */
const EMAIL_SHAPE: RegExp = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

type CollectFunction = (value: JSONValue | undefined, depth: number) => void;

/*
 * A who-to-page setting as ids and email addresses, whatever shape its
 * entries arrived in:
 *
 *   - an id, or an email address (`allowEmails`);
 *   - several of them in one text, separated by commas, semicolons, spaces
 *     or line breaks;
 *   - a list, or a list written as JSON text - what a reference to a list
 *     becomes inside a setting;
 *   - a record ({ "_id": ... }), or a list of records: an incident's owners,
 *     a step's Find Many result.
 *
 * Ids are compared without regard to case, and kept as first written.
 */
export function readPageIdList(
  value: JSONValue | undefined,
  options?: { allowEmails?: boolean | undefined } | undefined,
): PageIdList {
  const result: PageIdList = { ids: [], emails: [], unreadable: [] };
  const seenIds: Set<string> = new Set<string>();
  const seenEmails: Set<string> = new Set<string>();
  const seenUnreadable: Set<string> = new Set<string>();

  const addToken: (token: string) => void = (token: string): void => {
    const text: string = token.trim();

    if (!text) {
      return;
    }

    if (ObjectID.isValidUUID(text)) {
      const key: string = text.toLowerCase();

      if (!seenIds.has(key)) {
        seenIds.add(key);
        result.ids.push(text);
      }

      return;
    }

    if (options?.allowEmails && EMAIL_SHAPE.test(text)) {
      const email: string = text.toLowerCase();

      if (!seenEmails.has(email)) {
        seenEmails.add(email);
        result.emails.push(email);
      }

      return;
    }

    const shown: string =
      text.length > MAX_UNREADABLE_ENTRY_LENGTH
        ? `${text.slice(0, MAX_UNREADABLE_ENTRY_LENGTH)}…`
        : text;

    if (!seenUnreadable.has(shown)) {
      seenUnreadable.add(shown);
      result.unreadable.push(shown);
    }
  };

  const collect: CollectFunction = (
    entry: JSONValue | undefined,
    depth: number,
  ): void => {
    if (entry === undefined || entry === null) {
      return;
    }

    // A list inside a list inside a list is nobody's list of people.
    if (depth > 4) {
      return;
    }

    if (Array.isArray(entry)) {
      for (const item of entry) {
        collect(item as JSONValue, depth + 1);
      }

      return;
    }

    if (typeof entry === "object") {
      const record: JSONObject = entry as JSONObject;

      // An id as the API writes one: { _type: "ObjectID", value: "..." }.
      if (
        record["_type"] === ObjectType.ObjectID &&
        typeof record["value"] === "string"
      ) {
        addToken(record["value"]);
        return;
      }

      for (const key of RECORD_ID_KEYS) {
        const id: JSONValue | undefined = record[key];

        if (id !== undefined && id !== null) {
          collect(id, depth + 1);
          return;
        }
      }

      addToken(JSON.stringify(entry));
      return;
    }

    if (typeof entry !== "string") {
      addToken(String(entry));
      return;
    }

    const text: string = entry.trim();

    if (!text) {
      return;
    }

    // A list or a record written as JSON text.
    if (text.startsWith("[") || text.startsWith("{")) {
      try {
        collect(JSON.parse(text) as JSONValue, depth + 1);
        return;
      } catch {
        // Not JSON after all: read it as text.
      }
    }

    for (const token of text.split(ID_SEPARATOR)) {
      addToken(token);
    }
  };

  collect(value, 0);

  return result;
}

/*
 * One record's id from a setting that names a single record - Incident ID,
 * Alert ID, Severity - or null when the setting holds none that can be
 * read. A record ({ "_id": ... }) is read by its id.
 */
export function readPageRecordId(value: JSONValue | undefined): string | null {
  const list: PageIdList = readPageIdList(value);

  if (list.ids.length !== 1 || list.unreadable.length > 0) {
    return null;
  }

  return list.ids[0] || null;
}

// Whether a setting holds anything at all, once spaces are set aside.
export function hasPageSettingValue(value: JSONValue | undefined): boolean {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.some((item: JSONValue): boolean => {
      return hasPageSettingValue(item);
    });
  }

  return true;
}
