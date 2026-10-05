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
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
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
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useState,
} from "react";

/*
 * A team's permissions: what its members may do, and - under the
 * Permissions page's folded Advanced section - what they may never do.
 *
 * Both are added the same two ways: Add Role picks a ready-made set of
 * permissions from cards (RoleCardSelectOptions, the list an API key's Add
 * Role shows), Add Permission picks one permission from the full list. A new
 * team created with Choose permissions later lands here with nothing, so the
 * empty table repeats Add Role as the way forward.
 */

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
  // How many rows the table holds after each load.
  onPermissionCountChange?: ((count: number) => void) | undefined;
}

const TeamPermissionTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { teamId, permissionType, currentProject } = props;
  const isBlock: boolean = permissionType === PermissionType.BlockPermissions;

  const formRef: MutableRefObject<FormProps<FormValues<TeamPermission>>> =
    React.useRef<FormProps<FormValues<TeamPermission>>>() as MutableRefObject<
      FormProps<FormValues<TeamPermission>>
    >;

  const [createPermissionType, setCreatePermissionType] =
    useState<CreatePermissionType>(CreatePermissionType.RoleBased);

  const [showCreateForm, setShowCreateForm] = useState<boolean>(false);

  // The same role cards an API key's Add Role offers (RoleCardSelectOptions).
  const roleCardSelectOptions: Array<CardSelectOption | CardSelectOptionGroup> =
    getRoleCardSelectOptions();

  type OpenCreateFormFunction = (type: CreatePermissionType) => void;

  // Flipped off and on, so the same button opens the form a second time.
  const openCreateForm: OpenCreateFormFunction = (
    type: CreatePermissionType,
  ): void => {
    setCreatePermissionType(type);
    setShowCreateForm(false);
    setTimeout(() => {
      setShowCreateForm(true);
    }, 0);
  };

  /*
   * Locked, with the missing permission as the tooltip, for someone who may
   * not change what a team can do - as ModelTable does its own Create.
   */
  const gate: (button: CardButtonSchema) => Array<CardButtonSchema> = (
    button: CardButtonSchema,
  ): Array<CardButtonSchema> => {
    const gated: CardButtonSchema | null = PermissionGate.gateCardButton(
      button,
      new TeamPermission(),
      ModelAction.Create,
    );

    return gated ? [gated] : [];
  };

  const createButtons: Array<CardButtonSchema> = [
    ...gate({
      title: "Add Role",
      /*
       * What the team can do: NORMAL with the Add icon, so the empty table
       * repeats it as its way on. A block is rarer and keeps its own icon.
       */
      icon: isBlock ? IconProp.User : IconProp.Add,
      buttonStyle: ButtonStyleType.NORMAL,
      onClick: () => {
        openCreateForm(CreatePermissionType.RoleBased);
      },
    }),
    ...gate({
      title: "Add Permission",
      icon: IconProp.Lock,
      buttonStyle: ButtonStyleType.OUTLINE,
      onClick: () => {
        openCreateForm(CreatePermissionType.Granular);
      },
    }),
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
        item.isBlockPermission = isBlock;
        return Promise.resolve(item);
      }}
      onFetchSuccess={(_data: Array<TeamPermission>, totalCount: number) => {
        props.onPermissionCountChange?.(totalCount);
      }}
      cardProps={
        isBlock
          ? {
              title: "Block Permissions",
              description:
                "Blocks win over this team's roles and permissions. A block with labels applies only to resources that carry one of them.",
              buttons: createButtons,
            }
          : {
              title: "Permissions",
              description:
                "What this team's members can do. Add a role for a ready-made set of permissions, or a single permission for exactly what you need.",
              buttons: createButtons,
            }
      }
      noItemsMessage={
        isBlock
          ? "Nothing is blocked for this team."
          : "This team can do nothing yet. Add a role to give it access."
      }
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
