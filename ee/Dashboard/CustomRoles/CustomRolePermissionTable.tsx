import { RoleReach } from "@oneuptime/dashboard/Components/Permission/RoleCatalog";
import { getRolePickerFormField } from "@oneuptime/dashboard/Components/Permission/RolePickerFormField";
import {
  getPermissionScopeFields,
  isScopeShownFor,
} from "@oneuptime/dashboard/Components/Permission/PermissionScopeChoice";
import PermissionScopeCell from "@oneuptime/dashboard/Components/Permission/PermissionScopeCell";
import {
  CUSTOM_ROLE_PERMISSION_DIALOG_WORDS,
  CustomRolePermissionDialogWords,
  CustomRolePermissionPickerType,
  getCustomRolePermissionPickerType,
  SINGLE_PERMISSION_FIELD_DESCRIPTION,
} from "./CustomRolePermissionPicker";
import CustomRolePermission from "Common/Models/DatabaseModels/CustomRolePermission";
import Label from "Common/Models/DatabaseModels/Label";
import PermissionScope from "Common/Types/Database/AccessControl/PermissionScope";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import {
  getPermissionTitleForSentence,
  PERMISSIONS_NEVER_IN_A_CUSTOM_ROLE,
} from "Common/Types/Team/CustomRole";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import { FormProps } from "Common/UI/Components/Forms/BasicForm";
import PermissionPicker from "Common/UI/Components/Forms/Fields/PermissionPicker";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { CustomElementProps } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useState,
} from "react";

/*
 * THE PERMISSIONS IN A CUSTOM ROLE, on the role's page.
 *
 * Added the way a team's own are (Components/Team/TeamPermissionTable): Add
 * Role picks a built-in role from the same role picker (Permission/
 * RolePicker) - opening on One area, as a custom role is most often a few
 * areas' roles - and Add Permission one permission from the full list, each
 * with a scope folded under More fields - every resource in the
 * project, the resources the person acting (or one of their teams) owns, or
 * the resources carrying some labels, the three plain answers of
 * Components/Permission/PermissionScopeChoice. What a custom role cannot hold is not
 * offered: Project Owner (the Owners team gives it), block permissions (they
 * stay on the team), and the scope Labels without a label.
 *
 * Every change here reaches every team with the role at once, which the
 * card's description says (the role's page hands it in), with how many
 * teams and people that is.
 *
 * Each dialog is named for the button that opened it - "Add a Role to
 * Incident Responder" behind Add Role, "Add a Permission to Incident
 * Responder" behind Add Permission - and Edit opens the picker the row was
 * made with: the role picker for a built-in role, the full list for a
 * single permission, its current pick shown either way.
 */

export interface ComponentProps {
  customRoleId: ObjectID;
  // The role's name, for the Add dialogs' titles; empty until it is read.
  roleName?: string | undefined;
  // What a change reaches, said under the card's title.
  description: string;
  // After every load: how many permissions the role holds.
  onPermissionCountChange?: ((count: number) => void) | undefined;
  /*
   * The Enterprise license has lapsed or leaves custom roles out: nothing
   * can be added or changed, and permissions can still be removed.
   */
  isReadOnly?: boolean | undefined;
}

const CustomRolePermissionTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const formRef: MutableRefObject<FormProps<FormValues<CustomRolePermission>>> =
    React.useRef<
      FormProps<FormValues<CustomRolePermission>>
    >() as MutableRefObject<FormProps<FormValues<CustomRolePermission>>>;

  const [pickerType, setPickerType] = useState<CustomRolePermissionPickerType>(
    CustomRolePermissionPickerType.Role,
  );

  const [showCreateForm, setShowCreateForm] = useState<boolean>(false);

  type OpenCreateFormFunction = (type: CustomRolePermissionPickerType) => void;

  // Flipped off and on, so the same button opens the form a second time.
  const openCreateForm: OpenCreateFormFunction = (
    type: CustomRolePermissionPickerType,
  ): void => {
    setPickerType(type);
    setShowCreateForm(false);
    setTimeout(() => {
      setShowCreateForm(true);
    }, 0);
  };

  // Locked, with the missing permission as the tooltip, as ModelTable locks its own Create.
  const gate: (button: CardButtonSchema) => Array<CardButtonSchema> = (
    button: CardButtonSchema,
  ): Array<CardButtonSchema> => {
    const gated: CardButtonSchema | null = PermissionGate.gateCardButton(
      button,
      new CustomRolePermission(),
      ModelAction.Create,
    );

    return gated ? [gated] : [];
  };

  const createButtons: Array<CardButtonSchema> = [
    ...gate({
      title: "Add Role",
      // NORMAL with the Add icon, so the empty table repeats it as its way on.
      icon: IconProp.Add,
      buttonStyle: ButtonStyleType.NORMAL,
      onClick: () => {
        openCreateForm(CustomRolePermissionPickerType.Role);
      },
    }),
    ...gate({
      title: "Add Permission",
      icon: IconProp.Lock,
      buttonStyle: ButtonStyleType.OUTLINE,
      onClick: () => {
        openCreateForm(CustomRolePermissionPickerType.SinglePermission);
      },
    }),
  ];

  /*
   * The Add dialog says what it adds, and to which role: the table's own
   * title would read "Add New Permission" behind Add Role too.
   */
  const isRoleBased: boolean =
    pickerType === CustomRolePermissionPickerType.Role;

  const dialogWords: CustomRolePermissionDialogWords =
    CUSTOM_ROLE_PERMISSION_DIALOG_WORDS[pickerType];

  const roleName: string = (props.roleName || "").trim();

  const createFormTitle: string = roleName
    ? translator.translateTemplate(dialogWords.titleWithRole, {
        role: roleName,
      })
    : translator.translateText(dialogWords.title) || dialogWords.title;

  // What a change of permission does to the scope and labels already picked.
  const onPermissionPicked: (value: unknown) => Promise<void> = async (
    value: unknown,
  ): Promise<void> => {
    await formRef.current.setFieldValue("labels", [], true);
    if (value && !PermissionHelper.isScopeApplicable(value as Permission)) {
      await formRef.current.setFieldValue("scope", PermissionScope.All, true);
    }
  };

  const isScopeShown: (values: FormValues<CustomRolePermission>) => boolean = (
    values: FormValues<CustomRolePermission>,
  ): boolean => {
    return isScopeShownFor(values["permission"]);
  };

  /*
   * Scope: the three plain answers a team's permission offers, All first,
   * and the labels the third one asks for (PermissionScopeChoice).
   */
  const scopeAndLabelsFields: Array<ModelField<CustomRolePermission>> =
    getPermissionScopeFields<CustomRolePermission>({
      isScopeShown: isScopeShown,
    });

  return (
    <ModelTable<CustomRolePermission>
      modelType={CustomRolePermission}
      userPreferencesKey="custom-role-permission-table"
      id="table-custom-role-permission"
      isDeleteable={true}
      isEditable={!props.isReadOnly}
      isCreateable={false}
      showCreateForm={showCreateForm}
      createVerb="Add"
      singularName="Permission"
      pluralName="Permissions"
      createFormTitle={createFormTitle}
      createFormSubmitButtonText={dialogWords.submitButtonText}
      name="Teams > Role > Permissions"
      /*
       * The role picker reads best in a dialog of its own size; the full
       * list of permissions keeps the wide one.
       */
      createEditModalWidth={isRoleBased ? ModalWidth.Medium : ModalWidth.Large}
      isViewable={false}
      createEditFromRef={formRef}
      onBeforeEdit={(
        item: CustomRolePermission,
      ): Promise<CustomRolePermission> => {
        // Edit opens the picker the row was added with, its pick shown.
        setPickerType(getCustomRolePermissionPickerType(item.permission));
        return Promise.resolve(item);
      }}
      query={{
        customRoleId: props.customRoleId,
        projectId: ProjectUtil.getCurrentProjectId()!,
      }}
      selectMoreFields={{
        labels: {
          _id: true,
          name: true,
          color: true,
        },
      }}
      onBeforeCreate={(
        item: CustomRolePermission,
      ): Promise<CustomRolePermission> => {
        const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

        if (!projectId) {
          throw new BadDataException("Project ID cannot be null");
        }

        item.customRoleId = props.customRoleId;
        item.projectId = projectId;
        return Promise.resolve(item);
      }}
      onFetchSuccess={(
        _data: Array<CustomRolePermission>,
        totalCount: number,
      ) => {
        props.onPermissionCountChange?.(totalCount);
      }}
      cardProps={{
        title: "Permissions",
        description: props.description,
        buttons: props.isReadOnly ? [] : createButtons,
      }}
      noItemsMessage="This role gives nothing yet. Add a role or a single permission to it."
      formFields={
        isRoleBased
          ? [
              /*
               * The role picker a team's Add Role shows, without Project
               * Owner, opening on One area.
               */
              getRolePickerFormField<CustomRolePermission>({
                excludeRoles: PERMISSIONS_NEVER_IN_A_CUSTOM_ROLE,
                startOn: RoleReach.OneArea,
                onChange: onPermissionPicked,
                // The Scope below shows for a role that takes one.
                isMoreFieldsShownFor: isScopeShownFor,
              }),
              ...scopeAndLabelsFields,
            ]
          : [
              {
                field: {
                  permission: true,
                },
                onChange: onPermissionPicked,
                title: "Permission",
                description: SINGLE_PERMISSION_FIELD_DESCRIPTION,
                fieldType: FormFieldSchemaType.CustomComponent,
                required: true,
                placeholder: "Search permissions...",
                getCustomElement: (
                  _values: FormValues<CustomRolePermission>,
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
                      excludePermissions={PERMISSIONS_NEVER_IN_A_CUSTOM_ROLE}
                    />
                  );
                },
              },
              ...scopeAndLabelsFields,
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
      ]}
      columns={[
        {
          field: {
            permission: true,
          },
          title: "Permission",
          type: FieldType.Text,
          getElement: (item: CustomRolePermission): ReactElement => {
            // A permission's title; the stored name, should it name none.
            return (
              <p>
                {translator.translateText(
                  getPermissionTitleForSentence(
                    (item["permission"] as Permission) || "",
                  ),
                )}
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
          getElement: (item: CustomRolePermission): ReactElement => {
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

export default CustomRolePermissionTable;
