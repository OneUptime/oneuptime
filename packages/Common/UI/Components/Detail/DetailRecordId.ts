import FieldType from "../Types/FieldType";

/*
 * "Raw IDs move out of the main detail grids into a small copy line."
 *
 * A record's own ID is something people copy - into an API call, a support
 * ticket, a Terraform import - and almost never something they read. Yet some
 * thirty-five details cards showed it as a field: a 36-character UUID in a
 * bordered pill, usually the first one, above the record's name. So Detail
 * no longer draws the record's own ID as a field. It goes on one small line
 * under the fields - "ID", the first characters, a copy button - with the
 * whole ID in the tooltip, in the copy, and in the page's text for
 * find-in-page.
 *
 * "The record's own ID" is a FieldType.ObjectID field on `_id`. Other IDs
 * stay fields: a related record's (the project ID on an API key) or one the
 * card is about (a WhatsApp phone number ID). A field drawn by its own
 * getElement is the page's to draw. A card whose point is the ID - the
 * project ID on Project Settings - keeps it as a field with showIdAsField.
 *
 * React-free on purpose, so the rule can be read and tested on its own.
 */

// The column every database record keeps its own ID in.
export const RECORD_ID_KEY: string = "_id";

/*
 * The line shows a UUID's first group - 8 characters - and an ellipsis. The
 * ID is set in a monospace font, so 8ch is exactly 8 characters: the clip
 * falls between two of them, whatever the font. A browser's own
 * text-overflow ellipsis does not, since its glyph can be wider than a
 * character and eat the 8th. The rest of the ID is still there, clipped: a
 * copy, a select-all or find-in-page sees all of it.
 */
export const SHORT_RECORD_ID_LENGTH: number = 8;
export const SHORT_RECORD_ID_WIDTH: string = `${SHORT_RECORD_ID_LENGTH}ch`;

// How long the copy button shows its tick after a copy.
export const RECORD_ID_COPIED_FEEDBACK_MS: number = 2000;

export interface RecordIdFieldLike {
  key?: unknown;
  fieldType?: FieldType | undefined;
  showIdAsField?: boolean | undefined;
  getElement?: unknown;
}

export const isRecordIdField: (field: RecordIdFieldLike) => boolean = (
  field: RecordIdFieldLike,
): boolean => {
  return (
    field.fieldType === FieldType.ObjectID &&
    field.key !== null &&
    field.key !== undefined &&
    String(field.key) === RECORD_ID_KEY &&
    !field.showIdAsField &&
    !field.getElement
  );
};

/*
 * The ID as text, from whatever the item holds: a string on a loaded model,
 * an ObjectID, or the { _type: "ObjectID", value } shape a JSON item carries.
 * Anything else - nothing, an empty string, an object with no value - is "",
 * which draws no line at all rather than an "ID" with nothing to copy.
 *
 * One reader for every place that shows a record's ID, so it lives with the
 * other ID pieces (ObjectID/RecordIdText.ts); the Show ID dialog reads IDs
 * through it too.
 */
export { getRecordIdText } from "../ObjectID/RecordIdText";
