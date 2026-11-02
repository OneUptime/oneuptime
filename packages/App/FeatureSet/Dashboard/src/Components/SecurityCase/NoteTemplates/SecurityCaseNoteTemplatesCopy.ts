import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * What Security Events > Settings > Note Templates and a template's own
 * page say. The ready-made text a team writes on case after case - a
 * triage summary, a containment checklist, a hand-over to the next shift -
 * picked from the Templates menu of a case's note composer, where it lands
 * in the note to be edited before it is posted.
 *
 * React-free, so the docs facts and the locale checks read the same words
 * the pages draw. Every sentence is a key of the Dashboard's locale files.
 */
export const SECURITY_CASE_NOTE_TEMPLATES_COPY: {
  // The page's names for one template and several: under its title, not the model's.
  singularName: string;
  pluralName: string;
  title: string;
  description: string;
  noItemsMessage: string;
  nameTitle: string;
  namePlaceholder: string;
  nameDescription: string;
  descriptionTitle: string;
  descriptionPlaceholder: string;
  // The template's own page.
  detailsTitle: string;
  detailsDescription: string;
  editDetailsButtonText: string;
  noteCardTitle: string;
  editNoteButtonText: string;
} = {
  singularName: translationKey("Note Template"),
  pluralName: translationKey("Note Templates"),
  title: translationKey("Case Note Templates"),
  description: translationKey(
    "Ready-made text for the notes your team writes on its cases. Pick one in a case's note composer and edit it before posting.",
  ),
  noItemsMessage: translationKey("No note templates yet."),
  nameTitle: translationKey("Template Name"),
  namePlaceholder: translationKey("Containment checklist"),
  nameDescription: translationKey(
    "What people pick the template by in a case's note composer.",
  ),
  descriptionTitle: translationKey("Template Description"),
  descriptionPlaceholder: translationKey(
    "What was contained, how, and what is still open.",
  ),
  detailsTitle: translationKey("Template Details"),
  detailsDescription: translationKey(
    "The name people pick this template by, and what it is for.",
  ),
  editDetailsButtonText: translationKey("Edit Details"),
  noteCardTitle: translationKey("Note Template"),
  editNoteButtonText: translationKey("Edit Note Template"),
};

export default SECURITY_CASE_NOTE_TEMPLATES_COPY;
