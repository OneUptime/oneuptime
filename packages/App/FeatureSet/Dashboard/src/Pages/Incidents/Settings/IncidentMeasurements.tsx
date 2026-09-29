import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import IncidentMeasurement from "Common/Models/DatabaseModels/IncidentMeasurement";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import IncidentMeasurementAnchorType from "Common/Types/Incident/IncidentMeasurementAnchorType";
import IncidentStateRole from "Common/Types/Incident/IncidentStateRole";
import MeasurementAggregationType from "Common/Types/Measurement/MeasurementAggregationType";
import MeasurementOccurrence from "Common/Types/Measurement/MeasurementOccurrence";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";

const documentationMarkdown: string = `
### What a Measurement Is

A measurement is a named duration between two points in an incident's life - "Time to Detect", "Time to Acknowledge", anything your team argues about in a review. You define the two ends; OneUptime computes the duration for every incident and records it as a metric you can chart.

Nothing here is guessed. If one end of a measurement never happened for an incident, no number is written for that incident at all, so a skipped milestone cannot quietly pull an average towards zero.

\`\`\`mermaid
flowchart TD
    A[Measurement Definition<br/>start anchor + end anchor] --> B[Incident State Timeline<br/>and timestamp fields]
    B --> C{Both anchors resolved?}
    C -->|Yes, end after start| D[Computed Duration<br/>status: Recorded]
    C -->|Not yet, still possible| E[status: Pending<br/>no point written]
    C -->|Can never resolve| F[status: Not Applicable<br/>no point written]
    C -->|End before start| G[status: Invalid<br/>no point written]
    D --> H[Metric point written under<br/>oneuptime.incident.measurement.KEY]
    H --> I[Charts and dashboards]
\`\`\`

---

### Anchor Types

An anchor is where one end of the measurement sits in time. Anchors are deliberately wider than "a state" - "started" is not a state and never will be, which is what makes Time to Detect expressible at all.

| Anchor Type | Resolves To |
|-------------|-------------|
| **Impact Started At** | When customer impact actually began. Recorded by a human on the incident; never inferred. |
| **Declared At** | When the incident was declared. Defaults to the time it was created. |
| **Created At** | When the incident record was created in OneUptime. |
| **Timeline Start** | The first entry on the incident's state timeline, falling back to Declared At and then Created At. This is the origin the built-in incident metrics use, so a definition using it reproduces today's numbers exactly. |
| **State Entered** | The moment a specific incident state was entered, pinned by id. Pick the state below. |
| **State Role Entered** | The moment whichever state carries a role - Created, Acknowledged or Resolved - was entered. Resolves by flag rather than by id, so it keeps working when you rename or replace that state. |
| **Postmortem Posted At** | When the postmortem was posted. |

For the two state-based anchors you also choose an **occurrence**. \`First\` matches the behaviour of the built-in metrics; \`Last\` is the opt-in for teams who want a reopened incident's measurement to move to the final resolution rather than pinning to the first one.

---

### Statuses

Every incident gets one of these outcomes per measurement. Only **Recorded** writes a metric point.

| Status | What It Means |
|--------|---------------|
| **Recorded** | Both anchors resolved and the duration is meaningful. This is the only status that produces a number. |
| **Pending** | An anchor has not happened yet but still can - the incident is mid-flight. The only status that changes on its own. |
| **Not Applicable** | An anchor can never resolve for this incident: the state was skipped, the timestamp was never filled in, or the referenced state has been deleted. No point is written, so a skipped milestone does not drag the average down. |
| **Invalid** | Both anchors resolved but the end precedes the start. Someone's recorded timestamps disagree with each other. Surfaced rather than clamped to zero. |

---

### Coming From FireHydrant or Rootly

There is no fixed list of built-in metrics to match. Set up the ones your team actually reports on:

| Their measurement | Set up in OneUptime as |
|-------------------|------------------------|
| Time to Detect | Impact Started At -> Declared At |
| Time to Acknowledge | Impact Started At (or Timeline Start) -> the acknowledged state |
| Time to Mitigate | Timeline Start -> a "Mitigated" state you add between Acknowledged and Resolved |
| Time to Resolve | Timeline Start -> the resolved state |

**About Impact Started At.** It is a new editable field on the incident. It is blank by default and is never guessed, because there is no honest way to infer when impact began. A measurement that depends on it reads **Not Applicable** until someone fills it in, deliberately - a fabricated zero would read as "we detect instantly", which is worse than no number.

---

### Key and Metric Name

The **Key** is permanent. Every recorded point is written under \`oneuptime.incident.measurement.<key>\`, so changing the key would orphan all the history behind it. To rename a measurement for humans, change the **Name** instead - that is what appears on charts and on the incident page.
`;

const IncidentMeasurementsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<IncidentMeasurement>
        modelType={IncidentMeasurement}
        id="incident-measurements-table"
        name="Settings > Incident Measurements"
        userPreferencesKey="incident-measurements-table"
        saveFilterProps={{
          tableId: "incident-measurements-table",
        }}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        isViewable={false}
        cardProps={{
          title: "Incident Measurements",
          description:
            "Define named durations between two points in an incident's life - Time to Detect, Time to Acknowledge, and anything else your team reports on. Each one is computed automatically and charted as its own metric.",
        }}
        helpContent={{
          title: "How Incident Measurements Work",
          description:
            "Understanding anchors, statuses, and how a measurement becomes a chart",
          markdown: documentationMarkdown,
        }}
        sortBy="order"
        sortOrder={SortOrder.Ascending}
        selectMoreFields={{
          order: true,
          isEnabled: true,
        }}
        filters={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              key: true,
            },
            title: "Key",
            type: FieldType.Text,
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Enabled",
            type: FieldType.Boolean,
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Text,
          },
          {
            field: {
              key: true,
            },
            title: "Key",
            type: FieldType.Text,
          },
          {
            field: {
              startAnchorType: true,
            },
            title: "Starts At",
            type: FieldType.Text,
          },
          {
            field: {
              endAnchorType: true,
            },
            title: "Ends At",
            type: FieldType.Text,
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Status",
            type: FieldType.Boolean,
            getElement: (item: IncidentMeasurement): ReactElement => {
              if (item.isEnabled) {
                return <Pill color={Green} text="Enabled" />;
              }
              return <Pill color={Red} text="Disabled" />;
            },
          },
        ]}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            sectionTitle: "Basics",
            sectionDescription:
              "What this measurement is called and what it means to your team.",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Time to Detect",
            validation: {
              minLength: 2,
            },
            description:
              "Human readable name. This is what appears on charts and on the incident page.",
          },
          {
            field: {
              key: true,
            },
            title: "Key",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "time-to-detect",
            description:
              "Permanent, machine readable identifier. It is used to build the metric name (oneuptime.incident.measurement.<key>) that every recorded point is written under and that charts query, so it cannot be changed once created - changing it would orphan all the history. To rename a measurement, change the Name instead.",
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder:
              "How long it took from customer impact starting to us declaring the incident.",
          },
          {
            field: {
              startAnchorType: true,
            },
            title: "Start Anchor",
            sectionTitle: "Start Anchor",
            sectionDescription:
              "Where the measurement starts. Pick a timestamp on the incident, or the moment a state was entered.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
              IncidentMeasurementAnchorType,
            ),
            required: true,
            placeholder: "Impact Started At",
          },
          {
            field: {
              startIncidentState: true,
            },
            title: "Start Incident State",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: IncidentState,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Incident State",
            description:
              "The measurement starts when the incident enters this state.",
            showIf: (values: FormValues<IncidentMeasurement>): boolean => {
              return (
                values.startAnchorType ===
                IncidentMeasurementAnchorType.StateEntered
              );
            },
          },
          {
            field: {
              startIncidentStateRole: true,
            },
            title: "Start Incident State Role",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions:
              DropdownUtil.getDropdownOptionsFromEnum(IncidentStateRole),
            required: false,
            placeholder: "Acknowledged",
            description:
              "The measurement starts when whichever state carries this role is entered. Keeps working if you rename or replace that state.",
            showIf: (values: FormValues<IncidentMeasurement>): boolean => {
              return (
                values.startAnchorType ===
                IncidentMeasurementAnchorType.StateRoleEntered
              );
            },
          },
          {
            field: {
              startStateOccurrence: true,
            },
            title: "Start State Occurrence",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
              MeasurementOccurrence,
            ),
            required: false,
            placeholder: "First",
            description:
              "Which entry to use when the state is entered more than once. First matches the built-in metrics; Last follows a reopened incident to its final entry.",
            showIf: (values: FormValues<IncidentMeasurement>): boolean => {
              return (
                values.startAnchorType ===
                  IncidentMeasurementAnchorType.StateEntered ||
                values.startAnchorType ===
                  IncidentMeasurementAnchorType.StateRoleEntered
              );
            },
          },
          {
            field: {
              endAnchorType: true,
            },
            title: "End Anchor",
            sectionTitle: "End Anchor",
            sectionDescription:
              "Where the measurement ends. If the end never happens for an incident, the measurement reads Not Applicable and no number is recorded.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
              IncidentMeasurementAnchorType,
            ),
            required: true,
            placeholder: "Declared At",
          },
          {
            field: {
              endIncidentState: true,
            },
            title: "End Incident State",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: IncidentState,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Incident State",
            description:
              "The measurement ends when the incident enters this state.",
            showIf: (values: FormValues<IncidentMeasurement>): boolean => {
              return (
                values.endAnchorType ===
                IncidentMeasurementAnchorType.StateEntered
              );
            },
          },
          {
            field: {
              endIncidentStateRole: true,
            },
            title: "End Incident State Role",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions:
              DropdownUtil.getDropdownOptionsFromEnum(IncidentStateRole),
            required: false,
            placeholder: "Resolved",
            description:
              "The measurement ends when whichever state carries this role is entered.",
            showIf: (values: FormValues<IncidentMeasurement>): boolean => {
              return (
                values.endAnchorType ===
                IncidentMeasurementAnchorType.StateRoleEntered
              );
            },
          },
          {
            field: {
              endStateOccurrence: true,
            },
            title: "End State Occurrence",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
              MeasurementOccurrence,
            ),
            required: false,
            placeholder: "First",
            description:
              "Which entry to use when the state is entered more than once.",
            showIf: (values: FormValues<IncidentMeasurement>): boolean => {
              return (
                values.endAnchorType ===
                  IncidentMeasurementAnchorType.StateEntered ||
                values.endAnchorType ===
                  IncidentMeasurementAnchorType.StateRoleEntered
              );
            },
          },
          {
            field: {
              unit: true,
            },
            title: "Unit",
            sectionTitle: "Reporting",
            sectionDescription:
              "How the computed duration is stored and charted.",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "seconds",
            description: "The unit durations are recorded in. Default: seconds",
          },
          {
            field: {
              aggregationType: true,
            },
            title: "Aggregation Type",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
              MeasurementAggregationType,
            ),
            required: false,
            placeholder: "Avg",
            description:
              "The aggregation this measurement's chart defaults to. Sum is deliberately absent - summing durations across incidents produces a number with no meaning.",
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Enabled",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "Disable to stop computing and recording this measurement without deleting its history.",
          },
          {
            field: {
              order: true,
            },
            title: "Order",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "1",
            description:
              "Order in which this measurement is displayed. Lowest first.",
          },
        ]}
        showRefreshButton={true}
      />
    </Fragment>
  );
};

export default IncidentMeasurementsPage;
