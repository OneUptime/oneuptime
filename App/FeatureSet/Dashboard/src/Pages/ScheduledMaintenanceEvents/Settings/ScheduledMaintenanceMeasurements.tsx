import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import ScheduledMaintenanceMeasurement from "Common/Models/DatabaseModels/ScheduledMaintenanceMeasurement";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceMeasurementAnchorType from "Common/Types/ScheduledMaintenance/ScheduledMaintenanceMeasurementAnchorType";
import ScheduledMaintenanceStateRole from "Common/Types/ScheduledMaintenance/ScheduledMaintenanceStateRole";
import MeasurementAggregationType from "Common/Types/Measurement/MeasurementAggregationType";
import MeasurementOccurrence from "Common/Types/Measurement/MeasurementOccurrence";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";

const documentationMarkdown: string = `
### What a Measurement Is

A measurement is a named duration between two points in a maintenance event's life - "Start Delay", "Overrun", "Time to Resolve". You define the two ends; OneUptime computes the duration for every event and records it as a metric you can chart.

Maintenance is planned rather than detected, so the useful anchors here compare the planned window against what actually happened - did we start on time, did we overrun - rather than an impact-onset timestamp.

Nothing here is guessed. If one end of a measurement never happened for an event, no number is written for that event at all, so a skipped milestone cannot quietly pull an average towards zero.

\`\`\`mermaid
flowchart TD
    A[Measurement Definition<br/>start anchor + end anchor] --> B[Event State Timeline<br/>and scheduled window fields]
    B --> C{Both anchors resolved?}
    C -->|Yes, end after start| D[Computed Duration<br/>status: Recorded]
    C -->|Not yet, still possible| E[status: Pending<br/>no point written]
    C -->|Can never resolve| F[status: Not Applicable<br/>no point written]
    C -->|End before start| G[status: Invalid<br/>no point written]
    D --> H[Metric point written under<br/>oneuptime.scheduled-maintenance.measurement.KEY]
    H --> I[Charts and dashboards]
\`\`\`

---

### Anchor Types

An anchor is where one end of the measurement sits in time.

| Anchor Type | Resolves To |
|-------------|-------------|
| **Created At** | When the maintenance event record was created in OneUptime. |
| **Scheduled Starts At** | The start of the planned window, as configured on the event. |
| **Scheduled Ends At** | The end of the planned window, as configured on the event. |
| **Timeline Start** | The first entry on the event's state timeline, falling back to Created At. |
| **State Entered** | The moment a specific maintenance state was entered, pinned by id. Pick the state below. |
| **State Role Entered** | The moment whichever state carries a role - Scheduled, Ongoing, Ended or Resolved - was entered. Resolves by flag rather than by id, so it keeps working when you rename or replace that state. |

Note that this role vocabulary differs from incidents and alerts, which is exactly why measurement definitions resolve their endpoints per domain rather than assuming one shared created/acknowledged/resolved triple.

For the two state-based anchors you also choose an **occurrence**. \`First\` uses the earliest matching timeline entry; \`Last\` uses the final one, which is what you want when an event is reopened or rescheduled.

**Two worth setting up first:** Scheduled Starts At -> the Ongoing state answers "do we start our windows on time", and Scheduled Ends At -> the Ended state answers "do we overrun". A negative-looking answer to either shows up as **Invalid** rather than being clamped, so an event that ended before its planned end is visible instead of averaged away.

---

### Statuses

Every maintenance event gets one of these outcomes per measurement. Only **Recorded** writes a metric point.

| Status | What It Means |
|--------|---------------|
| **Recorded** | Both anchors resolved and the duration is meaningful. This is the only status that produces a number. |
| **Pending** | An anchor has not happened yet but still can - the event is mid-flight. The only status that changes on its own. |
| **Not Applicable** | An anchor can never resolve for this event: the state was skipped, the timestamp was never filled in, or the referenced state has been deleted. No point is written, so a skipped milestone does not drag the average down. |
| **Invalid** | Both anchors resolved but the end precedes the start. Someone's recorded timestamps disagree with each other. Surfaced rather than clamped to zero. |

---

### Key and Metric Name

The **Key** is permanent. Every recorded point is written under \`oneuptime.scheduled-maintenance.measurement.<key>\`, so changing the key would orphan all the history behind it. To rename a measurement for humans, change the **Name** instead - that is what appears on charts and on the event page.
`;

const ScheduledMaintenanceMeasurementsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<ScheduledMaintenanceMeasurement>
        modelType={ScheduledMaintenanceMeasurement}
        id="scheduled-maintenance-measurements-table"
        name="Settings > Scheduled Maintenance Measurements"
        userPreferencesKey="scheduled-maintenance-measurements-table"
        saveFilterProps={{
          tableId: "scheduled-maintenance-measurements-table",
        }}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        isViewable={false}
        cardProps={{
          title: "Scheduled Maintenance Measurements",
          description:
            "Define named durations between two points in a maintenance event's life - start delay, overrun, time to resolve. Each one is computed automatically and charted as its own metric.",
        }}
        helpContent={{
          title: "How Scheduled Maintenance Measurements Work",
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
            getElement: (
              item: ScheduledMaintenanceMeasurement,
            ): ReactElement => {
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
            placeholder: "Start Delay",
            validation: {
              minLength: 2,
            },
            description:
              "Human readable name. This is what appears on charts and on the maintenance event page.",
          },
          {
            field: {
              key: true,
            },
            title: "Key",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "start-delay",
            description:
              "Permanent, machine readable identifier. It is used to build the metric name (oneuptime.scheduled-maintenance.measurement.<key>) that every recorded point is written under and that charts query, so it cannot be changed once created - changing it would orphan all the history. To rename a measurement, change the Name instead.",
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder:
              "How long after the planned start time the maintenance actually began.",
          },
          {
            field: {
              startAnchorType: true,
            },
            title: "Start Anchor",
            sectionTitle: "Start Anchor",
            sectionDescription:
              "Where the measurement starts. Pick a timestamp on the event, or the moment a state was entered.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
              ScheduledMaintenanceMeasurementAnchorType,
            ),
            required: true,
            placeholder: "Scheduled Starts At",
          },
          {
            field: {
              startScheduledMaintenanceState: true,
            },
            title: "Start Maintenance State",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: ScheduledMaintenanceState,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Maintenance State",
            description:
              "The measurement starts when the event enters this state.",
            showIf: (
              values: FormValues<ScheduledMaintenanceMeasurement>,
            ): boolean => {
              return (
                values.startAnchorType ===
                ScheduledMaintenanceMeasurementAnchorType.StateEntered
              );
            },
          },
          {
            field: {
              startScheduledMaintenanceStateRole: true,
            },
            title: "Start Maintenance State Role",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
              ScheduledMaintenanceStateRole,
            ),
            required: false,
            placeholder: "Ongoing",
            description:
              "The measurement starts when whichever state carries this role is entered. Keeps working if you rename or replace that state.",
            showIf: (
              values: FormValues<ScheduledMaintenanceMeasurement>,
            ): boolean => {
              return (
                values.startAnchorType ===
                ScheduledMaintenanceMeasurementAnchorType.StateRoleEntered
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
              "Which entry to use when the state is entered more than once. First uses the earliest; Last follows a rescheduled event to its final entry.",
            showIf: (
              values: FormValues<ScheduledMaintenanceMeasurement>,
            ): boolean => {
              return (
                values.startAnchorType ===
                  ScheduledMaintenanceMeasurementAnchorType.StateEntered ||
                values.startAnchorType ===
                  ScheduledMaintenanceMeasurementAnchorType.StateRoleEntered
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
              "Where the measurement ends. If the end never happens for an event, the measurement reads Not Applicable and no number is recorded.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
              ScheduledMaintenanceMeasurementAnchorType,
            ),
            required: true,
            placeholder: "State Role Entered",
          },
          {
            field: {
              endScheduledMaintenanceState: true,
            },
            title: "End Maintenance State",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: ScheduledMaintenanceState,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Maintenance State",
            description:
              "The measurement ends when the event enters this state.",
            showIf: (
              values: FormValues<ScheduledMaintenanceMeasurement>,
            ): boolean => {
              return (
                values.endAnchorType ===
                ScheduledMaintenanceMeasurementAnchorType.StateEntered
              );
            },
          },
          {
            field: {
              endScheduledMaintenanceStateRole: true,
            },
            title: "End Maintenance State Role",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
              ScheduledMaintenanceStateRole,
            ),
            required: false,
            placeholder: "Ended",
            description:
              "The measurement ends when whichever state carries this role is entered.",
            showIf: (
              values: FormValues<ScheduledMaintenanceMeasurement>,
            ): boolean => {
              return (
                values.endAnchorType ===
                ScheduledMaintenanceMeasurementAnchorType.StateRoleEntered
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
            showIf: (
              values: FormValues<ScheduledMaintenanceMeasurement>,
            ): boolean => {
              return (
                values.endAnchorType ===
                  ScheduledMaintenanceMeasurementAnchorType.StateEntered ||
                values.endAnchorType ===
                  ScheduledMaintenanceMeasurementAnchorType.StateRoleEntered
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
              "The aggregation this measurement's chart defaults to. Sum is deliberately absent - summing durations across events produces a number with no meaning.",
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

export default ScheduledMaintenanceMeasurementsPage;
