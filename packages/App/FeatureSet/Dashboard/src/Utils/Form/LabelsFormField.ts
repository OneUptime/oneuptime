import Label from "Common/Models/DatabaseModels/Label";
import type SelectFormFields from "Common/UI/Types/SelectEntityField";
import type Field from "Common/UI/Components/Forms/Types/Field";
import type { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The Labels field of every form: folded under Advanced, never a step.
 *
 * Labels do two things. They group related resources, so lists can be
 * filtered by them. And they decide what a team sees when its permissions
 * are restricted to labels (Settings > Teams, "Restrict by labels"): such a
 * team reaches only the resources that carry one of its labels. Most
 * projects never restrict a team that way, and the forms themselves called
 * the field "optional and an advanced feature". Yet 41 forms gave it a
 * wizard step of its own, so creating a host or renaming a status page
 * meant a Next for one optional field, and the rest showed it as an open
 * field beside the name.
 *
 * Every form now asks for labels the same way: this field, at the end of
 * the step that holds the record's name, folded under the form's collapsed
 * Advanced section (getAdvancedFormSection). The section reads "Configured"
 * while labels are set, opens by itself when a field in it fails
 * validation, and keeps its values while folded. A form left with three
 * rows or fewer has no steps at all (LongFormStepsGuard counts a folded
 * section as one row).
 *
 * How to use it:
 *
 *   // Labels alone under Advanced:
 *   getLabelsFormField<Host>()
 *   getLabelsFormField<Monitor>({ stepId: "monitor-info" })
 *
 *   // Labels with other rarely used options: build the section once, hand
 *   // the same one to every field in it, and keep those fields together at
 *   // the end of the list (or of their step):
 *   const advancedSection = getAdvancedFormSection<Host>();
 *   { ...descriptionField, collapsibleSection: advancedSection },
 *   getLabelsFormField<Host>({ collapsibleSection: advancedSection }),
 *
 * A template, whose labels are handed on to what it creates, says so in a
 * description of its own.
 *
 * Common/Tests/UI/Components/Forms/LabelsFormFieldGuard.test.ts holds every
 * form to this: a resource whose labels decide access asks for them with
 * this helper, folded, last on its step, and no step holds only labels.
 */

// What labels do, said on every form whose resource they decide access to.
export const LABELS_FORM_FIELD_DESCRIPTION: string = translationKey(
  "Labels group related resources so you can filter by them. A team whose permissions are restricted to labels only sees resources that carry one of its labels.",
);

export interface LabelsFormFieldOptions<TEntity>
  extends Omit<
    Field<TEntity>,
    | "field"
    | "title"
    | "fieldType"
    | "dropdownModal"
    | "required"
    | "placeholder"
    | "overrideFieldKey"
    | "collapsibleSection"
  > {
  /*
   * The Advanced section the field folds into. Pass the form's own when
   * other fields fold beside it (a create form's description, say): fields
   * next to each other in one section draw as one header, and the guards
   * read them as one row only when each names the same section. Left out,
   * the field gets an Advanced section of its own. There is no way to show
   * the field open.
   */
  collapsibleSection?: FormFieldCollapsibleSection<TEntity>;
}

export type GetLabelsFormFieldFunction = <TEntity>(
  options?: LabelsFormFieldOptions<TEntity>,
) => Field<TEntity>;

export const getLabelsFormField: GetLabelsFormFieldFunction = <TEntity>(
  options?: LabelsFormFieldOptions<TEntity>,
): Field<TEntity> => {
  const { collapsibleSection, ...rest } = options || {};

  return {
    title: "Labels",
    description: LABELS_FORM_FIELD_DESCRIPTION,
    ...rest,
    field: { labels: true } as unknown as SelectFormFields<TEntity>,
    fieldType: FormFieldSchemaType.MultiSelectDropdown,
    dropdownModal: {
      type: Label,
      labelField: "name",
      valueField: "_id",
    },
    required: false,
    placeholder: "Select labels",
    collapsibleSection: collapsibleSection || getAdvancedFormSection<TEntity>(),
  };
};

export default getLabelsFormField;
