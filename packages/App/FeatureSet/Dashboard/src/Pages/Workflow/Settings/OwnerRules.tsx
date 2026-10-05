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
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import WorkflowOwnerRule from "Common/Models/DatabaseModels/WorkflowOwnerRule";
import React, { FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import Label from "Common/Models/DatabaseModels/Label";

const workflowOwnerDocumentation: string = `
### How Workflow Owner Rules Work

Workflow Owner Rules add owner users and teams to a workflow automatically when it matches your criteria — without anyone having to remember to assign owners.

### Match Criteria

A rule matches a workflow only when **all** specified criteria pass. Empty criteria are skipped.

- **Workflow Labels** — any-of (M2M)
- **Name / Description Pattern** — case-insensitive regex

### Action

When a rule matches, every user and team listed on the rule is added as an owner. Already-assigned owners are not duplicated. If \`Notify Owners\` is enabled (default), added owners are notified. Multiple matching rules all fire — the union of their owners ends up assigned.
`;

const WorkflowOwnerRulesPage: FunctionComponent<RuleSettingsPageProps> = (
  props: RuleSettingsPageProps,
): ReactElement => {
  return (
    <RuleTable<WorkflowOwnerRule>
      modelType={WorkflowOwnerRule}
      viewRuleId={RuleViewPageUtil.getViewRuleId(props, WorkflowOwnerRule)}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.WORKFLOWS_SETTINGS_OWNER_RULES,
      )}
      getRuleViewRoute={(rule: WorkflowOwnerRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.WORKFLOWS_SETTINGS_OWNER_RULE_VIEW,
          rule,
        );
      }}
      id="workflow-owner-rules-table"
      name="Settings > Workflow Owner Rules"
      userPreferencesKey="workflow-owner-rules-table"
      saveFilterProps={{
        tableId: "workflow-owner-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Workflow Owner Rules",
        description:
          "Auto-assign owner users and teams when matching workflows are created.",
      }}
      helpContent={{
        title: "How Workflow Owner Rules Work",
        description: "Match workflows and add owner users/teams automatically.",
        markdown: workflowOwnerDocumentation,
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
          getElement: (item: WorkflowOwnerRule): ReactElement => {
            return item.isEnabled ? (
              <Pill color={Green} text="Enabled" />
            ) : (
              <Pill color={Red} text="Disabled" />
            );
          },
        },
      ]}
      formSteps={getOwnerRuleFormSteps<WorkflowOwnerRule>()}
      formFields={[
        {
          field: { workflowLabels: true },
          title: "Workflow Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Filter workflows by labels. Leave empty to skip the filter.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Workflow Labels (optional)",
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
        ...getOwnerRuleActionFields<WorkflowOwnerRule>(),
      ]}
      showRefreshButton={true}
    />
  );
};

export default WorkflowOwnerRulesPage;
