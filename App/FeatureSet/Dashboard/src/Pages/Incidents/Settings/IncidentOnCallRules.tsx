import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import IncidentOnCallRule from "Common/Models/DatabaseModels/IncidentOnCallRule";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Label from "Common/Models/DatabaseModels/Label";

const documentationMarkdown: string = `
### How Incident On-Call Rules Work

Incident On-Call Rules let you automatically execute on-call duty policies when an incident is created that matches your criteria — without having to remember to attach the policy by hand or wire it into a template.

\`\`\`mermaid
flowchart TD
    A[New Incident Created] --> B{Match Against On-Call Rules}
    B -->|Rule Matches| C[Add Rule's On-Call Policies to Incident]
    B -->|No Match| D[Use Only Manually Attached Policies]
    C --> E[Execute All Attached Policies]
    D --> E
\`\`\`

### Match Criteria

A rule matches an incident only when **all** specified criteria pass. Empty criteria are skipped (don't filter on that field).

- **Monitors** — incident must come from one of these monitors (any-of)
- **Incident Severities** — incident must have one of these severities (any-of)
- **Incident Labels** — incident must carry at least one of these labels (any-of)
- **Monitor Labels** — at least one of the incident's monitors must carry one of these labels
- **Incident Title / Description Pattern** — case-insensitive regex match
- **Monitor Name / Description Pattern** — case-insensitive regex match against any of the incident's monitors

### Action

When a rule matches, every on-call duty policy listed on the rule is executed for the incident. Policies are deduped against any policies already attached to the incident, so each policy runs at most once.

### Multiple Matching Rules

All matching rules fire — there is no priority or short-circuit. The set of policies that ends up executing is the union of every matching rule's policies, plus any policies attached to the incident manually or via template.
`;

const IncidentOnCallRulesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<IncidentOnCallRule>
        modelType={IncidentOnCallRule}
        id="incident-on-call-rules-table"
        name="Settings > Incident On-Call Rules"
        userPreferencesKey="incident-on-call-rules-table"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        createEditModalWidth={ModalWidth.Large}
        cardProps={{
          title: "Incident On-Call Rules",
          description:
            "Define rules to automatically execute on-call duty policies when matching incidents are created.",
        }}
        helpContent={{
          title: "How Incident On-Call Rules Work",
          description:
            "Match incidents against criteria and fire on-call policies automatically.",
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
            getElement: (item: IncidentOnCallRule): ReactElement => {
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
            placeholder: "Page database team for any DB incident",
            validation: { minLength: 2 },
          },
          {
            field: { description: true },
            title: "Description",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder:
              "Fires the database on-call rotation whenever an incident with the 'database' label is created.",
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
              "Only trigger for incidents from these monitors. Leave empty to match incidents from any monitor.",
            placeholder: "Select Monitors (optional)",
          },
          {
            field: { incidentSeverities: true },
            title: "Incident Severities",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: IncidentSeverity,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            description:
              "Only trigger for incidents with these severities. Leave empty to match incidents of any severity.",
            placeholder: "Select Severities (optional)",
          },
          {
            field: { incidentLabels: true },
            title: "Incident Labels",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            description:
              "Only trigger for incidents that carry at least one of these labels. Leave empty to match regardless of incident labels.",
            placeholder: "Select Incident Labels (optional)",
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
              "Only trigger when at least one of the incident's monitors carries one of these labels. Leave empty to match regardless of monitor labels.",
            placeholder: "Select Monitor Labels (optional)",
          },
          {
            field: { incidentTitlePattern: true },
            title: "Incident Title Pattern",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "CPU.*high",
            description:
              "Case-insensitive regex matched against the incident title.",
          },
          {
            field: { incidentDescriptionPattern: true },
            title: "Incident Description Pattern",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "timeout|connection refused",
            description:
              "Case-insensitive regex matched against the incident description.",
          },
          {
            field: { monitorNamePattern: true },
            title: "Monitor Name Pattern",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "prod-.*",
            description:
              "Case-insensitive regex matched against any of the incident's monitor names.",
          },
          {
            field: { monitorDescriptionPattern: true },
            title: "Monitor Description Pattern",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "production|critical",
            description:
              "Case-insensitive regex matched against any of the incident's monitor descriptions.",
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
              "Policies to execute when an incident matches this rule. At least one policy is required.",
            placeholder: "Select On-Call Policies",
          },
        ]}
        showRefreshButton={true}
      />
    </Fragment>
  );
};

export default IncidentOnCallRulesPage;
