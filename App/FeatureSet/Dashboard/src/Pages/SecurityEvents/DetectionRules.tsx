import PageComponentProps from "../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red } from "Common/Types/BrandColors";
import DetectionRule from "Common/Models/DatabaseModels/DetectionRule";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import Route from "Common/Types/API/Route";
import Navigation from "Common/UI/Utils/Navigation";
import { VoidFunction } from "Common/Types/FunctionTypes";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import React, { FunctionComponent, ReactElement } from "react";

const documentationMarkdown: string = `
### How Detection Rules Work

Detection rules run **Sigma rules** against your ingested security events on a schedule. [Sigma](https://sigmahq.io/) is an open, vendor-neutral YAML format for describing log detections.

- Each rule is evaluated every *N* minutes over the events that arrived since the last evaluation.
- When a rule matches, it can **create an alert**, **open an incident** (off by default — incidents drive on-call, SLAs and status pages), and/or **write a Detection Finding** security event back into the event stream.
- **Group By Field** collapses matches that share a value (e.g. \`principalHost\`) into a single finding, so a noisy host raises one alert instead of hundreds.

---

### Example Sigma Rule

\`\`\`yaml
title: Failed logon burst
logsource:
  category: authentication
detection:
  selection:
    className: Authentication
    statusName: Failure
  condition: selection
level: high
\`\`\`

Fields referenced in the rule match the normalized OCSF columns of security events (\`className\`, \`severityName\`, \`statusName\`, \`principalUser\`, \`principalHost\`, \`attributes.<key>\`, ...).
`;

const DetectionRulesPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  /*
   * Same reseller-telemetry gate as every other Security Events tab —
   * detection rules run over telemetry-billed security events, so a plan
   * without telemetry features has nothing for them to evaluate.
   */
  const disableTelemetryForThisProject: boolean =
    props.currentProject?.reseller?.enableTelemetryFeatures === false;

  if (disableTelemetryForThisProject) {
    return (
      <ErrorMessage message="Looks like you have bought this plan from a reseller. It did not include telemetry features in your plan. Telemetry features are disabled for this project." />
    );
  }

  /*
   * The row action deep-links into the monitor create wizard, which
   * ModelTable's own permission gating never sees — so gate it here the
   * way MonitorTable gates its create button (issue #3306): a member who
   * cannot create monitors gets a disabled button that says why, not a
   * wizard that refuses at submit.
   */
  const monitorCreateGate: PermissionGateResult = PermissionGate.check(
    new Monitor(),
    ModelAction.Create,
  );

  return (
    <ModelTable<DetectionRule>
      modelType={DetectionRule}
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
      }}
      id="detection-rules-table"
      name="Security Events > Detection Rules"
      userPreferencesKey="detection-rules-table"
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      isViewable={false}
      createEditModalWidth={ModalWidth.Large}
      sortBy="name"
      sortOrder={SortOrder.Ascending}
      cardProps={{
        title: "Detection Rules",
        description:
          "Sigma rules evaluated on a schedule against your security events. Sigma is an open YAML format for describing detections — a matching rule can raise an alert and write a Detection Finding back into the event stream.",
      }}
      helpContent={{
        title: "How Detection Rules Work",
        description:
          "Understanding Sigma rules, evaluation intervals, grouping, and what happens on a match",
        markdown: documentationMarkdown,
      }}
      noItemsMessage={"No detection rules found."}
      createInitialValues={{
        isEnabled: true,
        evaluationIntervalInMinutes: 5,
        /*
         * Mirror the DB defaults (DetectionRule.ts): without these the
         * severity dropdowns' showIf sees undefined on a fresh create
         * form and hides fields whose toggles are actually on.
         */
        shouldCreateAlert: true,
        shouldWriteDetectionFinding: true,
        shouldCreateIncident: false,
      }}
      formSteps={[
        { title: "Basic Info", id: "basic-info" },
        { title: "Sigma Rule", id: "sigma-rule" },
        { title: "Evaluation", id: "evaluation" },
      ]}
      formFields={[
        {
          field: {
            name: true,
          },
          title: "Name",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "e.g. Failed logon burst",
          validation: {
            minLength: 2,
          },
        },
        {
          field: {
            description: true,
          },
          title: "Description",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.LongText,
          required: false,
          placeholder: "Describe what this rule detects.",
        },
        {
          field: {
            isEnabled: true,
          },
          title: "Enabled",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
        },
        {
          field: {
            sigmaRuleYaml: true,
          },
          title: "Sigma Rule (YAML)",
          stepId: "sigma-rule",
          description:
            "The Sigma rule to evaluate against incoming security events, in YAML.",
          /*
           * YAML, not Markdown. Markdown put a rich-text toolbar (Bold, H1)
           * over a Sigma rule, and the editor behind it round-trips its value
           * through HTML - which indentation-sensitive YAML does not survive.
           */
          fieldType: FormFieldSchemaType.YAML,
          required: true,
          placeholder:
            "Sigma rule YAML — title, logsource, detection and condition.",
        },
        {
          field: {
            evaluationIntervalInMinutes: true,
          },
          title: "Evaluation Interval (Minutes)",
          stepId: "evaluation",
          description: "How often this rule is evaluated, in minutes.",
          fieldType: FormFieldSchemaType.Number,
          required: true,
          placeholder: "e.g. 5",
        },
        {
          field: {
            groupByField: true,
          },
          title: "Group By Field",
          stepId: "evaluation",
          description:
            "Optional. Collapse matches that share this field's value into one finding (e.g. one alert per host).",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "principalHost",
        },
        {
          field: {
            shouldCreateAlert: true,
          },
          title: "Create Alert on Match",
          stepId: "evaluation",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
        },
        {
          field: {
            alertSeverity: true,
          },
          title: "Alert Severity",
          stepId: "evaluation",
          description:
            "Optional. Severity of alerts this rule opens. When unset, the Sigma rule's level is mapped onto this project's severities.",
          fieldType: FormFieldSchemaType.Dropdown,
          dropdownModal: {
            type: AlertSeverity,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Default from Sigma level",
          showIf: (model: FormValues<DetectionRule>): boolean => {
            return model.shouldCreateAlert === true;
          },
        },
        {
          field: {
            shouldCreateIncident: true,
          },
          title: "Create Incident on Match",
          stepId: "evaluation",
          description:
            "Incidents are the heavier machinery — on-call escalation, SLAs, status pages. Off by default; alerts usually suffice for detections.",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
        },
        {
          field: {
            incidentSeverity: true,
          },
          title: "Incident Severity",
          stepId: "evaluation",
          description:
            "Optional. Severity of incidents this rule opens. When unset, the Sigma rule's level is mapped onto this project's incident severities.",
          fieldType: FormFieldSchemaType.Dropdown,
          dropdownModal: {
            type: IncidentSeverity,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Default from Sigma level",
          showIf: (model: FormValues<DetectionRule>): boolean => {
            return model.shouldCreateIncident === true;
          },
        },
        {
          field: {
            shouldWriteDetectionFinding: true,
          },
          title: "Write Detection Finding on Match",
          stepId: "evaluation",
          description:
            "Write a Detection Finding security event back into the event stream when this rule matches.",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
        },
      ]}
      showRefreshButton={true}
      searchableFields={["name", "description"]}
      showViewIdButton={true}
      actionButtons={[
        {
          title: "Create Monitor",
          buttonStyleType: ButtonStyleType.NORMAL,
          icon: IconProp.AltGlobe,
          disabled: !monitorCreateGate.isAllowed,
          tooltip: monitorCreateGate.isAllowed
            ? "Create a Security Events monitor watching this rule's Detection Findings — alert on rate, not just occurrence."
            : monitorCreateGate.disabledReason ||
              "You do not have permission to create monitors.",
          onClick: (item: DetectionRule, onCompleteAction: VoidFunction) => {
            /*
             * Deep link, not an inline create: the monitor create page is
             * where the pay-as-you-go consent and the criteria builder
             * live, and a second door that skips either is not a door we
             * want. The page fetches the rule by id and pre-fills a
             * Security Events step scoped to this rule's findings.
             */
            Navigation.navigate(
              (
                RouteUtil.populateRouteParams(
                  RouteMap[PageMap.MONITOR_CREATE] as Route,
                ) as Route
              ).addQueryParams({
                detectionRuleId: item._id?.toString() || "",
              }),
            );
            onCompleteAction();
          },
        },
      ]}
      filters={[
        {
          field: {
            name: true,
          },
          type: FieldType.Text,
          title: "Name",
        },
        {
          field: {
            isEnabled: true,
          },
          type: FieldType.Boolean,
          title: "Enabled",
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
            isEnabled: true,
          },
          title: "Status",
          type: FieldType.Boolean,
          getElement: (item: DetectionRule): ReactElement => {
            if (item.isEnabled) {
              return <Pill color={Green} text="Enabled" />;
            }
            return <Pill color={Red} text="Disabled" />;
          },
        },
        {
          field: {
            evaluationIntervalInMinutes: true,
          },
          title: "Interval (Minutes)",
          type: FieldType.Number,
          noValueMessage: "-",
        },
        {
          field: {
            lastEvaluatedAt: true,
          },
          title: "Last Evaluated",
          type: FieldType.DateTime,
          noValueMessage: "Never",
        },
        {
          field: {
            lastMatchAt: true,
          },
          title: "Last Match",
          type: FieldType.DateTime,
          noValueMessage: "Never",
        },
        {
          field: {
            lastError: true,
          },
          title: "Last Error",
          type: FieldType.LongText,
          noValueMessage: "-",
        },
      ]}
    />
  );
};

export default DetectionRulesPage;
