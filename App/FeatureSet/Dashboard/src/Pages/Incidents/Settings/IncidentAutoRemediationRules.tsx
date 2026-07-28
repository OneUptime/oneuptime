import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import IncidentAutoRemediationRule from "Common/Models/DatabaseModels/IncidentAutoRemediationRule";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { Green, Red, Yellow } from "Common/Types/BrandColors";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Label from "Common/Models/DatabaseModels/Label";

const incidentAutoRemediationDocumentation: string = `
### How Incident Auto Remediation Rules Work

An Auto Remediation Rule is a **standing authorization**. When an enabled rule matches an incident, the remediation actions OneUptime AI proposes for that incident execute immediately instead of waiting for someone to click Approve.

\`\`\`mermaid
flowchart TD
    A[Confident Investigation Proposes Remediation] --> B{Match Against Auto Remediation Rules}
    B -->|No Rule Matches| C[Proposal Waits for Human Approval]
    B -->|Rule Matches| D{Action Type}
    D -->|Runbook Action| E[Execute Unattended]
    D -->|AI-Drafted Command| F{Rule Auto-Executes Drafted Commands?}
    F -->|Yes| E
    F -->|No| C
    E --> G{Action Writes Anything?}
    G -->|Diagnostic| H[Runs on Any Runbook Agent]
    G -->|Remediation| I[Runs Only on ReadWrite Agents]
\`\`\`

### Match Criteria

A rule matches an incident only when **all** specified criteria pass. Empty criteria are skipped (don't filter on that field).

- **Monitors** — incident must come from one of these monitors (any-of)
- **Incident Severities** — incident must have one of these severities (any-of)
- **Incident Labels** — incident must carry at least one of these labels (any-of)
- **Monitor Labels** — at least one of the incident's monitors must carry one of these labels
- **Incident Title / Description Pattern** — case-insensitive regex match
- **Monitor Name / Description Pattern** — case-insensitive regex match against any of the incident's monitors

**A rule with no criteria at all matches every incident in this project.** That is a project-wide grant of unattended execution. Scope every rule deliberately — start with a single monitor or a single label.

### What Still Holds You Back

Arming a rule does not remove the other guardrails:

- **AI Remediation must be on** for the project (Incidents > Settings > AI), and the project's daily execution limit still applies.
- **Actions that change things only run on agents you granted ReadWrite AI access.** A Remediation-intent action targeting a ReadOnly agent still waits for a human, rule or no rule. Diagnostic actions may run on any agent.
- **Proposals still come only from confident investigations**, expire after 24 hours, and are capped at 3 executions per incident.
- Every execution is attributed and logged, whether a human clicked or a rule fired.

### Auto-Execute Drafted Commands

Leave this **off** and a matching rule auto-executes only your own human-authored runbooks. Turn it **on** and AI-drafted shell commands — scripts no human has read — also run unattended on matching incidents.

### Multiple Matching Rules

All matching rules are evaluated — there is no priority. If any matching rule allows drafted commands, drafted commands are allowed.
`;

const IncidentAutoRemediationRulesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <Alert
        type={AlertType.WARNING}
        strongTitle="These rules let AI act without asking you first"
        title="A rule with no match criteria matches every incident in this project. Scope each rule to the monitors, severities or labels you actually want automated, and grant ReadWrite AI access only to the Runbook Agents you are willing to let AI change."
      />
      <ModelTable<IncidentAutoRemediationRule>
        modelType={IncidentAutoRemediationRule}
        id="incident-auto-remediation-rules-table"
        name="Settings > Incident Auto Remediation Rules"
        userPreferencesKey="incident-auto-remediation-rules-table"
        saveFilterProps={{
          tableId: "incident-auto-remediation-rules-table",
        }}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        createEditModalWidth={ModalWidth.Large}
        cardProps={{
          title: "Incident Auto Remediation Rules",
          description:
            "A matching rule is a standing authorization: AI-proposed remediation for incidents it matches executes without waiting for approval. Actions that change things still only run on Runbook Agents you granted ReadWrite AI access. With no rules, every proposal waits for a human. Careful: a rule with no match criteria matches every incident in this project — scope rules deliberately.",
        }}
        helpContent={{
          title: "How Incident Auto Remediation Rules Work",
          description:
            "Match incidents against criteria and let AI-proposed remediation run unattended.",
          markdown: incidentAutoRemediationDocumentation,
        }}
        sortBy="name"
        sortOrder={SortOrder.Ascending}
        selectMoreFields={{
          isEnabled: true,
          autoExecuteCommands: true,
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
          {
            field: { autoExecuteCommands: true },
            title: "Auto-Execute Drafted Commands",
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
            field: { autoExecuteCommands: true },
            title: "Drafted Commands",
            type: FieldType.Boolean,
            getElement: (item: IncidentAutoRemediationRule): ReactElement => {
              if (item.autoExecuteCommands) {
                return <Pill color={Yellow} text="Auto-Executed" />;
              }
              return <Pill color={Green} text="Needs Approval" />;
            },
          },
          {
            field: { isEnabled: true },
            title: "Status",
            type: FieldType.Boolean,
            getElement: (item: IncidentAutoRemediationRule): ReactElement => {
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
          { title: "Match Criteria", id: "match-criteria", columns: 2 },
          { title: "Autonomy", id: "autonomy" },
        ]}
        formFields={[
          {
            field: { name: true },
            title: "Name",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Auto-remediate disk pressure on staging hosts",
            validation: { minLength: 2 },
          },
          {
            field: { description: true },
            title: "Description",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder:
              "Lets AI run our disk-cleanup runbook without approval for incidents on monitors labelled 'staging'.",
          },
          {
            field: { isEnabled: true },
            title: "Enabled",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "Enable or disable this rule. A disabled rule authorizes nothing — every proposal it would have matched goes back to waiting for a human.",
          },
          {
            field: { monitors: true },
            title: "Monitors",
            stepId: "match-criteria",
            sectionTitle: "Match by Attributes",
            sectionDescription:
              "Warning: a rule with no criteria at all matches EVERY incident in this project and arms unattended execution project-wide. Set at least one criterion — filter incidents by which monitor produced them and their severity/labels. Leave a filter empty to skip it.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Monitor,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
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
            placeholder: "Select Monitor Labels (optional)",
          },
          {
            field: { incidentTitlePattern: true },
            title: "Incident Title Pattern",
            stepId: "match-criteria",
            sectionTitle: "Match by Pattern",
            sectionDescription:
              "Case-insensitive regex matched against incident and monitor text.",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "CPU.*high",
          },
          {
            field: { incidentDescriptionPattern: true },
            title: "Incident Description Pattern",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "timeout|connection refused",
          },
          {
            field: { monitorNamePattern: true },
            title: "Monitor Name Pattern",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "prod-.*",
          },
          {
            field: { monitorDescriptionPattern: true },
            title: "Monitor Description Pattern",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "production|critical",
          },
          {
            field: { autoExecuteCommands: true },
            title: "Auto-Execute Drafted Commands",
            stepId: "autonomy",
            sectionTitle: "How Far This Authorization Goes",
            sectionDescription:
              "Matching incidents always auto-execute AI-proposed runbook actions. This decides whether AI-drafted commands are auto-executed too.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "When ON, AI-drafted scripts that no human has reviewed will run on your infrastructure without approval for incidents this rule matches. Leave it OFF to auto-run only your own human-authored runbooks and keep drafted commands waiting for a human. Either way, actions that change things only run on Runbook Agents granted ReadWrite AI access.",
          },
        ]}
        showRefreshButton={true}
      />
    </Fragment>
  );
};

export default IncidentAutoRemediationRulesPage;
