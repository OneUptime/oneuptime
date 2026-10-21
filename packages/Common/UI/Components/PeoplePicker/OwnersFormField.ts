import type SelectFormFields from "../../Types/SelectEntityField";
import type Field from "../Forms/Types/Field";
import FormFieldSchemaType from "../Forms/Types/FormFieldSchemaType";
import { PeoplePickerFieldConfig, PeoplePickerKind } from "./PeoplePickerTypes";

/*
 * The one "Owners" field every form that asks for owners uses: people and
 * teams in one picker (see PeoplePicker), where there used to be an
 * "Owner - Teams" and an "Owner - Users" dropdown. React-free, so a form
 * declared in a plain module (BurnRateRuleForm.ts, the Forms On Submit
 * editor) can use it too.
 *
 * The picks are written to the same two form values the dropdowns wrote -
 * ownerTeams and ownerUsers, unless the form names others - so nothing
 * about what is saved changes. ModelForm saves a value that is a column of
 * the form's model as that column (an owner rule's ownerTeams), and sends
 * any other as misc data (a template's owners).
 *
 * The field's own key ("owners") only names the field in the form; nothing
 * is sent under it.
 */

export const OWNERS_FORM_FIELD_KEY: string = "owners";

export const OWNERS_ADD_BUTTON_TEXT: string = "Add owner";

// The Owners field of every owner rule (the rules under Settings > Owner Rules).
export const OWNER_RULE_OWNERS_DESCRIPTION: string =
  "When this rule matches, these people and teams are added as owners. Owners already assigned are not added twice.";

export interface OwnersPeoplePickerKeys {
  // The form value the picked teams are kept in. Default: ownerTeams.
  teamsKey?: string | undefined;
  // The form value the picked people are kept in. Default: ownerUsers.
  usersKey?: string | undefined;
}

// People first, then teams: the order the Owners page lists them in.
export const getOwnersPeoplePickerConfig: (
  keys?: OwnersPeoplePickerKeys,
) => PeoplePickerFieldConfig = (
  keys?: OwnersPeoplePickerKeys,
): PeoplePickerFieldConfig => {
  return {
    kinds: [
      {
        kind: PeoplePickerKind.User,
        valueKey: keys?.usersKey || "ownerUsers",
      },
      {
        kind: PeoplePickerKind.Team,
        valueKey: keys?.teamsKey || "ownerTeams",
      },
    ],
    addButtonText: OWNERS_ADD_BUTTON_TEXT,
    searchPlaceholder: "Search people or teams...",
    emptyText: "No people or teams available.",
  };
};

export interface OwnersFormFieldOptions<TEntity>
  extends OwnersPeoplePickerKeys,
    Omit<
      Field<TEntity>,
      "field" | "fieldType" | "peoplePicker" | "formOnly" | "overrideFieldKey"
    > {
  /*
   * The field's own key in the form. Default: "owners"; a form with two
   * owner pickers (an SLO burn rate rule's alert and incident owners) names
   * each.
   */
  fieldKey?: string | undefined;
}

export const getOwnersFormField: <TEntity>(
  options: OwnersFormFieldOptions<TEntity>,
) => Field<TEntity> = <TEntity>(
  options: OwnersFormFieldOptions<TEntity>,
): Field<TEntity> => {
  const { fieldKey, teamsKey, usersKey, ...rest } = options;

  return {
    title: "Owners",
    required: false,
    ...rest,
    field: {
      [fieldKey || OWNERS_FORM_FIELD_KEY]: true,
    } as SelectFormFields<TEntity>,
    fieldType: FormFieldSchemaType.PeoplePicker,
    peoplePicker: getOwnersPeoplePickerConfig({ teamsKey, usersKey }),
    formOnly: true,
  };
};

export default getOwnersFormField;
