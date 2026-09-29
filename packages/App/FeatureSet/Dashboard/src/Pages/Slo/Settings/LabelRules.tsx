import RuleSettingsPageProps from "../../RuleSettingsPageProps";
import PageMap from "../../../Utils/PageMap";
import RuleViewPageUtil from "../../../Utils/RuleViewPage";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import LabelRuleTable from "Common/UI/Components/LabelRule/LabelRuleTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import ServiceLevelObjectiveLabelRule from "Common/Models/DatabaseModels/ServiceLevelObjectiveLabelRule";
import React, { FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import Label from "Common/Models/DatabaseModels/Label";

const sloLabelDocumentation: string = `
### How SLO Label Rules Work

SLO Label Rules attach labels to an SLO automatically when it matches your criteria — so you don't have to remember to tag new SLOs.

### Match Criteria

A rule matches an SLO only when **all** specified criteria pass. Empty criteria are skipped.

- **SLO Labels** (prerequisite) — any-of
- **Name / Description Pattern** — case-insensitive regex, or a \`*\` wildcard such as \`*checkout*\`

### Action

When a rule matches, every label listed in \`Labels to Add\` is attached to the SLO. Already-attached labels are not duplicated. Multiple matching rules all fire — the union of their labels ends up attached.
`;

const SloLabelRulesPage: FunctionComponent<RuleSettingsPageProps> = (
  props: RuleSettingsPageProps,
): ReactElement => {
  return (
    <LabelRuleTable<ServiceLevelObjectiveLabelRule>
      modelType={ServiceLevelObjectiveLabelRule}
      viewRuleId={RuleViewPageUtil.getViewRuleId(
        props,
        ServiceLevelObjectiveLabelRule,
      )}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.SLOS_SETTINGS_LABEL_RULES,
      )}
      getRuleViewRoute={(rule: ServiceLevelObjectiveLabelRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.SLOS_SETTINGS_LABEL_RULE_VIEW,
          rule,
        );
      }}
      id="slo-label-rules-table"
      name="Settings > SLO Label Rules"
      userPreferencesKey="slo-label-rules-table"
      saveFilterProps={{
        tableId: "slo-label-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "SLO Label Rules",
        description: "Auto-attach labels when matching SLOs are created.",
      }}
      helpContent={{
        title: "How SLO Label Rules Work",
        description: "Match SLOs and attach labels automatically.",
        markdown: sloLabelDocumentation,
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
          getElement: (item: ServiceLevelObjectiveLabelRule): ReactElement => {
            return item.isEnabled ? (
              <Pill color={Green} text="Enabled" />
            ) : (
              <Pill color={Red} text="Disabled" />
            );
          },
        },
      ]}
      formSteps={[
        { title: "Basic Info", id: "basic-info" },
        { title: "Match Criteria", id: "match-criteria", columns: 2 },
        { title: "Labels", id: "labels", columns: 2 },
      ]}
      formFields={[
        {
          field: { name: true },
          title: "Name",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "Tag matching SLOs",
          validation: { minLength: 2 },
        },
        {
          field: { description: true },
          title: "Description",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.LongText,
          required: false,
        },
        {
          field: { isEnabled: true },
          title: "Enabled",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          description: "Enable or disable this rule.",
        },
        {
          field: { serviceLevelObjectiveLabels: true },
          title: "SLO Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Only trigger for SLOs that already have at least one of these labels. Leave empty to skip the filter.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select SLO Labels (optional)",
        },
        {
          field: { serviceLevelObjectiveNamePattern: true },
          title: "SLO Name Pattern",
          stepId: "match-criteria",
          sectionTitle: "Match by Pattern",
          sectionDescription:
            "Case-insensitive regex, or a * wildcard, matched against the SLO name and description.",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "checkout-.*",
        },
        {
          field: { serviceLevelObjectiveDescriptionPattern: true },
          title: "SLO Description Pattern",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "customer-facing|tier-1",
        },
        {
          field: { labelsToAdd: true },
          title: "Labels to Add",
          stepId: "labels",
          sectionTitle: "Labels to Attach",
          sectionDescription:
            "When this rule matches, every selected label is attached to the SLO. Already-attached labels are not duplicated.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Labels",
        },
      ]}
      showRefreshButton={true}
    />
  );
};

export default SloLabelRulesPage;
