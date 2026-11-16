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
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import WorkflowLabelRule from "Common/Models/DatabaseModels/WorkflowLabelRule";
import React, { FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import Label from "Common/Models/DatabaseModels/Label";

const workflowLabelDocumentation: string = getLabelRuleHelpMarkdown({
  nouns: { singular: "workflow", plural: "workflows" },
});

const WorkflowLabelRulesPage: FunctionComponent<RuleSettingsPageProps> = (
  props: RuleSettingsPageProps,
): ReactElement => {
  return (
    <LabelRuleTable<WorkflowLabelRule>
      modelType={WorkflowLabelRule}
      viewRuleId={RuleViewPageUtil.getViewRuleId(props, WorkflowLabelRule)}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.WORKFLOWS_SETTINGS_LABEL_RULES,
      )}
      getRuleViewRoute={(rule: WorkflowLabelRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.WORKFLOWS_SETTINGS_LABEL_RULE_VIEW,
          rule,
        );
      }}
      id="workflow-label-rules-table"
      name="Settings > Workflow Label Rules"
      userPreferencesKey="workflow-label-rules-table"
      saveFilterProps={{
        tableId: "workflow-label-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Workflow Label Rules",
        description: "Auto-attach labels when matching workflows are created.",
      }}
      helpContent={{
        title: "How Workflow Label Rules Work",
        description: "Match workflows and attach labels automatically.",
        markdown: workflowLabelDocumentation,
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
          getElement: (item: WorkflowLabelRule): ReactElement => {
            return item.isEnabled ? (
              <Pill color={Green} text="Enabled" />
            ) : (
              <Pill color={Red} text="Disabled" />
            );
          },
        },
      ]}
      formSteps={getLabelRuleFormSteps<WorkflowLabelRule>()}
      formFields={[
        {
          field: { workflowLabels: true },
          title: "Workflow Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Only trigger for workflows that already have at least one of these labels. Leave empty to skip the filter.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Workflow Labels",
        },
        {
          field: { workflowNamePattern: true },
          title: "Workflow Name",
          stepId: "match-criteria",
          sectionTitle: "Match by Pattern",
          sectionDescription:
            "Case-insensitive regex matched against the workflow name and description.",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "prod-.*",
        },
        {
          field: { workflowDescriptionPattern: true },
          title: "Workflow Description",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "production|critical",
        },
        ...getLabelRuleActionFields<WorkflowLabelRule>(),
      ]}
      showRefreshButton={true}
    />
  );
};

export default WorkflowLabelRulesPage;
