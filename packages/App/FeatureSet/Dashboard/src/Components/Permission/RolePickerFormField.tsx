import RolePicker from "./RolePicker";
import { RoleReach } from "./RoleCatalog";
import { ROLE_PICKER_FIELD_TITLE } from "./RolePickerOptions";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Permission from "Common/Types/Permission";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import SelectFormFields from "Common/UI/Types/SelectEntityField";
import React, { ReactElement } from "react";

/*
 * THE ROLE FIELD OF EVERY ADD A ROLE: a team's permissions and block
 * permissions, an API key's permissions and a custom role's permissions.
 * One builder, so each of them asks the same way (RolePicker), and the
 * row's permission column holds the role picked - the value the role
 * cards used to save.
 *
 * The picker draws its own controls and no label over them: the dialog is
 * called Add a Role, and a "Role" heading under that title said it twice.
 * The field keeps its title for the form's own words ("Role is required.")
 * and for screen readers, which hear it as the name of the picker's switch.
 */

export interface RolePickerFormFieldOptions {
  // Roles not offered: a custom role leaves out Project Owner.
  excludeRoles?: ReadonlyArray<Permission> | undefined;
  // The answer the picker opens on when nothing is picked yet.
  startOn?: RoleReach | undefined;
  /*
   * What the table does when the role changes - clear the labels picked
   * for the last one, set the scope a role without one reaches.
   */
  onChange?: ((value: unknown) => Promise<void> | void) | undefined;
  // An API key's Edit uses the one-permission picker instead.
  doNotShowWhenEditing?: boolean | undefined;
}

export const ROLE_PICKER_TEST_ID: string = "role-picker";

export const getRolePickerFormField: <TEntity extends BaseModel>(
  options?: RolePickerFormFieldOptions,
) => ModelField<TEntity> = <TEntity extends BaseModel>(
  options?: RolePickerFormFieldOptions,
): ModelField<TEntity> => {
  const field: ModelField<TEntity> = {
    field: { permission: true } as unknown as SelectFormFields<TEntity>,
    title: ROLE_PICKER_FIELD_TITLE,
    fieldType: FormFieldSchemaType.CustomComponent,
    customElementDrawsOwnLabel: true,
    required: true,
    dataTestId: ROLE_PICKER_TEST_ID,
    getCustomElement: (
      _values: FormValues<TEntity>,
      customElementProps: CustomElementProps,
    ): ReactElement => {
      return (
        <RolePicker
          value={customElementProps.initialValue as Permission | undefined}
          onChange={(value: Permission | null) => {
            customElementProps.onChange?.(value);
          }}
          error={customElementProps.error}
          excludeRoles={options?.excludeRoles}
          startOn={options?.startOn}
          dataTestId={ROLE_PICKER_TEST_ID}
        />
      );
    },
  };

  if (options?.onChange) {
    field.onChange = options.onChange;
  }

  if (options?.doNotShowWhenEditing) {
    field.doNotShowWhenEditing = true;
  }

  return field;
};
