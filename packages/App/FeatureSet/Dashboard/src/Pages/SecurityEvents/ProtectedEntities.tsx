import PageComponentProps from "../PageComponentProps";
import SecurityProtectedEntity from "Common/Models/DatabaseModels/SecurityProtectedEntity";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IconProp from "Common/Types/Icon/IconProp";
import {
  SecurityEntityType,
  getSecurityEntityIcon,
} from "Common/Types/SecurityCase/SecurityEntity";
import { PROTECTED_ENTITY_TYPES } from "Common/Types/SecurityPlaybook/SecurityProtectedEntity";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Icon from "Common/UI/Components/Icon/Icon";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

function entityTypeOptions(): Array<DropdownOption> {
  return PROTECTED_ENTITY_TYPES.map(
    (type: SecurityEntityType): DropdownOption => {
      return { label: type, value: type };
    },
  );
}

/*
 * The users and hosts playbooks never contain: a break-glass account, a
 * domain controller, the VPN gateway that every attack on the network names.
 * A containment step reports a protected target as protected and leaves it
 * alone, and an approver cannot pick it. One list per project, kept by
 * whoever sets up playbooks.
 */
const SecurityProtectedEntitiesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <ModelTable<SecurityProtectedEntity>
      modelType={SecurityProtectedEntity}
      id="security-protected-entities-table"
      name="Security Events > Protected Entities"
      userPreferencesKey="security-protected-entities-table"
      query={{ projectId: ProjectUtil.getCurrentProjectId()! }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      isViewable={false}
      sortBy="value"
      sortOrder={SortOrder.Ascending}
      cardProps={{
        title: "Protected Entities",
        description:
          "Users and hosts that playbooks never contain, such as break-glass accounts, domain controllers and VPN gateways. A containment step reports them as protected, and an approver cannot pick them.",
      }}
      noItemsMessage="Nothing is protected yet. Add the accounts and hosts a playbook must never cut off."
      createInitialValues={{
        entityType: SecurityEntityType.User,
      }}
      formFields={[
        {
          field: { entityType: true },
          title: "Type",
          fieldType: FormFieldSchemaType.Dropdown,
          dropdownOptions: entityTypeOptions(),
          required: true,
        },
        {
          field: { value: true },
          title: "Value",
          description:
            "The user's sign-in name or the host's name, whatever the case. Use * for any run of characters: svc-* protects every service account.",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "e.g. breakglass@example.com",
          disableSpellCheck: true,
        },
        {
          field: { description: true },
          title: "Description",
          // The field says (Optional) itself.
          description: "Why it is protected.",
          fieldType: FormFieldSchemaType.LongText,
          required: false,
        },
      ]}
      showRefreshButton={true}
      searchableFields={["value", "description"]}
      filters={[
        { field: { value: true }, title: "Value", type: FieldType.Text },
        {
          field: { entityType: true },
          title: "Type",
          type: FieldType.Dropdown,
          filterDropdownOptions: entityTypeOptions(),
        },
      ]}
      columns={[
        {
          field: { value: true },
          title: "Protected",
          type: FieldType.Element,
          wrapContent: true,
          getElement: (item: SecurityProtectedEntity): ReactElement => {
            return (
              <div className="flex items-center gap-2">
                <Icon
                  icon={
                    item.entityType
                      ? getSecurityEntityIcon(item.entityType)
                      : IconProp.Lock
                  }
                  className="h-4 w-4 flex-shrink-0 text-gray-400"
                />
                <span className="break-all font-mono text-sm text-gray-900">
                  {item.value || ""}
                </span>
              </div>
            );
          },
        },
        {
          field: { entityType: true },
          title: "Type",
          type: FieldType.Element,
          getElement: (item: SecurityProtectedEntity): ReactElement => {
            return (
              <span className="text-sm text-gray-700">
                {translator.translateText(item.entityType || "") ||
                  item.entityType}
              </span>
            );
          },
        },
        {
          field: { description: true },
          title: "Description",
          type: FieldType.LongText,
          noValueMessage: "-",
          hideOnMobile: true,
        },
      ]}
    />
  );
};

export default SecurityProtectedEntitiesPage;
