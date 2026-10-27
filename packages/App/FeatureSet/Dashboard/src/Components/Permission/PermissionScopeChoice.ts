import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "Common/Models/DatabaseModels/Label";
import PermissionScope from "Common/Types/Database/AccessControl/PermissionScope";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import type { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import type { RadioButton } from "Common/UI/Components/RadioButtons/GroupRadioButtons";
import SelectFormFields from "Common/UI/Types/SelectEntityField";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * HOW FAR A PERMISSION REACHES: THREE PLAIN ANSWERS.
 *
 * "Shouldnt this be two buttons ... to make it easier for people to
 * understand whats going on." (the maintainer, on a switch whose
 * description explained both of its modes)
 *
 * A team's permission and a custom role's permission are each given a
 * scope. The Scope field was a dropdown whose one description listed all
 * three answers ("all (recommended), the ones this team owns, or the ones
 * with certain labels"), so a reader had to open the list and match the
 * names back to the sentence - and two of the names were off: "Owned by
 * this team or its members", and "Restrict by labels (advanced)", an
 * answer that called itself advanced. The answers are now on screen, each
 * with one line under it, All first: what most teams want.
 *
 * WHOSE RESOURCES. The server reads an Owned permission as reaching what
 * the person acting owns, and what the team the permission is given to
 * owns - never what the person's other teams own (Server/Types/Database/
 * Permissions/OwnedScopePermission, getOwningTeamIds): a member of a team
 * that may change what it owns and of a team that may only view what it
 * owns changes the first team's incidents and only views the second's. A
 * custom role's Owned permission reaches what each team given the role
 * owns. The line under the answer says so.
 *
 * Only the words changed. The stored values are the PermissionScope values
 * they always were (All, Owned, Labels), so the API, Terraform and every
 * permission already given read and behave as before. Picking "Only
 * resources with certain labels" now asks for at least one label, as a
 * custom role's form already did: with none, the permission reached every
 * resource while its row said it was narrowed.
 *
 * One list for both forms and for both tables' Scope column, so an answer
 * reads the same wherever it is picked or shown. React-free, so App's
 * tests read it without rendering a page.
 *
 * FOLDED UNDER MORE FIELDS. All resources in the project is what most
 * teams want - its own line says "Recommended for most teams." - so the
 * Scope waits folded under the form's More fields line, as every rarely
 * changed setting does, and the Add a Role and Add a Permission dialogs
 * ask for the role or the permission alone ("it gives a lot of
 * information to the user", the maintainer, on Add a Role). Folded, the
 * line names Scope - and a row narrowed to owned resources or to labels
 * says so on the same line ("Scope: Only resources they own"), so Edit
 * never hides it. A labels answer left without a label opens the fold by
 * itself.
 */

export const PERMISSION_SCOPE_FIELD_TITLE: string = translationKey("Scope");

export const PERMISSION_SCOPE_FIELD_DESCRIPTION: string = translationKey(
  "Which resources it reaches.",
);

/*
 * The answers' titles. All keeps the words it always had; the other two
 * say what they reach in plain words.
 */
export const PERMISSION_SCOPE_TITLES: Readonly<
  Record<PermissionScope, string>
> = {
  [PermissionScope.All]: translationKey("All resources in the project"),
  [PermissionScope.Owned]: translationKey("Only resources they own"),
  [PermissionScope.Labels]: translationKey(
    "Only resources with certain labels",
  ),
};

// One line under each answer: what picking it means.
export const PERMISSION_SCOPE_DESCRIPTIONS: Readonly<
  Record<PermissionScope, string>
> = {
  [PermissionScope.All]: translationKey("Recommended for most teams."),
  [PermissionScope.Owned]: translationKey(
    "Resources the person, or the team given this permission, owns.",
  ),
  [PermissionScope.Labels]: translationKey(
    "Resources that carry one of the labels you pick.",
  ),
};

// In the order the form offers them: the default first, the narrowest last.
export const PERMISSION_SCOPE_ANSWERS: ReadonlyArray<PermissionScope> = [
  PermissionScope.All,
  PermissionScope.Owned,
  PermissionScope.Labels,
];

// The Scope field's answers, each with its line.
export const getPermissionScopeChoices: () => Array<RadioButton> =
  (): Array<RadioButton> => {
    return PERMISSION_SCOPE_ANSWERS.map(
      (scope: PermissionScope): RadioButton => {
        return {
          value: scope,
          title: PERMISSION_SCOPE_TITLES[scope],
          description: PERMISSION_SCOPE_DESCRIPTIONS[scope],
        };
      },
    );
  };

/*
 * The labels the third answer asks for. No line under it: the answer just
 * above says what they do ("Resources that carry one of the labels you
 * pick."), and the column's own sentence was written for the API.
 */
export const PERMISSION_LABELS_FIELD_TITLE: string = translationKey("Labels");

/*
 * The scope a row holds, as the tables show it. A row stored without one
 * reads as the column's default, All - as the server reads it.
 */
export const readPermissionScope: (value: unknown) => PermissionScope = (
  value: unknown,
): PermissionScope => {
  if (value === PermissionScope.Owned || value === PermissionScope.Labels) {
    return value;
  }

  return PermissionScope.All;
};

/*
 * What a Scope cell says: what the row reaches, as the server reads it.
 * The server narrows a permission by its labels whenever it has some,
 * whatever its scope (an API or Terraform caller can store labels under
 * All), and a labels row with none reaches every resource. So the cell
 * follows the labels, not the stored word: labels under All read as
 * "Only resources with certain labels", and a labels row with no label
 * reads as all resources rather than claiming to be narrowed. An Owned row
 * keeps its title, with any labels it also holds drawn under it.
 */
export interface PermissionScopeCell {
  title: string;
  // The labels that narrow the row, drawn under the title.
  labels: Array<Label>;
}

export const getPermissionScopeCell: (row: {
  scope?: unknown;
  labels?: Array<Label> | undefined | null;
}) => PermissionScopeCell = (row: {
  scope?: unknown;
  labels?: Array<Label> | undefined | null;
}): PermissionScopeCell => {
  const scope: PermissionScope = readPermissionScope(row.scope);
  const labels: Array<Label> = row.labels || [];

  if (scope === PermissionScope.Owned) {
    return { title: PERMISSION_SCOPE_TITLES[PermissionScope.Owned], labels };
  }

  if (labels.length === 0) {
    return { title: PERMISSION_SCOPE_TITLES[PermissionScope.All], labels: [] };
  }

  return { title: PERMISSION_SCOPE_TITLES[PermissionScope.Labels], labels };
};

type ValuesRecord = Record<string, unknown>;

const asRecord: (values: unknown) => ValuesRecord = (
  values: unknown,
): ValuesRecord => {
  return values && typeof values === "object" ? (values as ValuesRecord) : {};
};

// Whether the form holds labels: a row stored with some, or labels just picked.
export const holdsPermissionLabels: (values: unknown) => boolean = (
  values: unknown,
): boolean => {
  const labels: unknown = asRecord(values)["labels"];

  return Array.isArray(labels) && labels.length > 0;
};

// Whether the form's answer is the third one: only resources with labels.
export const isLabelsScopePicked: (values: unknown) => boolean = (
  values: unknown,
): boolean => {
  return asRecord(values)["scope"] === PermissionScope.Labels;
};

/*
 * Whether the role (or permission) a form holds takes a scope, so the form
 * shows its Scope, folded under More fields: not before one is picked, and
 * not for the roles that reach the whole project by definition - Project
 * Owner, Project Admin, Settings and Billing (PermissionHelper.
 * isScopeApplicable). A team's and a custom role's Add Role ask this both
 * for the Scope field and for the room the role picker keeps under itself
 * while the Scope is not shown (RolePickerFormField.isMoreFieldsShownFor),
 * so the two always agree.
 */
export const isScopeShownFor: (permission: unknown) => boolean = (
  permission: unknown,
): boolean => {
  return (
    Boolean(permission) &&
    PermissionHelper.isScopeApplicable(permission as Permission)
  );
};

export interface PermissionScopeFieldsOptions<TEntity> {
  /*
   * Whether the permission the form holds takes a scope at all: some are
   * project-wide by definition (PermissionHelper.isScopeApplicable).
   */
  isScopeShown: (values: FormValues<TEntity>) => boolean;
}

/**
 * The Scope choice and the labels it may ask for, for a team's permission
 * and a custom role's permission alike, folded under More fields.
 *
 * - Scope: the three answers, All picked to start with. Picking All or
 *   "Only resources they own" clears the labels, which would otherwise be
 *   saved with the row and narrow it while the form hid them.
 * - Labels: asked for, and required, once "Only resources with certain
 *   labels" is picked. A row stored with labels under another scope (an
 *   API or Terraform caller can write one) shows them too, so the form
 *   never hides what narrows the row.
 */
export const getPermissionScopeFields: <TEntity extends BaseModel>(
  options: PermissionScopeFieldsOptions<TEntity>,
) => Array<ModelField<TEntity>> = <TEntity extends BaseModel>(
  options: PermissionScopeFieldsOptions<TEntity>,
): Array<ModelField<TEntity>> => {
  const isLabelsShown: (values: FormValues<TEntity>) => boolean = (
    values: FormValues<TEntity>,
  ): boolean => {
    return (
      options.isScopeShown(values) &&
      (isLabelsScopePicked(values) || holdsPermissionLabels(values))
    );
  };

  // One fold for both: the line names the Scope, and the labels once asked.
  const moreFields: FormFieldCollapsibleSection<TEntity> =
    getAdvancedFormSection<TEntity>();

  return [
    {
      field: { scope: true } as unknown as SelectFormFields<TEntity>,
      title: PERMISSION_SCOPE_FIELD_TITLE,
      description: PERMISSION_SCOPE_FIELD_DESCRIPTION,
      fieldType: FormFieldSchemaType.RadioButton,
      radioButtonOptions: getPermissionScopeChoices(),
      defaultValue: PermissionScope.All,
      required: true,
      dataTestId: "permission-scope",
      showIf: options.isScopeShown,
      collapsibleSection: moreFields,
      onChange: (
        value: unknown,
        currentValues: FormValues<TEntity>,
        setNewFormValues: (values: FormValues<TEntity>) => void,
      ): void => {
        if (value === PermissionScope.Labels) {
          return;
        }

        if (!holdsPermissionLabels(currentValues)) {
          return;
        }

        setNewFormValues({
          ...(currentValues as ValuesRecord),
          labels: [],
        } as unknown as FormValues<TEntity>);
      },
    },
    {
      field: { labels: true } as unknown as SelectFormFields<TEntity>,
      title: PERMISSION_LABELS_FIELD_TITLE,
      hideColumnDescription: true,
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
      dropdownModal: {
        type: Label,
        labelField: "name",
        valueField: "_id",
      },
      placeholder: "Select labels",
      showIf: isLabelsShown,
      collapsibleSection: moreFields,
      required: (values: FormValues<TEntity>): boolean => {
        return options.isScopeShown(values) && isLabelsScopePicked(values);
      },
    },
  ];
};
