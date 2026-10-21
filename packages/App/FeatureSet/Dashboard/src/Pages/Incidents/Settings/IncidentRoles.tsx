import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../../PageComponentProps";
import {
  IncidentRoleSettingsCopy,
  canOfferAllowMultipleUsers,
  getIncidentRoleDeleteLockedReason,
  getPrimaryIncidentRoleIds,
} from "../../../Components/IncidentRole/IncidentRoleSettings";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import RoleLabel from "Common/UI/Components/RoleLabel/RoleLabel";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import IncidentRole from "Common/Models/DatabaseModels/IncidentRole";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

/*
 * A project starts with one role, Incident Commander, and adds the others it
 * uses. The table shows what a role is - its name and description - and
 * nothing about how it is assigned: whether a role takes more than one
 * person lives in its form, folded under More fields. See
 * Components/IncidentRole/IncidentRoleSettings for the why.
 *
 * The form is one page: a name and a description, then More fields, folded,
 * with Allow Multiple Users, the icon and the colour. A new role's colour is
 * already picked - one the listed roles do not use yet (ModelForm,
 * Forms/Utils/CreateFormDefaults) - and its icon is optional, so nothing in
 * there has to be opened to create a role. They used to be a second step,
 * "Appearance", that every new role walked through to pick a colour.
 */
const IncidentRoles: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  /*
   * Which of the listed roles are primary, so the form can leave Allow
   * Multiple Users out of Incident Commander's Edit: the form only loads
   * the fields it shows, and the flag is not one of them.
   */
  const [primaryRoleIds, setPrimaryRoleIds] = useState<Set<string>>(
    new Set<string>(),
  );

  const advancedSection: FormFieldCollapsibleSection<IncidentRole> =
    getAdvancedFormSection<IncidentRole>();

  return (
    <Fragment>
      <ModelTable<IncidentRole>
        modelType={IncidentRole}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        id="incident-roles-table"
        name="Incidents > Settings > Incident Roles"
        userPreferencesKey="incident-roles-table"
        saveFilterProps={{
          tableId: "incident-roles-table",
        }}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        cardProps={{
          title: IncidentRoleSettingsCopy.title,
          description: IncidentRoleSettingsCopy.description,
        }}
        noItemsMessage={IncidentRoleSettingsCopy.noItemsMessage}
        viewPageRoute={Navigation.getCurrentRoute()}
        getDeleteDisabledReason={(role: IncidentRole): string | undefined => {
          return getIncidentRoleDeleteLockedReason(role);
        }}
        onFetchSuccess={(roles: Array<IncidentRole>) => {
          setPrimaryRoleIds(getPrimaryIncidentRoleIds(roles));
        }}
        formFields={[
          {
            field: {
              name: true,
            },
            title: IncidentRoleSettingsCopy.nameFieldTitle,
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: IncidentRoleSettingsCopy.namePlaceholder,
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            title: IncidentRoleSettingsCopy.descriptionFieldTitle,
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: IncidentRoleSettingsCopy.descriptionPlaceholder,
          },
          {
            field: {
              canAssignMultipleUsers: true,
            },
            title: IncidentRoleSettingsCopy.allowMultipleUsersTitle,
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description: IncidentRoleSettingsCopy.allowMultipleUsersDescription,
            collapsibleSection: advancedSection,
            showIf: (values: FormValues<IncidentRole>): boolean => {
              return canOfferAllowMultipleUsers({
                values: values,
                primaryRoleIds: primaryRoleIds,
              });
            },
          },
          {
            field: {
              roleIcon: true,
            },
            title: IncidentRoleSettingsCopy.iconFieldTitle,
            fieldType: FormFieldSchemaType.Icon,
            required: false,
            placeholder: IncidentRoleSettingsCopy.iconPlaceholder,
            collapsibleSection: advancedSection,
          },
          {
            field: {
              color: true,
            },
            title: IncidentRoleSettingsCopy.colorFieldTitle,
            fieldType: FormFieldSchemaType.Color,
            required: true,
            placeholder: IncidentRoleSettingsCopy.colorPlaceholder,
            collapsibleSection: advancedSection,
          },
        ]}
        showRefreshButton={true}
        selectMoreFields={{
          color: true,
          roleIcon: true,
          isPrimaryRole: true,
          isDeleteable: true,
        }}
        showViewIdButton={true}
        filters={[
          {
            field: {
              name: true,
            },
            type: FieldType.Text,
            title: IncidentRoleSettingsCopy.nameFieldTitle,
          },
          {
            field: {
              description: true,
            },
            type: FieldType.Text,
            title: IncidentRoleSettingsCopy.descriptionFieldTitle,
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: IncidentRoleSettingsCopy.nameFieldTitle,
            type: FieldType.Text,
            getElement: (item: IncidentRole): ReactElement => {
              return (
                <RoleLabel
                  name={item.name || ""}
                  color={item.color || undefined}
                  icon={item.roleIcon || undefined}
                  description={item.description || undefined}
                />
              );
            },
          },
          {
            field: {
              description: true,
            },
            noValueMessage: "-",
            title: IncidentRoleSettingsCopy.descriptionFieldTitle,
            type: FieldType.LongText,
          },
        ]}
      />
    </Fragment>
  );
};

export default IncidentRoles;
