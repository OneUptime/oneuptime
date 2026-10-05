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
import RunbookOwnerRule from "Common/Models/DatabaseModels/RunbookOwnerRule";
import React, { FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import Label from "Common/Models/DatabaseModels/Label";

const runbookOwnerDocumentation: string = `
### How Runbook Owner Rules Work

Runbook Owner Rules add owner users and teams to a runbook automatically when it matches your criteria — without anyone having to remember to assign owners.

### Match Criteria

A rule matches a runbook only when **all** specified criteria pass. Empty criteria are skipped.

- **Runbook Labels** — any-of (M2M)
- **Name / Description Pattern** — case-insensitive regex

### Action

When a rule matches, every user and team listed on the rule is added as an owner. Already-assigned owners are not duplicated. If \`Notify Owners\` is enabled (default), added owners are notified. Multiple matching rules all fire — the union of their owners ends up assigned.
`;

const RunbookOwnerRulesPage: FunctionComponent<RuleSettingsPageProps> = (
  props: RuleSettingsPageProps,
): ReactElement => {
  return (
    <RuleTable<RunbookOwnerRule>
      modelType={RunbookOwnerRule}
      viewRuleId={RuleViewPageUtil.getViewRuleId(props, RunbookOwnerRule)}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.RUNBOOKS_SETTINGS_OWNER_RULES,
      )}
      getRuleViewRoute={(rule: RunbookOwnerRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.RUNBOOKS_SETTINGS_OWNER_RULE_VIEW,
          rule,
        );
      }}
      id="runbook-owner-rules-table"
      name="Settings > Runbook Owner Rules"
      userPreferencesKey="runbook-owner-rules-table"
      saveFilterProps={{
        tableId: "runbook-owner-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Runbook Owner Rules",
        description:
          "Auto-assign owner users and teams when matching runbooks are created.",
      }}
      helpContent={{
        title: "How Runbook Owner Rules Work",
        description: "Match runbooks and add owner users/teams automatically.",
        markdown: runbookOwnerDocumentation,
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
          getElement: (item: RunbookOwnerRule): ReactElement => {
            return item.isEnabled ? (
              <Pill color={Green} text="Enabled" />
            ) : (
              <Pill color={Red} text="Disabled" />
            );
          },
        },
      ]}
      formSteps={getOwnerRuleFormSteps<RunbookOwnerRule>()}
      formFields={[
        {
          field: { runbookLabels: true },
          title: "Runbook Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Filter runbooks by labels. Leave empty to skip the filter.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Runbook Labels (optional)",
        },
        {
          field: { runbookNamePattern: true },
          title: "Runbook Name",
          stepId: "match-criteria",
          sectionTitle: "Match by Pattern",
          sectionDescription:
            "Case-insensitive regex matched against the runbook name and description.",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "prod-.*",
        },
        {
          field: { runbookDescriptionPattern: true },
          title: "Runbook Description",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "production|critical",
        },
        ...getOwnerRuleActionFields<RunbookOwnerRule>(),
      ]}
      showRefreshButton={true}
    />
  );
};

export default RunbookOwnerRulesPage;
