import LabelsElement from "Common/UI/Components/Label/Labels";
import ProjectUtil from "Common/UI/Utils/Project";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Permission, { PermissionHelper } from "Common/Types/Permission";
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
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import ApiKeyPermission from "Common/Models/DatabaseModels/ApiKeyPermission";
import Label from "Common/Models/DatabaseModels/Label";
import Project from "Common/Models/DatabaseModels/Project";
import { getRoleCardSelectOptions } from "../Permission/RoleCardSelectOptions";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useState,
} from "react";

/*
 * An API key's permissions: what it may do, and - under the page's folded
 * Advanced section - what it may never do.
 *
 * What it may do is added the way a team's is (Components/Team/
 * TeamPermissionTable): Add Role picks a ready-made set of permissions from
 * cards, Add Permission picks one permission from the full list. A new key
 * created with Choose permissions later lands here with nothing, so the
 * empty table repeats Add Role as the way forward.
 *
 * Block permissions keep the one-permission form they always had.
 */

export enum ApiKeyPermissionType {
  AllowPermissions = "AllowPermissions",
  BlockPermissions = "BlockPermissions",
}

enum CreatePermissionType {
  RoleBased = "RoleBased",
  Granular = "Granular",
}

export interface ComponentProps {
  apiKeyId: ObjectID;
  permissionType: ApiKeyPermissionType;
  currentProject: Project | null;
  // How many rows the table holds after each load.
  onPermissionCountChange?: ((count: number) => void) | undefined;
}

const ApiKeyPermissionTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const { apiKeyId, permissionType, currentProject } = props;
  const isBlock: boolean =
    permissionType === ApiKeyPermissionType.BlockPermissions;

  const formRef: MutableRefObject<FormProps<FormValues<ApiKeyPermission>>> =
    React.useRef<FormProps<FormValues<ApiKeyPermission>>>() as MutableRefObject<
      FormProps<FormValues<ApiKeyPermission>>
    >;

  const [createPermissionType, setCreatePermissionType] =
    useState<CreatePermissionType>(CreatePermissionType.RoleBased);

  const [showCreateForm, setShowCreateForm] = useState<boolean>(false);

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
   * not change what a key can do - as ModelTable does its own Create.
   */
  const gate: (button: CardButtonSchema) => Array<CardButtonSchema> = (
    button: CardButtonSchema,
  ): Array<CardButtonSchema> => {
    const gated: CardButtonSchema | null = PermissionGate.gateCardButton(
      button,
      new ApiKeyPermission(),
      ModelAction.Create,
    );

    return gated ? [gated] : [];
  };

  const allowButtons: Array<CardButtonSchema> = [
    ...gate({
      title: "Add Role",
      // NORMAL with the Add icon: the empty table repeats it as its way on.
      icon: IconProp.Add,
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

  const granularFormFields: Array<ModelField<ApiKeyPermission>> = [
    {
      field: {
        permission: true,
      },
      onChange: async (_value: unknown) => {
        await formRef.current.setFieldValue("labels", [], true);
      },
      title: "Permission",
      fieldType: FormFieldSchemaType.CustomComponent,
      required: true,
      placeholder: "Search permissions...",
      getCustomElement: (
        _values: FormValues<ApiKeyPermission>,
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
              customElementProps.initialValue as Permission | undefined
            }
            placeholder={customElementProps.placeholder}
            error={customElementProps.error}
          />
        );
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
      showIf: (values: FormValues<ApiKeyPermission>): boolean => {
        if (!values["permission"]) {
          return false;
        }

        return PermissionHelper.isAccessControlPermission(
          values["permission"] as Permission,
        );
      },
      required: false,
      placeholder: "Labels",
    },
  ];

  /*
   * Add Role: the role cards. A row is edited with the one-permission form
   * whichever way it was added - its picker lists the roles too - so the
   * cards are for creating only, and the picker for editing only.
   */
  const roleFormFields: Array<ModelField<ApiKeyPermission>> = [
    {
      field: {
        permission: true,
      },
      title: "Role",
      description:
        "A role is a ready-made set of permissions. The key can do what the role allows in the whole project.",
      fieldType: FormFieldSchemaType.CardSelect,
      cardSelectOptions: getRoleCardSelectOptions(),
      // Some forty roles: a search box finds one by name or area.
      cardSelectSearchable: true,
      // CardSelect translates it; the key marks it for the extractor.
      cardSelectSearchPlaceholder: translationKey("Search roles"),
      required: true,
      placeholder: "Select a role",
      doNotShowWhenEditing: true,
    },
    ...granularFormFields.map(
      (field: ModelField<ApiKeyPermission>): ModelField<ApiKeyPermission> => {
        return {
          ...field,
          doNotShowWhenCreating: true,
        };
      },
    ),
  ];

  return (
    <ModelTable<ApiKeyPermission>
      modelType={ApiKeyPermission}
      id={
        isBlock ? "api-key-block-permission-table" : "api-key-permission-table"
      }
      userPreferencesKey={
        isBlock ? "api-key-block-permission-table" : "api-key-permission-table"
      }
      name={
        isBlock
          ? "Settings > API Key > Block Permissions"
          : "Settings > API Key > Permissions"
      }
      singularName={isBlock ? "Block Permission" : "Permission"}
      pluralName={isBlock ? "Block Permissions" : "Permissions"}
      createVerb="Add"
      isDeleteable={true}
      isEditable={true}
      /*
       * Allow permissions are added from the card's two buttons, a role or
       * one permission; a block is always one permission, from the table's
       * own Add button.
       */
      isCreateable={isBlock}
      showCreateForm={isBlock ? undefined : showCreateForm}
      isViewable={false}
      createEditModalWidth={ModalWidth.Large}
      createEditFromRef={formRef}
      query={{
        apiKeyId: apiKeyId,
        projectId: ProjectUtil.getCurrentProjectId()!,
        isBlockPermission: isBlock,
      }}
      onBeforeCreate={(item: ApiKeyPermission): Promise<ApiKeyPermission> => {
        if (!currentProject || !currentProject._id) {
          throw new BadDataException("Project ID cannot be null");
        }

        item.apiKeyId = apiKeyId;
        item.projectId = new ObjectID(currentProject._id);
        item.isBlockPermission = isBlock;
        return Promise.resolve(item);
      }}
      onFetchSuccess={(_data: Array<ApiKeyPermission>, totalCount: number) => {
        props.onPermissionCountChange?.(totalCount);
      }}
      cardProps={
        isBlock
          ? {
              title: "Block Permissions",
              description:
                "Here you can manage block permissions for this API Key. This will override any allow permissions set for this API Key.",
            }
          : {
              title: "Permissions",
              description:
                "What this API key can do. Add a role for a ready-made set of permissions, or a single permission for exactly what you need.",
              buttons: allowButtons,
            }
      }
      noItemsMessage={
        isBlock
          ? "Nothing is blocked for this API key."
          : "This key can do nothing yet. Add a role to give it access."
      }
      formFields={
        !isBlock && createPermissionType === CreatePermissionType.RoleBased
          ? roleFormFields
          : granularFormFields
      }
      showRefreshButton={true}
      viewPageRoute={Navigation.getCurrentRoute()}
      filters={[
        {
          field: {
            permission: true,
          },
          title: "Permission",
          type: FieldType.Text,
        },
        {
          field: {
            labels: {
              name: true,
            },
          },
          title: "Restrict to Labels",
          type: FieldType.EntityArray,
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

          getElement: (item: ApiKeyPermission): ReactElement => {
            return (
              <p>
                {translator.translateText(
                  PermissionHelper.getTitle(item["permission"] as Permission),
                )}
              </p>
            );
          },
        },
        {
          field: {
            labels: {
              name: true,
              color: true,
            },
          },
          title: "Restrict to Labels",
          type: FieldType.EntityArray,

          getElement: (item: ApiKeyPermission): ReactElement => {
            if (
              item &&
              item["permission"] &&
              !PermissionHelper.isAccessControlPermission(
                item["permission"] as Permission,
              )
            ) {
              return (
                <p>
                  {translator.translateText(
                    "Restriction by labels cannot be applied to this permission.",
                  )}
                </p>
              );
            }

            if (!item["labels"] || item["labels"].length === 0) {
              return (
                <p>
                  {translator.translateText(
                    "No restrictions has been applied to this permission.",
                  )}
                </p>
              );
            }

            return <LabelsElement labels={item["labels"] || []} />;
          },
        },
      ]}
    />
  );
};

export default ApiKeyPermissionTable;
