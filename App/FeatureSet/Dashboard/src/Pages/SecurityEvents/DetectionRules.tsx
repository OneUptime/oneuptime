import PageComponentProps from "../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Pill from "Common/UI/Components/Pill/Pill";
import { Green, Red } from "Common/Types/BrandColors";
import DetectionRule from "Common/Models/DatabaseModels/DetectionRule";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";

const documentationMarkdown: string = `
### How Detection Rules Work

Detection rules run **Sigma rules** against your ingested security events on a schedule. [Sigma](https://sigmahq.io/) is an open, vendor-neutral YAML format for describing log detections.

- Each rule is evaluated every *N* minutes over the events that arrived since the last evaluation.
- When a rule matches, it can **create an alert** and/or **write a Detection Finding** security event back into the event stream.
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

const DetectionRulesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
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
          fieldType: FormFieldSchemaType.Markdown,
          required: true,
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
