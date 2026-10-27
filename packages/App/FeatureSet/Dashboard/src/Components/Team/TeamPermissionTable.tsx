import ProjectUtil from "Common/UI/Utils/Project";
import IsNull from "Common/Types/BaseDatabase/IsNull";
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
import IconProp from "Common/Types/Icon/IconProp";
import { getTeamPermissionsEmptyMessage } from "../CustomRole/CustomRolesFold";
import { isBuiltInRolePermission } from "../Permission/RoleCardSelectOptions";
import { RoleReach } from "../Permission/RoleCatalog";
import { getRolePickerFormField } from "../Permission/RolePickerFormField";
import {
  getPermissionScopeFields,
  isScopeShownFor,
} from "../Permission/PermissionScopeChoice";
import PermissionScopeCell from "../Permission/PermissionScopeCell";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  ADD_PERMISSION_DIALOG_WORDS,
  AddPermissionDialogKind,
  AddPermissionDialogWords,
} from "../Permission/AddPermissionDialogWords";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useState,
} from "react";

/*
 * A team's permissions: what its members may do, and - under the
 * Permissions page's folded More settings - what they may never do.
 *
 * Both are added the same two ways: Add Role picks a ready-made set of
 * permissions - a role for the whole project, or for one area of it - from
 * the role picker an API key's and a custom role's Add Role show too
 * (Permission/RolePicker); Add Permission picks one permission from the
 * full list. A new team created with Choose permissions later lands here
 * with nothing, so the empty table repeats Add Role as the way forward.
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
  /*
   * How many custom roles the team has (folded under More settings): with
   * one, the empty allow card says the roles give the team its access
   * rather than that it can do nothing.
   */
  customRoleCount?: number | undefined;
}

const TeamPermissionTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const { teamId, permissionType, currentProject } = props;
  const isBlock: boolean = permissionType === PermissionType.BlockPermissions;

  const formRef: MutableRefObject<FormProps<FormValues<TeamPermission>>> =
    React.useRef<FormProps<FormValues<TeamPermission>>>() as MutableRefObject<
      FormProps<FormValues<TeamPermission>>
    >;

  const [createPermissionType, setCreatePermissionType] =
    useState<CreatePermissionType>(CreatePermissionType.RoleBased);

  const [showCreateForm, setShowCreateForm] = useState<boolean>(false);

  // What the Add dialog is called: what the button that opened it said.
  const createDialogWords: AddPermissionDialogWords =
    ADD_PERMISSION_DIALOG_WORDS[
      createPermissionType === CreatePermissionType.RoleBased
        ? AddPermissionDialogKind.Role
        : AddPermissionDialogKind.SinglePermission
    ];

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
      /*
       * Named after the button that opened it - "Add a Role" behind Add
       * Role - not after the table's model ("Create New Team Permission").
       */
      createFormTitle={createDialogWords.title}
      createFormSubmitButtonText={createDialogWords.submitButtonText}
      name={"Settings > Team > Permissions-" + permissionType}
      /*
       * The role picker reads best in a dialog of its own size; the full
       * list of permissions keeps the wide one.
       */
      createEditModalWidth={
        createPermissionType === CreatePermissionType.RoleBased
          ? ModalWidth.Medium
          : ModalWidth.Large
      }
      isViewable={false}
      createEditFromRef={formRef}
      onBeforeEdit={(item: TeamPermission): Promise<TeamPermission> => {
        /*
         * Edit opens the picker the row was added with, its pick shown: the
         * role cards for a built-in role, the full list for a single
         * permission - not whichever Add was opened last.
         */
        setCreatePermissionType(
          isBuiltInRolePermission(item.permission)
            ? CreatePermissionType.RoleBased
            : CreatePermissionType.Granular,
        );
        return Promise.resolve(item);
      }}
      query={{
        teamId: teamId,
        projectId: ProjectUtil.getCurrentProjectId()!,
        isBlockPermission: permissionType === PermissionType.BlockPermissions,
        /*
         * The team's own permissions only. What it has through a custom
         * role is the role's, listed by role under More settings
         * (TeamCustomRoleTable) and changed on the role's page.
         */
        teamCustomRoleId: new IsNull(),
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
          : getTeamPermissionsEmptyMessage(props.customRoleCount || 0)
      }
      formFields={
        createPermissionType === CreatePermissionType.RoleBased
          ? [
              /*
               * The role picker: the whole project, or one area of it. A
               * block is usually one area's role, so its picker opens there.
               */
              getRolePickerFormField<TeamPermission>({
                startOn: isBlock ? RoleReach.OneArea : RoleReach.WholeProject,
                // The Scope below shows for a role that takes one.
                isMoreFieldsShownFor: isScopeShownFor,
                onChange: async (value: unknown): Promise<void> => {
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
              }),
              /*
               * Scope: three plain answers, All first, and the labels the
               * third one asks for (PermissionScopeChoice).
               */
              ...getPermissionScopeFields<TeamPermission>({
                isScopeShown: (values: FormValues<TeamPermission>): boolean => {
                  return isScopeShownFor(values["permission"]);
                },
              }),
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
                description: "One permission, for exactly what the team needs.",
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
              /*
               * Only a permission labels can narrow takes a scope: the
               * others reach the whole project by definition.
               */
              ...getPermissionScopeFields<TeamPermission>({
                isScopeShown: (values: FormValues<TeamPermission>): boolean => {
                  return (
                    Boolean(values["permission"]) &&
                    PermissionHelper.isAccessControlPermission(
                      values["permission"] as Permission,
                    ) &&
                    PermissionHelper.isScopeApplicable(
                      values["permission"] as Permission,
                    )
                  );
                },
              }),
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
                {translator.translateText(
                  PermissionHelper.getTitle(item["permission"] as Permission),
                ) ||
                  PermissionHelper.getTitle(item["permission"] as Permission)}
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
            // In the Scope choice's words, with the labels that narrow it.
            return (
              <PermissionScopeCell
                scope={item["scope"]}
                labels={(item["labels"] || []) as Array<Label>}
              />
            );
          },
        },
      ]}
    />
  );
};

export default TeamPermissionTable;
