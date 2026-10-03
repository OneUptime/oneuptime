import LabelsElement from "Common/UI/Components/Label/Labels";
import ProjectUtil from "Common/UI/Utils/Project";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import PermissionScope from "Common/Types/Database/AccessControl/PermissionScope";
import { FormProps } from "Common/UI/Components/Forms/BasicForm";
import PermissionPicker from "Common/UI/Components/Forms/Fields/PermissionPicker";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import Label from "Common/Models/DatabaseModels/Label";
import TeamPermission from "Common/Models/DatabaseModels/TeamPermission";
import Project from "Common/Models/DatabaseModels/Project";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import {
  CardSelectOption,
  CardSelectOptionGroup,
} from "Common/UI/Components/CardSelect/CardSelect";
import IconProp from "Common/Types/Icon/IconProp";
import { getRoleCardSelectOptions } from "../Permission/RoleCardSelectOptions";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useState,
} from "react";

export enum PermissionType {
  AllowPermissions = "AllowPermissions",
  BlockPermissions = "BlockPermissions",
}

enum CreatePermissionType {
  RoleBased = "RoleBased",
  Granular = "Granular",
}

export interface ComponentProps {
  teamId: ObjectID;
  permissionType: PermissionType;
  currentProject: Project | null;
}

const TeamPermissionTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { teamId, permissionType, currentProject } = props;

  const formRef: MutableRefObject<FormProps<FormValues<TeamPermission>>> =
    React.useRef<FormProps<FormValues<TeamPermission>>>() as MutableRefObject<
      FormProps<FormValues<TeamPermission>>
    >;

  const [createPermissionType, setCreatePermissionType] =
    useState<CreatePermissionType>(CreatePermissionType.RoleBased);

  const [showCreateForm, setShowCreateForm] = useState<boolean>(false);

  let tableTitle: string = "Allow Permissions";

  if (permissionType === PermissionType.BlockPermissions) {
    tableTitle = "Block Permissions";
  }

  let tableDescription: string =
    "Here you can manage allow permissions for this team.";

  if (permissionType === PermissionType.BlockPermissions) {
    tableDescription =
      "Here you can manage block permissions for this team. This will override any allow permissions set for this team.";
  }

  // The same role cards an API key's Add Role offers (RoleCardSelectOptions).
  const roleCardSelectOptions: Array<CardSelectOption | CardSelectOptionGroup> =
    getRoleCardSelectOptions();

  const createButtons: Array<CardButtonSchema> = [
    {
      title: "Add Role",
      icon: IconProp.User,
      buttonStyle: ButtonStyleType.NORMAL,
      onClick: () => {
        setCreatePermissionType(CreatePermissionType.RoleBased);
        setShowCreateForm(false);
        setTimeout(() => {
          setShowCreateForm(true);
        }, 0);
      },
    },
    {
      title: "Add Permission",
      icon: IconProp.Lock,
      buttonStyle: ButtonStyleType.OUTLINE,
      onClick: () => {
        setCreatePermissionType(CreatePermissionType.Granular);
        setShowCreateForm(false);
        setTimeout(() => {
          setShowCreateForm(true);
        }, 0);
      },
    },
  ];

  return (
    <ModelTable<TeamPermission>
      modelType={TeamPermission}
      userPreferencesKey={"team-permission-table-" + permissionType}
      id={"table-team-permission-" + permissionType}
      isDeleteable={true}
      isEditable={true}
      isCreateable={false}
      showCreateForm={showCreateForm}
      name={"Settings > Team > Permissions-" + permissionType}
      createEditModalWidth={ModalWidth.Large}
      isViewable={false}
      createEditFromRef={formRef}
      query={{
        teamId: teamId,
        projectId: ProjectUtil.getCurrentProjectId()!,
        isBlockPermission: permissionType === PermissionType.BlockPermissions,
      }}
      selectMoreFields={{
        labels: {
          _id: true,
          name: true,
          color: true,
        },
      }}
      onBeforeCreate={(item: TeamPermission): Promise<TeamPermission> => {
        if (!currentProject || !currentProject._id) {
          throw new BadDataException("Project ID cannot be null");
        }
        item.teamId = teamId;
        item.projectId = new ObjectID(currentProject._id);
        item.isBlockPermission =
          permissionType === PermissionType.BlockPermissions;
        return Promise.resolve(item);
      }}
      cardProps={{
        title: tableTitle,
        description: tableDescription,
        buttons: createButtons,
      }}
      noItemsMessage={"No permissions created for this team so far."}
      formFields={
        createPermissionType === CreatePermissionType.RoleBased
          ? [
              {
                field: {
                  permission: true,
                },
                onChange: async (value: any): Promise<void> => {
                  await formRef.current.setFieldValue("labels", [], true);
                  if (
                    value &&
                    !PermissionHelper.isScopeApplicable(value as Permission)
                  ) {
                    await formRef.current.setFieldValue(
                      "scope",
                      PermissionScope.All,
                      true,
                    );
                  }
                },
                title: "Role",
                description:
                  "Select a role to assign to this team. Roles provide a predefined set of permissions.",
                fieldType: FormFieldSchemaType.CardSelect,
                cardSelectOptions: roleCardSelectOptions,
                // Some forty roles: a search box finds one by name or area.
                cardSelectSearchable: true,
                cardSelectSearchPlaceholder: translationKey("Search roles"),
                required: true,
                placeholder: "Select a role",
              },
              {
                field: {
                  scope: true,
                },
                title: "Scope",
                description:
                  "Which resources this role applies to. All (recommended): every resource in the project. Owned: resources where this team or its members are listed as owners. Labels: restrict by labels (advanced).",
                fieldType: FormFieldSchemaType.Dropdown,
                dropdownOptions: [
                  {
                    value: PermissionScope.All,
                    label: "All resources in the project",
                  },
                  {
                    value: PermissionScope.Owned,
                    label: "Owned by this team or its members",
                  },
                  {
                    value: PermissionScope.Labels,
                    label: "Restrict by labels (advanced)",
                  },
                ],
                defaultValue: PermissionScope.All,
                required: true,
                showIf: (values: FormValues<TeamPermission>): boolean => {
                  if (!values["permission"]) {
                    return false;
                  }
                  return PermissionHelper.isScopeApplicable(
                    values["permission"] as Permission,
                  );
                },
              },
              {
                field: {
                  labels: true,
                },
                title: "Restrict to Labels",
                description:
                  "If you want to restrict this role to specific labels, you can select them here. Advanced.",
                fieldType: FormFieldSchemaType.MultiSelectDropdown,
                dropdownModal: {
                  type: Label,
                  labelField: "name",
                  valueField: "_id",
                },
                showIf: (values: FormValues<TeamPermission>): boolean => {
                  if (!values["permission"]) {
                    return false;
                  }
                  const scope: PermissionScope | undefined = values["scope"] as
                    | PermissionScope
                    | undefined;
                  return scope === PermissionScope.Labels;
                },
                required: false,
                placeholder: "Labels",
              },
            ]
          : [
              {
                field: {
                  permission: true,
                },
                onChange: async (value: any): Promise<void> => {
                  await formRef.current.setFieldValue("labels", [], true);
                  if (
                    value &&
                    !PermissionHelper.isScopeApplicable(value as Permission)
                  ) {
                    await formRef.current.setFieldValue(
                      "scope",
                      PermissionScope.All,
                      true,
                    );
                  }
                },
                title: "Permission",
                fieldType: FormFieldSchemaType.CustomComponent,
                required: true,
                placeholder: "Search permissions...",
                getCustomElement: (
                  _values: FormValues<TeamPermission>,
                  customElementProps: CustomElementProps,
                ) => {
                  return (
                    <PermissionPicker
                      onChange={(value: Permission | null) => {
                        customElementProps.onChange?.(value);
                      }}
                      onBlur={customElementProps.onBlur}
                      tabIndex={customElementProps.tabIndex}
                      initialValue={
                        customElementProps.initialValue as
                          | Permission
                          | undefined
                      }
                      placeholder={customElementProps.placeholder}
                      error={customElementProps.error}
                    />
                  );
                },
              },
              {
                field: {
                  scope: true,
                },
                title: "Scope",
                description:
                  "Which resources this permission applies to. All (recommended): every resource in the project. Owned: resources where this team or its members are listed as owners. Labels: restrict by labels (advanced).",
                fieldType: FormFieldSchemaType.Dropdown,
                dropdownOptions: [
                  {
                    value: PermissionScope.All,
                    label: "All resources in the project",
                  },
                  {
                    value: PermissionScope.Owned,
                    label: "Owned by this team or its members",
                  },
                  {
                    value: PermissionScope.Labels,
                    label: "Restrict by labels (advanced)",
                  },
                ],
                defaultValue: PermissionScope.All,
                required: true,
                showIf: (values: FormValues<TeamPermission>): boolean => {
                  if (!values["permission"]) {
                    return false;
                  }
                  if (
                    !PermissionHelper.isAccessControlPermission(
                      values["permission"] as Permission,
                    )
                  ) {
                    return false;
                  }
                  if (
                    !PermissionHelper.isScopeApplicable(
                      values["permission"] as Permission,
                    )
                  ) {
                    return false;
                  }
                  return true;
                },
              },
              {
                field: {
                  labels: true,
                },
                title: "Restrict to Labels",
                description:
                  "If you want to restrict this permission to specific labels, you can select them here. This is an optional and an advanced feature.",
                fieldType: FormFieldSchemaType.MultiSelectDropdown,
                dropdownModal: {
                  type: Label,
                  labelField: "name",
                  valueField: "_id",
                },
                showIf: (values: FormValues<TeamPermission>): boolean => {
                  if (!values["permission"]) {
                    return false;
                  }

                  if (
                    values["permission"] &&
                    !PermissionHelper.isAccessControlPermission(
                      values["permission"] as Permission,
                    )
                  ) {
                    return false;
                  }

                  const scope: PermissionScope | undefined = values["scope"] as
                    | PermissionScope
                    | undefined;
                  if (scope && scope !== PermissionScope.Labels) {
                    return false;
                  }

                  return true;
                },
                required: false,
                placeholder: "Labels",
              },
            ]
      }
      showRefreshButton={true}
      viewPageRoute={Navigation.getCurrentRoute()}
      filters={[
        {
          field: {
            permission: true,
          },
          type: FieldType.Text,
          title: "Permission",
        },
        {
          field: {
            labels: {
              name: true,
            },
          },
          type: FieldType.EntityArray,
          title: "Labels",
          filterEntityType: Label,
          filterQuery: {
            projectId: ProjectUtil.getCurrentProjectId()!,
          },
          filterDropdownField: {
            label: "name",
            value: "_id",
          },
        },
      ]}
      columns={[
        {
          field: {
            permission: true,
          },
          title: "Permission",
          type: FieldType.Text,

          getElement: (item: TeamPermission): ReactElement => {
            return (
              <p>
                {PermissionHelper.getTitle(item["permission"] as Permission)}
              </p>
            );
          },
        },
        {
          field: {
            scope: true,
          },
          title: "Scope",
          type: FieldType.Text,
          getElement: (item: TeamPermission): ReactElement => {
            const scope: PermissionScope =
              (item["scope"] as PermissionScope) || PermissionScope.Labels;

            if (scope === PermissionScope.Owned) {
              return <p>Owned by team or members</p>;
            }

            if (scope === PermissionScope.All) {
              return <p>All resources in project</p>;
            }

            const labels: Array<Label> = (item["labels"] || []) as Array<Label>;
            if (labels.length === 0) {
              return (
                <p>
                  All resources{" "}
                  <span className="text-gray-400">(no labels selected)</span>
                </p>
              );
            }

            return (
              <div className="flex flex-col gap-1">
                <p className="text-gray-500">Restricted to labels:</p>
                <LabelsElement labels={labels} />
              </div>
            );
          },
        },
      ]}
    />
  );
};

export default TeamPermissionTable;
