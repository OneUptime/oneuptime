import { JSONObject } from "Common/Types/JSON";

/**
 * Which note a bulk state change writes. Public notes are published to the
 * status page (incidents, scheduled maintenance) while private notes stay
 * internal to the team (alerts, episodes). This mirrors what the single-event
 * "change state" modal on the event overview page already offers.
 */
export enum BulkStateChangeNoteType {
  Public = "Public",
  Private = "Private",
}

export interface BulkStateChangeNoteTemplate {
  id: string;
  templateName: string;
  note: string;
}

// A note template row as the API returns it (IncidentNoteTemplate & co).
export interface NoteTemplateRow {
  id?: { toString: () => string } | null | undefined;
  templateName?: string | undefined;
  note?: string | undefined;
}

/**
 * The picker's view of a note template row: its id as a string, and empty
 * strings for what the row leaves out, so a template is never shown as
 * "undefined".
 */
export function toBulkStateChangeNoteTemplate(
  template: NoteTemplateRow,
): BulkStateChangeNoteTemplate {
  return {
    id: template.id?.toString() || "",
    templateName: template.templateName || "",
    note: template.note || "",
  };
}

/**
 * The key the note travels under. It is not a column on the state timeline
 * model — the timeline services read it off `miscDataProps` and turn it into
 * a public or internal note on the event.
 */
export function getBulkStateChangeNoteFieldKey(
  noteType: BulkStateChangeNoteType,
): string {
  return noteType === BulkStateChangeNoteType.Public
    ? "publicNote"
    : "privateNote";
}

export function getBulkStateChangeNoteTemplateFieldKey(
  noteType: BulkStateChangeNoteType,
): string {
  return `${getBulkStateChangeNoteFieldKey(noteType)}Template`;
}

/**
 * Find the note body behind a selected template. Returns an empty string when
 * nothing matches so callers can leave the note field untouched.
 */
export function getNoteFromTemplate(
  templates: Array<BulkStateChangeNoteTemplate>,
  templateId: string | undefined | null,
): string {
  if (!templateId) {
    return "";
  }

  const template: BulkStateChangeNoteTemplate | undefined = templates.find(
    (template: BulkStateChangeNoteTemplate) => {
      return template.id === templateId.toString();
    },
  );

  return template?.note || "";
}

/**
 * Build the `miscDataProps` payload for one state timeline create. A blank
 * note is dropped entirely so an untouched textbox never creates an empty
 * note on the event.
 */
export function buildBulkStateChangeMiscDataProps(data: {
  noteType: BulkStateChangeNoteType;
  note?: string | undefined;
}): JSONObject {
  if (!data.note || data.note.trim() === "") {
    return {};
  }

  return {
    [getBulkStateChangeNoteFieldKey(data.noteType)]: data.note,
  };
}

/*
 * What one incident's bulk state change sends. The dialog writes one public
 * note for every incident it moves, with "Notify Status Page Subscribers".
 * A private incident takes no public notes and reaches no subscriber
 * (Common/Types/StatusPage/PrivateRecordPublicNotes), and the server refuses
 * a change that comes with a public note on one: it gets the same note as a
 * private note, and notifies nobody. The dialog's description says so.
 */
export interface IncidentBulkStateChange {
  miscDataProps: JSONObject;
  shouldStatusPageSubscribersBeNotified: boolean;
}

export function buildIncidentBulkStateChange(data: {
  isPrivate: boolean;
  note?: string | undefined;
  shouldStatusPageSubscribersBeNotified?: boolean | undefined;
}): IncidentBulkStateChange {
  if (data.isPrivate) {
    return {
      miscDataProps: buildBulkStateChangeMiscDataProps({
        noteType: BulkStateChangeNoteType.Private,
        note: data.note,
      }),
      shouldStatusPageSubscribersBeNotified: false,
    };
  }

  return {
    miscDataProps: buildBulkStateChangeMiscDataProps({
      noteType: BulkStateChangeNoteType.Public,
      note: data.note,
    }),
    shouldStatusPageSubscribersBeNotified:
      data.shouldStatusPageSubscribersBeNotified ?? true,
  };
}

/*
 * Which records a move leaves alone - one there already, or past it, never
 * moved back up its list - and why, in the reader's language, is decided by
 * the state timeline's own rule (Common/Utils/StateMove), through
 * EventStateMoves (Components/EventView), which every list's moves read
 * (useEventStateActions). A record left alone is listed as not changed, not
 * as failed: nothing went wrong.
 */
