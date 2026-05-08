import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import AlertOnCallRule from "Common/Models/DatabaseModels/AlertOnCallRule";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import Label from "Common/Models/DatabaseModels/Label";

const documentationMarkdown: string = `
### How Alert On-Call Rules Work

Alert On-Call Rules let you automatically execute on-call duty policies when an alert is created that matches your criteria — without having to remember to attach the policy by hand.

\`\`\`mermaid
flowchart TD
    A[New Alert Created] --> B{Match Against On-Call Rules}
    B -->|Rule Matches| C[Add Rule's On-Call Policies to Alert]
    B -->|No Match| D[Use Only Manually Attached Policies]
    C --> E[Execute All Attached Policies]
    D --> E
\`\`\`

### Match Criteria

A rule matches an alert only when **all** specified criteria pass. Empty criteria are skipped (don't filter on that field).

- **Monitors** — alert must come from one of these monitors
- **Alert Severities** — alert must have one of these severities (any-of)
- **Alert Labels** — alert must carry at least one of these labels (any-of)
- **Monitor Labels** — the alert's monitor must carry at least one of these labels
- **Alert Title / Description Pattern** — case-insensitive regex match
- **Monitor Name / Description Pattern** — case-insensitive regex match against the alert's monitor

### Action

When a rule matches, every on-call duty policy listed on the rule is executed for the alert. Policies are deduped against any policies already attached to the alert, so each policy runs at most once.

### Multiple Matching Rules

All matching rules fire — there is no priority or short-circuit. The set of policies that ends up executing is the union of every matching rule's policies, plus any policies attached to the alert manually.
`;

const AlertOnCallRulesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<AlertOnCallRule>
        modelType={AlertOnCallRule}
        id="alert-on-call-rules-table"
        name="Settings > Alert On-Call Rules"
        userPreferencesKey="alert-on-call-rules-table"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        createEditModalWidth={ModalWidth.Large}
        cardProps={{
          title: "Alert On-Call Rules",
          description:
            "Define rules to automatically execute on-call duty policies when matching alerts are created.",
        }}
        helpContent={{
          title: "How Alert On-Call Rules Work",
          description:
            "Match alerts against criteria and fire on-call policies automatically.",
          markdown: documentationMarkdown,
        }}
        sortBy="name"
        sortOrder={SortOrder.Ascending}
        selectMoreFields={{
          isEnabled: true,
        }}
        filters={[
          {
            field: { name: true },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: { isEnabled: true },
            title: "Enabled",
            type: FieldType.Boolean,
          },
        ]}
        columns={[
          {
            field: { name: true },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: { description: true },
            title: "Description",
            type: FieldType.Text,
          },
          {
            field: { isEnabled: true },
            title: "Status",
            type: FieldType.Boolean,
            getElement: (item: AlertOnCallRule): ReactElement => {
              if (item.isEnabled) {
                return <Pill color={Green} text="Enabled" />;
              }
              return <Pill color={Red} text="Disabled" />;
            },
          },
        ]}
        viewPageRoute={Navigation.getCurrentRoute()}
        formSteps={[
          { title: "Basic Info", id: "basic-info" },
          { title: "Match Criteria", id: "match-criteria" },
          { title: "On-Call Policies", id: "on-call" },
        ]}
        formFields={[
          {
            field: { name: true },
            title: "Name",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Page database team for any DB alert",
            validation: { minLength: 2 },
          },
          {
            field: { description: true },
            title: "Description",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder:
              "Fires the database on-call rotation whenever an alert with the 'database' label is created.",
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
            field: { monitors: true },
            title: "Monitors",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Monitor,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            description:
              "Only trigger for alerts from these monitors. Leave empty to match alerts from any monitor.",
            placeholder: "Select Monitors (optional)",
          },
          {
            field: { alertSeverities: true },
            title: "Alert Severities",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: AlertSeverity,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            description:
              "Only trigger for alerts with these severities. Leave empty to match alerts of any severity.",
            placeholder: "Select Severities (optional)",
          },
          {
            field: { alertLabels: true },
            title: "Alert Labels",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            description:
              "Only trigger for alerts that carry at least one of these labels. Leave empty to match regardless of alert labels.",
            placeholder: "Select Alert Labels (optional)",
          },
          {
            field: { monitorLabels: true },
            title: "Monitor Labels",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            description:
              "Only trigger when the alert's monitor carries one of these labels. Leave empty to match regardless of monitor labels.",
            placeholder: "Select Monitor Labels (optional)",
          },
          {
            field: { alertTitlePattern: true },
            title: "Alert Title Pattern",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "CPU.*high",
            description:
              "Case-insensitive regex matched against the alert title.",
          },
          {
            field: { alertDescriptionPattern: true },
            title: "Alert Description Pattern",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "timeout|connection refused",
            description:
              "Case-insensitive regex matched against the alert description.",
          },
          {
            field: { monitorNamePattern: true },
            title: "Monitor Name Pattern",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "prod-.*",
            description:
              "Case-insensitive regex matched against the alert's monitor name.",
          },
          {
            field: { monitorDescriptionPattern: true },
            title: "Monitor Description Pattern",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "production|critical",
            description:
              "Case-insensitive regex matched against the alert's monitor description.",
          },
          {
            field: { onCallDutyPolicies: true },
            title: "On-Call Duty Policies",
            stepId: "on-call",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: OnCallDutyPolicy,
              labelField: "name",
              valueField: "_id",
            },
            required: true,
            description:
              "Policies to execute when an alert matches this rule. At least one policy is required.",
            placeholder: "Select On-Call Policies",
          },
        ]}
        showRefreshButton={true}
      />
    </Fragment>
  );
};

export default AlertOnCallRulesPage;
