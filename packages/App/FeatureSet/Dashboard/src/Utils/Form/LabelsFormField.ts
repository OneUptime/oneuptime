import Label from "Common/Models/DatabaseModels/Label";
import type SelectFormFields from "Common/UI/Types/SelectEntityField";
import type Field from "Common/UI/Components/Forms/Types/Field";
import type { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";

/*
 * THE LABELS FIELD OF EVERY FORM: FOLDED UNDER ADVANCED, NEVER A STEP.
 *
 * Labels do two things. They group related resources, so lists can be
 * filtered by them, and they decide what a team whose access is restricted
 * by labels can see: a permission scoped "Restrict by labels" reaches only
 * the resources that carry one of its labels (Settings > Teams, see the
 * Permissions docs). Most projects never restrict a team that way, and the
 * forms themselves called the field "optional and an advanced feature" -
 * yet 41 forms gave it a wizard step of its own, so creating a host or
 * renaming a status page meant a Next for one optional field.
 *
 * Every form now asks for labels the same way: this field, at the end of
 * the step that holds the record's name and description, folded under the
 * form's collapsed Advanced section (getAdvancedFormSection). The section
 * says "Configured" while labels are set, opens by itself when the field
 * fails validation, and keeps its value when folded. A form left with three
 * rows or fewer has no steps at all (LongFormStepsGuard counts a folded
 * section as one row).
 *
 * How to use it:
 *
 *   // Labels alone under Advanced:
 *   getLabelsFormField<Host>()
 *   getLabelsFormField<Monitor>({ stepId: "monitor-info" })
 *
 *   // Labels with other folded options - one section, built once, handed
 *   // to every field in it, and those fields next to each other:
 *   const advancedSection = getAdvancedFormSection<Host>();
 *   { ...descriptionField, collapsibleSection: advancedSection },
 *   getLabelsFormField<Host>({ collapsibleSection: advancedSection }),
 *
 * Common/Tests/UI/Components/Forms/LabelsFormFieldGuard.test.ts holds every
 * form to this: a resource whose labels decide access asks for them with
 * this helper, folded, and never on a step of their own.
 */

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
   * read them as one only when each names the same section. Left out, the
   * field gets an Advanced section of its own.
   */
  collapsibleSection?: FormFieldCollapsibleSection<TEntity> | undefined;
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
    /*
     * What labels do, for every resource whose labels decide access. A
     * template, whose labels are handed on to what it creates, says so in
     * a description of its own.
     */
    description:
      "Labels group related resources. Teams whose access is restricted by labels see only the resources that carry one of their labels.",
    ...rest,
    field: { labels: true } as unknown as SelectFormFields<TEntity>,
    fieldType: FormFieldSchemaType.MultiSelectDropdown,
    dropdownModal: {
      type: Label,
      labelField: "name",
      valueField: "_id",
    },
    required: false,
    placeholder: "Labels",
    collapsibleSection: collapsibleSection || getAdvancedFormSection<TEntity>(),
  };
};

export default getLabelsFormField;
