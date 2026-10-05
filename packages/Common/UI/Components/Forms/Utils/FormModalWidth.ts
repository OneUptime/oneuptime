import { ModalWidth } from "../../Modal/Modal";
import Field from "../Types/Field";
import FormFieldSchemaType from "../Types/FormFieldSchemaType";

/*
 * A form with a Markdown editor opens in the wide dialog.
 *
 * "We have a markdown editor and forms, but the form is not wide, so the
 * controls of the markdown editor show in two lines. Can you please make
 * these forms wide where markdown editor is shown?" - the maintainer, on
 * the Create New Incident Note Template dialog: a stepped form, so it
 * opened Medium, and its editor was some 550px wide beside the step list
 * while the toolbar needs about 810px, and 900px with Insert variable. Only
 * the Large dialog leaves the editor that much room beside a step list on a
 * laptop. It is also what the pages that edit the same records - a note
 * template, a description, a postmortem - had already asked for, so a
 * record's create and edit dialogs are now the same width.
 *
 * It holds whatever width the page asked for: no form with an editor in it
 * is better narrow, and a guard (MarkdownFormsAreWide.test.ts) keeps pages
 * from asking for less. Where even the wide dialog is narrower than the
 * toolbar - a small laptop, a phone - the toolbar puts what does not fit
 * under its More formatting button instead of wrapping (MarkdownEditor,
 * MarkdownToolbarLayout).
 *
 * An editor folded away in a collapsed section is not shown until someone
 * opens the section, so it does not count while the section is folded: the
 * optional note of an Acknowledge or Resolve confirm (one sentence, a
 * checkbox and an "Add a public note" line) opens as the short dialog it
 * is, and grows to the wide one when the note is opened to be written. The
 * dialogs learn which sections are open from the sections themselves
 * (Forms/Utils/OpenFormSections.ts). An editor that is only shown on a
 * condition, or on another step, still counts: the dialog keeps its width
 * as the form is filled in and walked, and changes it only when someone
 * opens a section to see what is in it.
 *
 * ModelFormModal and BasicFormModal apply it. Every other form keeps the
 * width it had: the one its page asked for, else Medium for a stepped form
 * (room for the step list) and Normal for the rest.
 */
export const MARKDOWN_FORM_MODAL_WIDTH: ModalWidth = ModalWidth.Large;

export type HasMarkdownFieldFunction = <T>(
  fields: ReadonlyArray<Field<T>> | null | undefined,
  /*
   * The ids of the folded sections that are open now. Left out, a folded
   * editor counts as well, as it does for a form nobody tracks.
   */
  openSectionIds?: ReadonlyArray<string> | undefined,
) => boolean;

/*
 * The form has a field drawn with the Markdown editor. One shown only on a
 * condition counts, so the dialog keeps its width as the form is filled
 * in; one in a folded section counts once its section is open. A field the
 * dialog leaves out altogether - the create-only and edit-only fields
 * ModelTable filters out first - is not handed in at all.
 */
export const hasMarkdownField: HasMarkdownFieldFunction = <T>(
  fields: ReadonlyArray<Field<T>> | null | undefined,
  openSectionIds?: ReadonlyArray<string> | undefined,
): boolean => {
  return Boolean(
    fields?.some((field: Field<T>): boolean => {
      if (field.fieldType !== FormFieldSchemaType.Markdown) {
        return false;
      }

      if (field.collapsibleSection && openSectionIds) {
        return openSectionIds.includes(field.collapsibleSection.id);
      }

      return true;
    }),
  );
};

export type GetFormModalWidthFunction = <T>(data: {
  fields: ReadonlyArray<Field<T>> | null | undefined;
  // The width the dialog would open at without an editor in its form.
  width: ModalWidth | undefined;
  // The folded sections open now (see hasMarkdownField).
  openSectionIds?: ReadonlyArray<string> | undefined;
}) => ModalWidth | undefined;

export const getFormModalWidth: GetFormModalWidthFunction = <T>(data: {
  fields: ReadonlyArray<Field<T>> | null | undefined;
  width: ModalWidth | undefined;
  openSectionIds?: ReadonlyArray<string> | undefined;
}): ModalWidth | undefined => {
  return hasMarkdownField(data.fields, data.openSectionIds)
    ? MARKDOWN_FORM_MODAL_WIDTH
    : data.width;
};
