/*
 * The note field of a note template's form - incidents', alerts' and
 * scheduled maintenance events', when the template is created and when its
 * note is edited.
 *
 * It was titled "Public or Private note template.", a sentence where a label
 * goes. The field is the note itself: what a note starts with when the
 * template is picked in a public or a private note, still editable before it
 * is posted (Components/EventNotes).
 *
 * Kept in one React-free module so the three forms show the same words and
 * App/Tests/Dashboard/TemplateVariablesI18n can check that each has an entry
 * in all seventeen Dashboard locale files.
 */

export const NoteTemplateFormCopy: {
  noteFieldTitle: string;
  noteFieldDescription: string;
} = {
  noteFieldTitle: "Note",
  noteFieldDescription:
    "The note's text when this template is picked. It can still be edited before it is posted.",
};

export default NoteTemplateFormCopy;
