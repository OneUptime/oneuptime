import EnabledPill from "Common/UI/Components/Pill/EnabledPill";
import { getOwnerRuleHelpMarkdown } from "../../../Utils/Help/ResourceRuleHelp";
import RuleSettingsPageProps from "../../RuleSettingsPageProps";
import PageMap from "../../../Utils/PageMap";
import RuleViewPageUtil from "../../../Utils/RuleViewPage";
import {
  getOwnerRuleActionFields,
  getOwnerRuleFormSteps,
} from "../../../Utils/Form/ResourceRuleForm";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import RuleTable from "Common/UI/Components/RuleRun/RuleTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import FieldType from "Common/UI/Components/Types/FieldType";
import ServiceOwnerRule from "Common/Models/DatabaseModels/ServiceOwnerRule";
import React, { FunctionComponent, ReactElement } from "react";
import Label from "Common/Models/DatabaseModels/Label";

const serviceOwnerDocumentation: string = getOwnerRuleHelpMarkdown({
  nouns: { singular: "service", plural: "services" },
});

const ServiceOwnerRulesPage: FunctionComponent<RuleSettingsPageProps> = (
  props: RuleSettingsPageProps,
): ReactElement => {
  return (
    <RuleTable<ServiceOwnerRule>
      modelType={ServiceOwnerRule}
      viewRuleId={RuleViewPageUtil.getViewRuleId(props, ServiceOwnerRule)}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.SERVICE_SETTINGS_OWNER_RULES,
      )}
      getRuleViewRoute={(rule: ServiceOwnerRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.SERVICE_SETTINGS_OWNER_RULE_VIEW,
          rule,
        );
      }}
      id="service-owner-rules-table"
      name="Settings > Service Owner Rules"
      userPreferencesKey="service-owner-rules-table"
      saveFilterProps={{
        tableId: "service-owner-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Service Owner Rules",
        description:
          "Auto-assign owner users and teams when matching services are created.",
      }}
      helpContent={{
        title: "How Service Owner Rules Work",
        description: "Match services and add owner users/teams automatically.",
        markdown: serviceOwnerDocumentation,
      }}
      sortBy="name"
      sortOrder={SortOrder.Ascending}
      selectMoreFields={{ isEnabled: true }}
      filters={[
        { field: { name: true }, title: "Name", type: FieldType.Text },
        {
          field: { isEnabled: true },
          title: "Enabled",
          type: FieldType.Boolean,
        },
      ]}
      columns={[
        { field: { name: true }, title: "Name", type: FieldType.Text },
        {
          field: { description: true },
          title: "Description",
          type: FieldType.Text,
        },
        {
          field: { isEnabled: true },
          title: "Status",
          type: FieldType.Boolean,
          getElement: (item: ServiceOwnerRule): ReactElement => {
            return <EnabledPill isEnabled={item.isEnabled} />;
          },
        },
      ]}
      formSteps={getOwnerRuleFormSteps<ServiceOwnerRule>()}
      formFields={[
        {
          field: { serviceLabels: true },
          title: "Service Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Filter services by labels. Leave empty to skip the filter.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Service Labels",
        },
        {
          field: { serviceNamePattern: true },
          title: "Service Name",
          stepId: "match-criteria",
          sectionTitle: "Match by Pattern",
          sectionDescription:
            "Case-insensitive regex matched against the service name and description.",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "prod-.*",
        },
        {
          field: { serviceDescriptionPattern: true },
          title: "Service Description",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "production|critical",
        },
        ...getOwnerRuleActionFields<ServiceOwnerRule>(),
      ]}
      showRefreshButton={true}
    />
  );
};

export default ServiceOwnerRulesPage;
