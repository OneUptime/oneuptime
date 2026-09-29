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

export interface BulkStateChangeSkipDecision {
  shouldSkip: boolean;
  skippedMessage?: string | undefined;
}

/**
 * Bulk state changes only move events forward. An event already at (or past)
 * the target state is reported as skipped rather than failed, because nothing
 * went wrong — there was simply nothing to do.
 */
export function getBulkStateChangeSkipDecision(data: {
  currentOrder: number;
  targetOrder: number;
  currentStateName?: string | undefined;
  targetStateName?: string | undefined;
}): BulkStateChangeSkipDecision {
  if (data.currentOrder < data.targetOrder) {
    return {
      shouldSkip: false,
    };
  }

  const currentStateName: string = data.currentStateName || "Unknown";

  return {
    shouldSkip: true,
    skippedMessage: `Skipped: Already at "${currentStateName}" (at or past "${
      data.targetStateName || "Unknown"
    }")`,
  };
}
