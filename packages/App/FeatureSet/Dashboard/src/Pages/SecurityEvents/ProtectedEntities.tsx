import PageComponentProps from "../PageComponentProps";
import AutomaticProtectionsCard from "../../Components/SecurityEvents/ProtectedEntities/AutomaticProtectionsCard";
import SecurityProtectedEntity from "Common/Models/DatabaseModels/SecurityProtectedEntity";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IconProp from "Common/Types/Icon/IconProp";
import {
  SecurityEntityType,
  getSecurityEntityIcon,
} from "Common/Types/SecurityCase/SecurityEntity";
import {
  PROTECTED_DOMAIN_PROBLEM,
  PROTECTED_ENTITY_TYPES,
  PROTECTED_FILE_HASH_PROBLEM,
  normalizeProtectedAddressValue,
  normalizeProtectedDomainValue,
  normalizeProtectedFileHashValue,
} from "Common/Types/SecurityPlaybook/SecurityProtectedEntity";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import Icon from "Common/UI/Components/Icon/Icon";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import ProjectUtil from "Common/UI/Utils/Project";
import { SECURITY_BLOCK_SENTENCES } from "Common/Types/SecurityBlocklist/SecurityBlock";
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

// What an address entry says when its value is no address or range: the blocklist's own words.
export const PROTECTED_ADDRESS_PROBLEM: string =
  SECURITY_BLOCK_SENTENCES.notAnAddress;

/*
 * What is wrong with an entry's value for its type, in English (the key
 * the form looks up), or null: an address or range, a domain (or `*.` and
 * one) or a file's hash must be one (#10346). A user's or a host's name is
 * any text.
 */
export function getProtectedValueProblem(data: {
  entityType: unknown;
  value: unknown;
}): string | null {
  switch (data.entityType) {
    case SecurityEntityType.IpAddress:
      return normalizeProtectedAddressValue(data.value)
        ? null
        : PROTECTED_ADDRESS_PROBLEM;
    case SecurityEntityType.Domain:
      return normalizeProtectedDomainValue(data.value)
        ? null
        : PROTECTED_DOMAIN_PROBLEM;
    case SecurityEntityType.FileHash:
      return normalizeProtectedFileHashValue(data.value)
        ? null
        : PROTECTED_FILE_HASH_PROBLEM;
    default:
      return null;
  }
}

/*
 * The users, hosts, addresses, domains and files playbooks never contain
 * and the blocklist never blocks: a break-glass account, a domain
 * controller, the VPN gateway that every attack on the network names, the
 * office's address, the company's own domains, the installers it ships. A
 * containment step reports a protected target as protected and leaves it
 * alone, an approver cannot pick it, and a block of a protected value is
 * refused. One list per project, kept by whoever sets up playbooks - and,
 * under it, what OneUptime protects by itself: the project's own addresses
 * (#10338), and its own domains (#10346).
 */
const SecurityProtectedEntitiesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div className="space-y-6">
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
            "Users, hosts, addresses, domains and files that playbooks never contain and the blocklist never blocks, such as break-glass accounts, your domains and your builds.",
        }}
        noItemsMessage="Nothing is protected yet. Add the accounts, hosts, addresses, domains and files a playbook or a block must never cut off."
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
              "A sign-in or host name (* for any characters), an IP address or range, a domain (*.example.com for all under it) or a file hash.",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "e.g. breakglass@example.com",
            disableSpellCheck: true,
            customValidation: (
              values: FormValues<SecurityProtectedEntity>,
            ): string | null => {
              const record: Record<string, unknown> = values as Record<
                string,
                unknown
              >;
              const problem: string | null = getProtectedValueProblem({
                entityType: record["entityType"],
                value: record["value"],
              });

              return problem
                ? translator.translateText(problem) || problem
                : null;
            },
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
            hideOnMobile: true,
          },
        ]}
      />

      <AutomaticProtectionsCard />
    </div>
  );
};

export default SecurityProtectedEntitiesPage;
