import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import FileModel from "Common/Models/DatabaseModels/File";
import User from "Common/Models/DatabaseModels/User";
import { ColumnAccessControl } from "Common/Types/BaseDatabase/AccessControl";
import Search from "Common/Types/BaseDatabase/Search";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";

/*
 * Everything the notes feed decides without React: which date a note is
 * filed under, how the feed is grouped into days, what a subscriber
 * notification status reads as, what the page says for a public or a private
 * feed, and whether the viewer may write a given column. Kept pure so it can
 * be tested without rendering anything.
 */

export type NoteVisibility = "public" | "private";

/*
 * The columns the feed reads. Every incident, alert, scheduled maintenance
 * and episode note model has this shape; the public ones add posting time and
 * subscriber notification state.
 */
export interface NoteRecord {
  _id?: string | undefined;
  id?: ObjectID | null | undefined;
  note?: string | undefined;
  createdAt?: Date | undefined;
  postedAt?: Date | undefined;
  createdByUser?: User | undefined;
  attachments?: Array<FileModel> | undefined;
  postedFromSlackMessageId?: string | undefined;
  subscriberNotificationStatusOnNoteCreated?:
    | StatusPageSubscriberNotificationStatus
    | undefined;
  subscriberNotificationStatusMessage?: string | undefined;
  subscriberNotificationStatusOnNoteUpdated?:
    | StatusPageSubscriberNotificationStatus
    | undefined;
  subscriberNotificationStatusMessageOnNoteUpdated?: string | undefined;
}

export type NoteSortOrder = "newest" | "oldest";

// How many notes a page of the feed asks for.
export const NOTES_PAGE_SIZE: number = 25;

// How long a search waits for typing to stop before it asks the server.
export const NOTES_SEARCH_DEBOUNCE_MS: number = 350;

/*
 * How often the feed re-reads itself while a subscriber notification is still
 * queued or being sent, so "Notifying subscribers" turns into "Subscribers
 * notified" without anybody pressing refresh.
 */
export const NOTIFICATION_POLL_INTERVAL_MS: number = 10000;

type ToDateFunction = (value: Date | string | undefined | null) => Date | null;

const toDate: ToDateFunction = (
  value: Date | string | undefined | null,
): Date | null => {
  if (!value) {
    return null;
  }

  try {
    const date: Date = OneUptimeDate.fromString(value);
    return isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
};

/*
 * The moment a note belongs to. A public note is filed under the time it was
 * posted - what the status page shows, and what someone backdating an update
 * chose - and falls back to when it was written. A private note has only the
 * latter.
 */
export function getNoteTimestamp(
  note: NoteRecord,
  visibility: NoteVisibility,
): Date | null {
  if (visibility === "public") {
    return toDate(note.postedAt) || toDate(note.createdAt);
  }

  return toDate(note.createdAt);
}

export interface NoteDayGroup<T> {
  key: string;
  label: string;
  notes: Array<T>;
}

export const UNDATED_GROUP_KEY: string = "undated";

/*
 * Split an already sorted feed into runs of notes from the same calendar day
 * in the viewer's timezone. Order is kept exactly as given, so the caller's
 * sort decides both the order of the days and of the notes within one.
 */
export function groupNotesByDay<T>(data: {
  notes: Array<T>;
  getDate: (note: T) => Date | null;
  now: Date;
}): Array<NoteDayGroup<T>> {
  const groups: Array<NoteDayGroup<T>> = [];
  const yesterday: Date = OneUptimeDate.addRemoveDays(data.now, -1);

  for (const note of data.notes) {
    const date: Date | null = data.getDate(note);

    let key: string = UNDATED_GROUP_KEY;
    let label: string = "Date unknown";

    if (date) {
      key = OneUptimeDate.getDateAsLocalFormattedString(date, true);

      if (OneUptimeDate.areOnTheSameLocalDay(date, data.now)) {
        label = "Today";
      } else if (OneUptimeDate.areOnTheSameLocalDay(date, yesterday)) {
        label = "Yesterday";
      } else {
        label = key;
      }
    }

    const lastGroup: NoteDayGroup<T> | undefined = groups[groups.length - 1];

    if (lastGroup && lastGroup.key === key) {
      lastGroup.notes.push(note);
      continue;
    }

    groups.push({ key, label, notes: [note] });
  }

  return groups;
}

type ReadableValueFunction = (value: JSONValue | undefined) => string;

/*
 * A user arrives as a model (Name / Email objects), as its serialized form
 * ({_type: "Name", value: "..."}) or as a bare string.
 */
const readableValue: ReadableValueFunction = (
  value: JSONValue | undefined,
): string => {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "object") {
    const serialized: JSONValue | undefined = (value as JSONObject)["value"];

    if ((value as JSONObject)["_type"] && serialized !== undefined) {
      return readableValue(serialized);
    }
  }

  return value.toString().trim();
};

export const AUTOMATION_AUTHOR_NAME: string = "OneUptime";

/*
 * Who wrote a note. A note with no author was posted by OneUptime itself -
 * a workflow, the AI agent or an automatic status update.
 */
export function getAuthorName(user: User | JSONObject | null | undefined): {
  name: string;
  isAutomation: boolean;
} {
  if (!user) {
    return { name: AUTOMATION_AUTHOR_NAME, isAutomation: true };
  }

  const record: JSONObject =
    user instanceof BaseModel
      ? (user as unknown as JSONObject)
      : (user as JSONObject);

  const name: string = readableValue(record["name"] as JSONValue);
  const email: string = readableValue(record["email"] as JSONValue);

  if (name) {
    return { name, isAutomation: false };
  }

  if (email) {
    return { name: email, isAutomation: false };
  }

  return { name: "Unknown user", isAutomation: false };
}

export function getInitials(name: string): string {
  // An author known only by email reads better as the part before the @.
  const base: string = name.includes("@") ? name.split("@")[0] || name : name;

  const words: Array<string> = base
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word: string) => {
      return word.length > 0;
    });

  if (words.length === 0) {
    return "?";
  }

  if (words.length === 1) {
    return words[0]!.substring(0, 2).toUpperCase();
  }

  return (
    words[0]!.charAt(0) + words[words.length - 1]!.charAt(0)
  ).toUpperCase();
}

export function getUserId(
  user: User | JSONObject | null | undefined,
): ObjectID | null {
  if (!user) {
    return null;
  }

  const record: JSONObject = user as unknown as JSONObject;
  const raw: JSONValue | undefined =
    (record["_id"] as JSONValue) || (record["id"] as JSONValue);

  if (!raw) {
    return null;
  }

  try {
    return raw instanceof ObjectID ? raw : new ObjectID(raw.toString());
  } catch {
    return null;
  }
}

export function getNoteId(note: NoteRecord): string | null {
  const identifier: ObjectID | string | null | undefined = note.id || note._id;
  return identifier ? identifier.toString() : null;
}

/*
 * A note the editor would save as nothing. The rich text editor can leave an
 * empty paragraph behind as a line break or a non-breaking space, and a note
 * made only of those posts a blank update to the status page.
 */
export function isNoteBlank(text: string | undefined | null): boolean {
  if (!text) {
    return true;
  }

  return (
    text
      .replace(/&nbsp;/gi, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .trim().length === 0
  );
}

/*
 * Picking a template never throws away what someone already typed: an empty
 * draft takes the template, anything else gets it appended after a blank line.
 */
export function applyTemplateToDraft(
  draft: string | undefined | null,
  templateNote: string,
): string {
  if (isNoteBlank(draft)) {
    return templateNote;
  }

  return `${(draft || "").trimEnd()}\n\n${templateNote}`;
}

export function buildNotesQuery(data: {
  parentIdField: string;
  parentId: ObjectID;
  projectId: ObjectID | null;
  searchText?: string | undefined;
}): JSONObject {
  const query: JSONObject = {
    [data.parentIdField]: data.parentId,
  };

  if (data.projectId) {
    query["projectId"] = data.projectId;
  }

  const searchText: string = (data.searchText || "").trim();

  if (searchText) {
    query["note"] = new Search(searchText) as unknown as JSONValue;
  }

  return query;
}

export enum NoteNotificationTone {
  Neutral = "neutral",
  Pending = "pending",
  Progress = "progress",
  Success = "success",
  Danger = "danger",
}

export interface NoteNotificationSummary {
  label: string;
  tone: NoteNotificationTone;
  icon: IconProp;
  isRetryable: boolean;
  detail: string | null;
}

/*
 * What happened to the notification subscribers get when a public note is
 * posted. An unset status is what a note from before notifications existed,
 * or one posted with "notify" unticked, carries: nobody was told.
 */
export function getPostedNotificationSummary(
  status: StatusPageSubscriberNotificationStatus | null | undefined,
  message: string | null | undefined,
): NoteNotificationSummary {
  const detail: string | null = message?.trim() ? message.trim() : null;

  switch (status) {
    case StatusPageSubscriberNotificationStatus.Success:
      return {
        label: "Subscribers notified",
        tone: NoteNotificationTone.Success,
        icon: IconProp.CheckCircle,
        isRetryable: false,
        detail,
      };
    case StatusPageSubscriberNotificationStatus.Pending:
      return {
        label: "Notifying subscribers soon",
        tone: NoteNotificationTone.Pending,
        icon: IconProp.Clock,
        isRetryable: false,
        detail,
      };
    case StatusPageSubscriberNotificationStatus.InProgress:
      return {
        label: "Notifying subscribers",
        tone: NoteNotificationTone.Progress,
        icon: IconProp.ArrowPath,
        isRetryable: false,
        detail,
      };
    case StatusPageSubscriberNotificationStatus.Failed:
      return {
        label: "Notification failed",
        tone: NoteNotificationTone.Danger,
        icon: IconProp.Error,
        isRetryable: true,
        detail,
      };
    default:
      return {
        label: "Subscribers not notified",
        tone: NoteNotificationTone.Neutral,
        icon: IconProp.BellSlash,
        isRetryable: false,
        detail,
      };
  }
}

/*
 * The notification about an edit, which only exists once somebody asked for
 * one. Null means there is nothing to show.
 */
export function getUpdateNotificationSummary(
  status: StatusPageSubscriberNotificationStatus | null | undefined,
  message: string | null | undefined,
): NoteNotificationSummary | null {
  const detail: string | null = message?.trim() ? message.trim() : null;

  switch (status) {
    case StatusPageSubscriberNotificationStatus.Success:
      return {
        label: "Update sent",
        tone: NoteNotificationTone.Success,
        icon: IconProp.CheckCircle,
        isRetryable: false,
        detail,
      };
    case StatusPageSubscriberNotificationStatus.Pending:
      return {
        label: "Update queued",
        tone: NoteNotificationTone.Pending,
        icon: IconProp.Clock,
        isRetryable: false,
        detail,
      };
    case StatusPageSubscriberNotificationStatus.InProgress:
      return {
        label: "Sending update",
        tone: NoteNotificationTone.Progress,
        icon: IconProp.ArrowPath,
        isRetryable: false,
        detail,
      };
    case StatusPageSubscriberNotificationStatus.Failed:
      return {
        label: "Update failed",
        tone: NoteNotificationTone.Danger,
        icon: IconProp.Error,
        isRetryable: true,
        detail,
      };
    case StatusPageSubscriberNotificationStatus.Skipped:
      return {
        label: "Update not sent",
        tone: NoteNotificationTone.Neutral,
        icon: IconProp.BellSlash,
        isRetryable: false,
        detail,
      };
    default:
      return null;
  }
}

const IN_FLIGHT_STATUSES: Array<StatusPageSubscriberNotificationStatus> = [
  StatusPageSubscriberNotificationStatus.Pending,
  StatusPageSubscriberNotificationStatus.InProgress,
];

// Whether any note is waiting on a notification that has not settled yet.
export function hasNotificationInFlight(notes: Array<NoteRecord>): boolean {
  return notes.some((note: NoteRecord) => {
    return (
      (note.subscriberNotificationStatusOnNoteCreated !== undefined &&
        IN_FLIGHT_STATUSES.includes(
          note.subscriberNotificationStatusOnNoteCreated,
        )) ||
      (note.subscriberNotificationStatusOnNoteUpdated !== undefined &&
        IN_FLIGHT_STATUSES.includes(
          note.subscriberNotificationStatusOnNoteUpdated,
        ))
    );
  });
}

export interface NotesCopy {
  title: string;
  description: string;
  composerPlaceholder: string;
  composerPrompt: string;
  emptyTitle: string;
  emptyDescription: string;
  audienceLabel: string;
  audienceHint: string;
  submitLabel: string;
  deleteTitle: string;
  deleteDescription: string;
  noteNoun: string;
}

/*
 * The words a feed uses. The two kinds of note look alike on screen, so the
 * copy carries most of the difference: who will read this, and where.
 */
export function getNotesCopy(
  visibility: NoteVisibility,
  eventNoun: string,
): NotesCopy {
  if (visibility === "public") {
    return {
      title: "Public notes",
      description: `Customer-facing updates about this ${eventNoun}. They appear on your status page, and subscribers can be notified when you post one.`,
      composerPlaceholder:
        "Tell your customers what is happening, what you are doing about it, and when they will hear from you next.",
      composerPrompt: "Post an update to your status page…",
      emptyTitle: "No public updates yet",
      emptyDescription: `Keep your customers in the loop. Public notes are shown on the status page for this ${eventNoun}.`,
      audienceLabel: "Public",
      audienceHint: "Visible on your status page",
      submitLabel: "Post update",
      deleteTitle: "Delete this public note?",
      deleteDescription:
        "It will be removed from your status page. Subscribers who were already notified keep the message they received. This cannot be undone.",
      noteNoun: "public note",
    };
  }

  return {
    title: "Private notes",
    description: `Internal notes for your team about this ${eventNoun}. They are never shown on a status page or sent to subscribers.`,
    composerPlaceholder:
      "Share findings, decisions and next steps with your team.",
    composerPrompt: "Write a note for your team…",
    emptyTitle: "No private notes yet",
    emptyDescription: `Capture what your team learns while working on this ${eventNoun}. Only people in your project can see private notes.`,
    audienceLabel: "Private",
    audienceHint: "Only your team can see this",
    submitLabel: "Add note",
    deleteTitle: "Delete this private note?",
    deleteDescription:
      "The note will be permanently deleted. This cannot be undone.",
    noteNoun: "private note",
  };
}

/*
 * Whether the viewer may read one column. Mirrors the notes table this feed
 * replaced: a column with no read rule is readable, and one with a rule needs
 * a matching permission. Asking for a column the viewer cannot read fails the
 * whole list request, so the feed only selects what passes this.
 */
export function canReadNoteColumn(data: {
  model: BaseModel;
  column: string;
  userPermissions: Array<Permission>;
  isMasterAdmin: boolean;
}): boolean {
  if (data.isMasterAdmin) {
    return true;
  }

  const accessControl: Dictionary<ColumnAccessControl> =
    data.model.getColumnAccessControlForAllColumns();

  const readPermissions: Array<Permission> | undefined =
    accessControl[data.column]?.read;

  if (!readPermissions) {
    return true;
  }

  return PermissionHelper.doesPermissionsIntersect(
    [...data.userPermissions, Permission.Public],
    readPermissions,
  );
}

/*
 * The columns the feed asks for. Public notes add their posting time and
 * notification state; attachments are only asked for where the note type can
 * serve them back.
 *
 * Columns the viewer cannot read are left out - but only once their
 * permissions are known. The snapshot arrives on a response header, so it is
 * empty for the first requests after signing in; filtering against nothing
 * would ask for bare ids and draw a feed of blank notes. Until it arrives the
 * server, which knows, decides.
 */
export function buildNotesSelect(data: {
  model: BaseModel;
  visibility: NoteVisibility;
  isAttachmentsEnabled: boolean;
  userPermissions: Array<Permission>;
  isMasterAdmin: boolean;
}): JSONObject {
  const candidates: JSONObject = {
    _id: true,
    note: true,
    createdAt: true,
    postedFromSlackMessageId: true,
    createdByUser: {
      _id: true,
      name: true,
      email: true,
    },
  };

  if (data.isAttachmentsEnabled) {
    candidates["attachments"] = {
      _id: true,
      name: true,
      fileType: true,
    };
  }

  if (data.visibility === "public") {
    candidates["postedAt"] = true;
    candidates["subscriberNotificationStatusOnNoteCreated"] = true;
    candidates["subscriberNotificationStatusMessage"] = true;
    candidates["subscriberNotificationStatusOnNoteUpdated"] = true;
    candidates["subscriberNotificationStatusMessageOnNoteUpdated"] = true;
  }

  const select: JSONObject = {};
  const isPermissionSnapshotLoaded: boolean =
    data.isMasterAdmin || data.userPermissions.length > 0;

  for (const column of Object.keys(candidates)) {
    const isKnownColumn: boolean =
      column === "_id" || data.model.hasColumn(column);

    if (!isKnownColumn) {
      continue;
    }

    if (
      column === "_id" ||
      !isPermissionSnapshotLoaded ||
      canReadNoteColumn({
        model: data.model,
        column,
        userPermissions: data.userPermissions,
        isMasterAdmin: data.isMasterAdmin,
      })
    ) {
      select[column] = candidates[column] as JSONValue;
    }
  }

  return select;
}

export type ColumnAction = "create" | "update";

/*
 * Whether the viewer may write one column of a note, the same way the model
 * forms decide which fields to show: a master admin always may, anyone else
 * needs one of the permissions the column declares for the action. The
 * create form used to drop a column the viewer could not write; the composer
 * does the same by not offering the control at all.
 */
export function canWriteNoteColumn(data: {
  model: BaseModel;
  column: string;
  action: ColumnAction;
  userPermissions: Array<Permission>;
  isMasterAdmin: boolean;
}): boolean {
  if (data.isMasterAdmin) {
    return true;
  }

  const accessControl: Dictionary<ColumnAccessControl> =
    data.model.getColumnAccessControlForAllColumns();

  const columnPermissions: Array<Permission> =
    accessControl[data.column]?.[data.action] || [];

  if (columnPermissions.length === 0) {
    return false;
  }

  return PermissionHelper.doesPermissionsIntersect(
    [...data.userPermissions, Permission.Public],
    columnPermissions,
  );
}

/*
 * The value a <input type="datetime-local"> shows for a date, in the viewer's
 * configured timezone rather than the browser's. Seconds are dropped: nobody
 * backdates an update to the second.
 */
export function toDateTimeInputValue(date: Date): string {
  return OneUptimeDate.toDateTimeLocalString(date).substring(0, 16);
}

export function fromDateTimeInputValue(value: string): Date | null {
  if (!value || !value.trim()) {
    return null;
  }

  try {
    const date: Date = OneUptimeDate.fromDateTimeLocalString(value);
    return isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

// Notes younger than this read as "5 minutes ago"; older ones by clock time.
export const RELATIVE_TIME_WINDOW_MS: number = 6 * 60 * 60 * 1000;

/*
 * The short time beside a note's author. The day heading above it already
 * names the date, so a note from this morning reads "3 hours ago" and one
 * from last week reads "14:03". The full date is in the tooltip.
 */
export function getNoteTimeLabel(date: Date, now: Date): string {
  const ageMs: number = now.getTime() - date.getTime();

  if (ageMs >= 0 && ageMs < RELATIVE_TIME_WINDOW_MS) {
    return getRelativeTimeLabel(ageMs);
  }

  return OneUptimeDate.getLocalTimeString(date, {
    use12HourFormat: OneUptimeDate.getUserPrefers12HourFormat(),
  });
}

/*
 * Measured against the `now` the feed rendered with, not the wall clock, so
 * every note on screen - and every test - agrees on what "now" is.
 */
export function getRelativeTimeLabel(ageMs: number): string {
  const minutes: number = Math.floor(Math.max(ageMs, 0) / (60 * 1000));

  if (minutes < 1) {
    return "just now";
  }

  if (minutes < 60) {
    return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  }

  const hours: number = Math.floor(minutes / 60);

  return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
}

export function getNoteFullTimeLabel(date: Date): string {
  return OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(date);
}

// "Posted from Slack" and the like, for notes that did not start here.
export function getNoteSourceLabel(note: NoteRecord): string | null {
  if (note.postedFromSlackMessageId) {
    return "via Slack";
  }

  return null;
}
