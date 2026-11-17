import EnabledPill from "Common/UI/Components/Pill/EnabledPill";
import { getLabelRuleHelpMarkdown } from "../../../Utils/Help/ResourceRuleHelp";
import RuleSettingsPageProps from "../../RuleSettingsPageProps";
import PageMap from "../../../Utils/PageMap";
import RuleViewPageUtil from "../../../Utils/RuleViewPage";
import {
  getLabelRuleActionFields,
  getLabelRuleFormSteps,
} from "../../../Utils/Form/ResourceRuleForm";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import LabelRuleTable from "Common/UI/Components/LabelRule/LabelRuleTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import FieldType from "Common/UI/Components/Types/FieldType";
import ServiceLabelRule from "Common/Models/DatabaseModels/ServiceLabelRule";
import React, { FunctionComponent, ReactElement } from "react";
import Label from "Common/Models/DatabaseModels/Label";

const serviceLabelDocumentation: string = getLabelRuleHelpMarkdown({
  nouns: { singular: "service", plural: "services" },
});

const ServiceLabelRulesPage: FunctionComponent<RuleSettingsPageProps> = (
  props: RuleSettingsPageProps,
): ReactElement => {
  return (
    <LabelRuleTable<ServiceLabelRule>
      modelType={ServiceLabelRule}
      viewRuleId={RuleViewPageUtil.getViewRuleId(props, ServiceLabelRule)}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.SERVICE_SETTINGS_LABEL_RULES,
      )}
      getRuleViewRoute={(rule: ServiceLabelRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.SERVICE_SETTINGS_LABEL_RULE_VIEW,
          rule,
        );
      }}
      id="service-label-rules-table"
      name="Settings > Service Label Rules"
      userPreferencesKey="service-label-rules-table"
      saveFilterProps={{
        tableId: "service-label-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Service Label Rules",
        description: "Auto-attach labels when matching services are created.",
      }}
      helpContent={{
        title: "How Service Label Rules Work",
        description: "Match services and attach labels automatically.",
        markdown: serviceLabelDocumentation,
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
          getElement: (item: ServiceLabelRule): ReactElement => {
            return <EnabledPill isEnabled={item.isEnabled} />;
          },
        },
      ]}
      formSteps={getLabelRuleFormSteps<ServiceLabelRule>()}
      formFields={[
        {
          field: { serviceLabels: true },
          title: "Service Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Only trigger for services that already have at least one of these labels. Leave empty to skip the filter.",
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
        ...getLabelRuleActionFields<ServiceLabelRule>(),
      ]}
      showRefreshButton={true}
    />
  );
};

export default ServiceLabelRulesPage;
