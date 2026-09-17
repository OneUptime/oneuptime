import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import AlertMeasurement from "Common/Models/DatabaseModels/AlertMeasurement";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import AlertMeasurementAnchorType from "Common/Types/Alerts/AlertMeasurementAnchorType";
import AlertStateRole from "Common/Types/Alerts/AlertStateRole";
import MeasurementAggregationType from "Common/Types/Measurement/MeasurementAggregationType";
import MeasurementOccurrence from "Common/Types/Measurement/MeasurementOccurrence";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";

const documentationMarkdown: string = `
### What a Measurement Is

A measurement is a named duration between two points in an alert's life - "Time to Acknowledge", "Time to Resolve", anything your team reports on. You define the two ends; OneUptime computes the duration for every alert and records it as a metric you can chart.

Nothing here is guessed. If one end of a measurement never happened for an alert, no number is written for that alert at all, so a skipped milestone cannot quietly pull an average towards zero.

\`\`\`mermaid
flowchart TD
    A[Measurement Definition<br/>start anchor + end anchor] --> B[Alert State Timeline<br/>and timestamp fields]
    B --> C{Both anchors resolved?}
    C -->|Yes, end after start| D[Computed Duration<br/>status: Recorded]
    C -->|Not yet, still possible| E[status: Pending<br/>no point written]
    C -->|Can never resolve| F[status: Not Applicable<br/>no point written]
    C -->|End before start| G[status: Invalid<br/>no point written]
    D --> H[Metric point written under<br/>oneuptime.alert.measurement.KEY]
    H --> I[Charts and dashboards]
\`\`\`

---

### Anchor Types

An anchor is where one end of the measurement sits in time. Alerts carry no declaredAt and have no postmortem, so the alert anchors are the incident set minus those two.

| Anchor Type | Resolves To |
|-------------|-------------|
| **Impact Started At** | When customer impact actually began. Recorded by a human on the alert; never inferred. An alert with this field blank reads Not Applicable rather than zero. |
| **Created At** | When the alert record was created in OneUptime. |
| **Timeline Start** | The first entry on the alert's state timeline, falling back to Created At. This is the origin the built-in alert metrics use, so a definition using it reproduces today's numbers exactly. |
| **State Entered** | The moment a specific alert state was entered, pinned by id. Pick the state below. |
| **State Role Entered** | The moment whichever state carries a role - Created, Acknowledged or Resolved - was entered. Resolves by flag rather than by id, so it keeps working when you rename or replace that state. |

For the two state-based anchors you also choose an **occurrence**. \`First\` matches the behaviour of the built-in metrics; \`Last\` is the opt-in for teams who want a reopened alert's measurement to move to the final resolution rather than pinning to the first one.

---

### Statuses

Every alert gets one of these outcomes per measurement. Only **Recorded** writes a metric point.

| Status | What It Means |
|--------|---------------|
| **Recorded** | Both anchors resolved and the duration is meaningful. This is the only status that produces a number. |
| **Pending** | An anchor has not happened yet but still can - the alert is mid-flight. The only status that changes on its own. |
| **Not Applicable** | An anchor can never resolve for this alert: the state was skipped, the timestamp was never filled in, or the referenced state has been deleted. No point is written, so a skipped milestone does not drag the average down. |
| **Invalid** | Both anchors resolved but the end precedes the start. Someone's recorded timestamps disagree with each other. Surfaced rather than clamped to zero. |

---

### Key and Metric Name

The **Key** is permanent. Every recorded point is written under \`oneuptime.alert.measurement.<key>\`, so changing the key would orphan all the history behind it. To rename a measurement for humans, change the **Name** instead - that is what appears on charts and on the alert page.
`;

const AlertMeasurementsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<AlertMeasurement>
        modelType={AlertMeasurement}
        id="alert-measurements-table"
        name="Settings > Alert Measurements"
        userPreferencesKey="alert-measurements-table"
        saveFilterProps={{
          tableId: "alert-measurements-table",
        }}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        isViewable={false}
        cardProps={{
          title: "Alert Measurements",
          description:
            "Define named durations between two points in an alert's life - Time to Acknowledge, Time to Resolve, and anything else your team reports on. Each one is computed automatically and charted as its own metric.",
        }}
        helpContent={{
          title: "How Alert Measurements Work",
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
            getElement: (item: AlertMeasurement): ReactElement => {
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
            placeholder: "Time to Acknowledge",
            validation: {
              minLength: 2,
            },
            description:
              "Human readable name. This is what appears on charts and on the alert page.",
          },
          {
            field: {
              key: true,
            },
            title: "Key",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "time-to-acknowledge",
            description:
              "Permanent, machine readable identifier. It is used to build the metric name (oneuptime.alert.measurement.<key>) that every recorded point is written under and that charts query, so it cannot be changed once created - changing it would orphan all the history. To rename a measurement, change the Name instead.",
          },
          {
            field: {
              description: true,
            },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder:
              "How long it took from the alert being created to someone acknowledging it.",
          },
          {
            field: {
              startAnchorType: true,
            },
            title: "Start Anchor",
            sectionTitle: "Start Anchor",
            sectionDescription:
              "Where the measurement starts. Pick a timestamp on the alert, or the moment a state was entered.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
              AlertMeasurementAnchorType,
            ),
            required: true,
            placeholder: "Timeline Start",
          },
          {
            field: {
              startAlertState: true,
            },
            title: "Start Alert State",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: AlertState,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Alert State",
            description:
              "The measurement starts when the alert enters this state.",
            showIf: (values: FormValues<AlertMeasurement>): boolean => {
              return (
                values.startAnchorType ===
                AlertMeasurementAnchorType.StateEntered
              );
            },
          },
          {
            field: {
              startAlertStateRole: true,
            },
            title: "Start Alert State Role",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions:
              DropdownUtil.getDropdownOptionsFromEnum(AlertStateRole),
            required: false,
            placeholder: "Acknowledged",
            description:
              "The measurement starts when whichever state carries this role is entered. Keeps working if you rename or replace that state.",
            showIf: (values: FormValues<AlertMeasurement>): boolean => {
              return (
                values.startAnchorType ===
                AlertMeasurementAnchorType.StateRoleEntered
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
              "Which entry to use when the state is entered more than once. First matches the built-in metrics; Last follows a reopened alert to its final entry.",
            showIf: (values: FormValues<AlertMeasurement>): boolean => {
              return (
                values.startAnchorType ===
                  AlertMeasurementAnchorType.StateEntered ||
                values.startAnchorType ===
                  AlertMeasurementAnchorType.StateRoleEntered
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
              "Where the measurement ends. If the end never happens for an alert, the measurement reads Not Applicable and no number is recorded.",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
              AlertMeasurementAnchorType,
            ),
            required: true,
            placeholder: "State Role Entered",
          },
          {
            field: {
              endAlertState: true,
            },
            title: "End Alert State",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: AlertState,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Alert State",
            description:
              "The measurement ends when the alert enters this state.",
            showIf: (values: FormValues<AlertMeasurement>): boolean => {
              return (
                values.endAnchorType === AlertMeasurementAnchorType.StateEntered
              );
            },
          },
          {
            field: {
              endAlertStateRole: true,
            },
            title: "End Alert State Role",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions:
              DropdownUtil.getDropdownOptionsFromEnum(AlertStateRole),
            required: false,
            placeholder: "Resolved",
            description:
              "The measurement ends when whichever state carries this role is entered.",
            showIf: (values: FormValues<AlertMeasurement>): boolean => {
              return (
                values.endAnchorType ===
                AlertMeasurementAnchorType.StateRoleEntered
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
            showIf: (values: FormValues<AlertMeasurement>): boolean => {
              return (
                values.endAnchorType ===
                  AlertMeasurementAnchorType.StateEntered ||
                values.endAnchorType ===
                  AlertMeasurementAnchorType.StateRoleEntered
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
              "The aggregation this measurement's chart defaults to. Sum is deliberately absent - summing durations across alerts produces a number with no meaning.",
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

export default AlertMeasurementsPage;
