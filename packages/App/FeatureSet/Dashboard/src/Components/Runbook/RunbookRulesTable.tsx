import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import RunbookRule from "Common/Models/DatabaseModels/RunbookRule";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import RunbookRuleTriggerEntity from "Common/Types/Runbook/RunbookRuleTriggerEntity";
import { Green, Red } from "Common/Types/BrandColors";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  triggerEntityType: RunbookRuleTriggerEntity;
  entityLabel: string; // "incident", "alert", "scheduled maintenance event"
}

const runbookRuleDocumentation: (entityLabel: string) => string = (
  entityLabel: string,
): string => {
  return `
### How Runbook Rules Work

Runbook rules attach runbooks to ${entityLabel}s automatically when they are created — no one has to remember to kick them off.

### Match Criteria

A rule matches when **all** specified criteria pass. Empty criteria are skipped.

- **Title Pattern** — case-insensitive regex matched against the ${entityLabel}'s title.
- **Description Pattern** — case-insensitive regex matched against the ${entityLabel}'s description.

Leave both empty to match every ${entityLabel}.

### Action

When a rule matches, every selected runbook starts its own execution attached to the ${entityLabel}. You'll find the runs on the ${entityLabel}'s page and under **Runbooks → Executions**. Multiple matching rules all fire — the union of their runbooks starts.
`;
};

const RunbookRulesTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <ModelTable<RunbookRule>
      modelType={RunbookRule}
      id={`runbook-rules-table-${props.triggerEntityType}`}
      name={`Settings > Runbook Rules > ${props.triggerEntityType}`}
      userPreferencesKey={`runbook-rules-table-${props.triggerEntityType}`}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      query={{ triggerEntityType: props.triggerEntityType }}
      onBeforeCreate={async (item: RunbookRule) => {
        item.triggerEntityType = props.triggerEntityType;
        return item;
      }}
      cardProps={{
        title: "Runbook Rules",
        description: `Auto-attach runbooks when matching ${props.entityLabel}s are created.`,
      }}
      helpContent={{
        title: "How Runbook Rules Work",
        description: `Match ${props.entityLabel}s and start runbooks automatically.`,
        markdown: runbookRuleDocumentation(props.entityLabel),
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
          getElement: (item: RunbookRule): ReactElement => {
            return item.isEnabled ? (
              <Pill color={Green} text="Enabled" />
            ) : (
              <Pill color={Red} text="Disabled" />
            );
          },
        },
      ]}
      viewPageRoute={Navigation.getCurrentRoute()}
      formSteps={[
        { title: "Basic Info", id: "basic-info" },
        { title: "Match Criteria", id: "match-criteria" },
        { title: "Runbooks", id: "runbooks" },
      ]}
      formFields={[
        {
          field: { name: true },
          title: "Name",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "Start DB-failover runbook for database incidents",
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
        },
        {
          field: { titlePattern: true },
          title: "Title Pattern",
          stepId: "match-criteria",
          sectionTitle: "Match by Pattern",
          sectionDescription:
            "Case-insensitive regex. Leave both empty to match every event.",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "database|postgres|db-",
        },
        {
          field: { descriptionPattern: true },
          title: "Description Pattern",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "timeout|connection refused",
        },
        {
          field: { runbooks: true },
          title: "Runbooks to Start",
          stepId: "runbooks",
          sectionTitle: "Action",
          sectionDescription:
            "When this rule matches, every selected runbook starts its own execution attached to the event.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Runbook,
            labelField: "name",
            valueField: "_id",
          },
          required: true,
          placeholder: "Select Runbooks",
        },
      ]}
      showRefreshButton={true}
    />
  );
};

export default RunbookRulesTable;
