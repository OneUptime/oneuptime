import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * EVERY STATE CHANGE THAT POSTS A PUBLIC NOTE DECIDES ITS OWN NOTIFICATION
 * IN ONE PLACE.
 *
 * A state change on an incident or a scheduled maintenance event can post a
 * public note with it. When the change notifies status page subscribers, the
 * note is the one message they get, so the change itself is recorded as sent
 * by the note and never queued (StateChangeSubscriberNotification).
 *
 * The rule used to be written out in each state timeline service, as two
 * blocks that each set the change's subscriber notification status. In the
 * scheduled maintenance copy the second block undid the first - the change
 * was marked as sent by its note, then queued anyway - and subscribers got
 * two messages for one change. Nothing failed: both statuses are valid.
 *
 * So this reads the source and holds every service that takes a public note
 * off a state change to one decision:
 *
 *   - it reads the note with StateChangeSubscriberNotification.getPublicNote
 *     (a blank note is no note), never the raw misc data key;
 *   - it decides the change's notification with one applyToStateChange call,
 *     and writes subscriberNotificationStatus nowhere else;
 *   - the note it posts notifies exactly when the change does.
 *
 * And it reads the jobs that send these notifications: a state change is
 * sent only while it is Pending and notifies, a note only while it is
 * Pending and notifies - so a change recorded as sent by its note is never
 * sent again.
 */

// packages/Common/Tests/Server/Services -> packages/Common
const COMMON_DIR: string = path.resolve(__dirname, "..", "..", "..");
// packages/Common -> packages
const PACKAGES_DIR: string = path.resolve(COMMON_DIR, "..");
const SERVER_DIR: string = path.join(COMMON_DIR, "Server");
const SERVICES_DIR: string = path.join(SERVER_DIR, "Services");

interface StateChangeWithNote {
  // The state timeline service, in Common/Server/Services.
  service: string;
  // The job that sends the state change to subscribers.
  stateChangeJob: string;
  // The job that sends the public note to subscribers.
  publicNoteJob: string;
}

/*
 * Every state timeline service that posts a public note with a state change.
 * A service that starts doing so must be added here.
 */
const STATE_CHANGES_WITH_NOTES: Array<StateChangeWithNote> = [
  {
    service: "IncidentStateTimelineService.ts",
    stateChangeJob:
      "App/FeatureSet/Workers/Jobs/IncidentStateTimeline/SendNotificationToSubscribers.ts",
    publicNoteJob:
      "App/FeatureSet/Workers/Jobs/IncidentPublicNote/SendNotificationToSubscribers.ts",
  },
  {
    service: "ScheduledMaintenanceStateTimelineService.ts",
    stateChangeJob:
      "App/FeatureSet/Workers/Jobs/ScheduledMaintenanceStateTimeline/SendNotificationToSubscribers.ts",
    publicNoteJob:
      "App/FeatureSet/Workers/Jobs/ScheduledMaintenancePublicNote/SendNotificationToSubscribers.ts",
  },
];

// Reading the note a state change carries, in any form.
const READS_THE_NOTE: RegExp =
  /\[\s*["'`]publicNote["'`]\s*\]|StateChangeSubscriberNotification\.getPublicNote\s*\(|\.publicNoteKey\b/;

const RAW_NOTE_KEY: RegExp = /\[\s*["'`]publicNote["'`]\s*\]/;

const GET_PUBLIC_NOTE: RegExp =
  /StateChangeSubscriberNotification\.getPublicNote\s*\(/g;

const APPLY_TO_STATE_CHANGE: RegExp =
  /StateChangeSubscriberNotification\.applyToStateChange\s*\(/g;

// `x.subscriberNotificationStatus = ...` (not ==, not ===).
const ASSIGNS_STATUS: RegExp = /\.subscriberNotificationStatus\s*=(?!=)/;

// `{ subscriberNotificationStatus: ... }`, as an update or create would send.
const STATUS_AS_DATA: RegExp = /\bsubscriberNotificationStatus\s*:/;

const NOTE_NOTIFIES_LIKE_THE_CHANGE: RegExp =
  /\.shouldStatusPageSubscribersBeNotifiedOnNoteCreated\s*=\s*Boolean\(\s*[\w.]+\.shouldStatusPageSubscribersBeNotified\s*,?\s*\)/;

type ReadFunction = (absolute: string) => string;

const read: ReadFunction = (absolute: string): string => {
  return fs.readFileSync(absolute, "utf8");
};

type ListTypeScriptFunction = (directory: string) => Array<string>;

const listTypeScript: ListTypeScriptFunction = (
  directory: string,
): Array<string> => {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listTypeScript(absolute));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      files.push(absolute);
    }
  }

  return files;
};

type CountFunction = (source: string, pattern: RegExp) => number;

const count: CountFunction = (source: string, pattern: RegExp): number => {
  return (source.match(pattern) || []).length;
};

/*
 * The body of a method of the class, from its name to the matching brace.
 * Enough for these services, whose methods hold no braces in strings.
 */
type MethodBodyFunction = (source: string, method: string) => string;

const methodBody: MethodBodyFunction = (
  source: string,
  method: string,
): string => {
  const start: number = source.search(
    new RegExp(`(protected|public|private)[^\\n]*\\b${method}\\s*\\(`),
  );

  if (start === -1) {
    return "";
  }

  const open: number = source.indexOf("{", source.indexOf(")", start));
  let depth: number = 0;

  for (let index: number = open; index < source.length; index++) {
    if (source[index] === "{") {
      depth++;
    } else if (source[index] === "}") {
      depth--;

      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  return source.slice(start);
};

/*
 * The query object of the first find in a job: what it asks the database
 * for, whitespace folded so it reads as one line.
 */
type FirstQueryFunction = (source: string) => string;

const firstQuery: FirstQueryFunction = (source: string): string => {
  const start: number = source.search(/\.find(All)?By\(\{\s*query:\s*\{/);

  if (start === -1) {
    return "";
  }

  const open: number = source.indexOf("{", source.indexOf("query:", start));
  const close: number = source.indexOf("}", open);

  return source.slice(open, close + 1).replace(/\s+/g, " ");
};

describe("every state change that posts a public note is listed here", () => {
  test("the services that read a state change's public note are exactly the listed ones", () => {
    const readers: Array<string> = listTypeScript(SERVER_DIR)
      .filter((file: string) => {
        return READS_THE_NOTE.test(read(file));
      })
      .map((file: string) => {
        return path.relative(SERVICES_DIR, file);
      })
      .sort();

    expect(readers).toEqual(
      STATE_CHANGES_WITH_NOTES.map((entry: StateChangeWithNote) => {
        return entry.service;
      }).sort(),
    );
  });
});

describe.each(STATE_CHANGES_WITH_NOTES)(
  "$service decides its notification once",
  (entry: StateChangeWithNote) => {
    const source: string = read(path.join(SERVICES_DIR, entry.service));
    const onBeforeCreate: string = methodBody(source, "onBeforeCreate");

    test("reads the note with StateChangeSubscriberNotification.getPublicNote, in onBeforeCreate, and never off the raw key", () => {
      expect(onBeforeCreate).not.toBe("");
      expect(count(source, GET_PUBLIC_NOTE)).toBe(1);
      expect(count(onBeforeCreate, GET_PUBLIC_NOTE)).toBe(1);
      expect(source).not.toMatch(RAW_NOTE_KEY);
    });

    test("decides the change's notification with one applyToStateChange call, in onBeforeCreate", () => {
      expect(count(source, APPLY_TO_STATE_CHANGE)).toBe(1);
      expect(count(onBeforeCreate, APPLY_TO_STATE_CHANGE)).toBe(1);

      // The decision takes the note the service read, and nothing else.
      expect(onBeforeCreate).toMatch(
        /applyToStateChange\(\{\s*stateChange:\s*createBy\.data,\s*hasPublicNote:\s*Boolean\(publicNote\),/,
      );
    });

    test("writes the change's subscriber notification status nowhere else", () => {
      expect(source).not.toMatch(ASSIGNS_STATUS);
      expect(source).not.toMatch(STATUS_AS_DATA);
    });

    test("posts the note to notify subscribers exactly when the change does", () => {
      expect(
        count(source, new RegExp(NOTE_NOTIFIES_LIKE_THE_CHANGE, "g")),
      ).toBe(1);
    });

    test("the state change job sends only a change that is queued and notifies, so one sent by its note is not sent again", () => {
      const query: string = firstQuery(
        read(path.join(PACKAGES_DIR, entry.stateChangeJob)),
      );

      expect(query).toContain(
        "subscriberNotificationStatus: StatusPageSubscriberNotificationStatus.Pending",
      );
      expect(query).toContain("shouldStatusPageSubscribersBeNotified: true");
    });

    test("the public note job sends a note that is queued and notifies", () => {
      const query: string = firstQuery(
        read(path.join(PACKAGES_DIR, entry.publicNoteJob)),
      );

      expect(query).toContain(
        "subscriberNotificationStatusOnNoteCreated: StatusPageSubscriberNotificationStatus.Pending",
      );
      expect(query).toContain(
        "shouldStatusPageSubscribersBeNotifiedOnNoteCreated: true",
      );
    });
  },
);
