import RuleSettingsPageProps from "../../RuleSettingsPageProps";
import PageMap from "../../../Utils/PageMap";
import RuleViewPageUtil from "../../../Utils/RuleViewPage";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import LabelRuleTable from "Common/UI/Components/LabelRule/LabelRuleTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import MessageQueueLabelRule from "Common/Models/DatabaseModels/MessageQueueLabelRule";
import React, { FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import Label from "Common/Models/DatabaseModels/Label";

const messageQueueLabelDocumentation: string = `
### How Queue Label Rules Work

Queue Label Rules attach labels to a queue automatically when it matches your criteria — so you don't have to remember to tag new queues.

### Match Criteria

A rule matches a queue only when **all** specified criteria pass. Empty criteria are skipped.

- **Queue Labels** (prerequisite) — any-of
- **Queue Name**, **Queue Description**, **Messaging System** — text, or a regular expression or \`*\` wildcard pattern

### Matching Discovered Queues

Discovered queues are named after their destination (\`orders.created\`), so the condition **Queue Name** starts with \`orders.\` covers every queue for that destination. **Messaging System** is compared with both the queue's OpenTelemetry value (\`kafka\`, \`rabbitmq\`, \`aws_sqs\`) and its display name (\`Apache Kafka\`, \`RabbitMQ\`, \`Amazon SQS\`), so the condition **Messaging System** equals \`kafka\` (or matches the pattern \`^kafka$\`) covers every Kafka topic.

### Action

When a rule matches, every label listed in \`Labels to Add\` is attached to the queue. Already-attached labels are not duplicated. Multiple matching rules all fire — the union of their labels ends up attached.
`;

const MessageQueueLabelRulesPage: FunctionComponent<RuleSettingsPageProps> = (
  props: RuleSettingsPageProps,
): ReactElement => {
  return (
    <LabelRuleTable<MessageQueueLabelRule>
      modelType={MessageQueueLabelRule}
      viewRuleId={RuleViewPageUtil.getViewRuleId(props, MessageQueueLabelRule)}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.MESSAGE_QUEUES_SETTINGS_LABEL_RULES,
      )}
      getRuleViewRoute={(rule: MessageQueueLabelRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.MESSAGE_QUEUES_SETTINGS_LABEL_RULES_VIEW,
          rule,
        );
      }}
      id="message-queue-label-rules-table"
      name="Settings > Queue Label Rules"
      userPreferencesKey="message-queue-label-rules-table"
      saveFilterProps={{
        tableId: "message-queue-label-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Queue Label Rules",
        description: "Auto-attach labels when matching queues are created.",
      }}
      helpContent={{
        title: "How Queue Label Rules Work",
        description: "Match queues and attach labels automatically.",
        markdown: messageQueueLabelDocumentation,
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
          getElement: (item: MessageQueueLabelRule): ReactElement => {
            return item.isEnabled ? (
              <Pill color={Green} text="Enabled" />
            ) : (
              <Pill color={Red} text="Disabled" />
            );
          },
        },
      ]}
      formSteps={[
        { title: "Basic Info", id: "basic-info" },
        { title: "Match Criteria", id: "match-criteria", columns: 2 },
        { title: "Labels", id: "labels", columns: 2 },
      ]}
      formFields={[
        {
          field: { name: true },
          title: "Name",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "Tag matching queues",
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
          description: "Enable or disable this rule.",
        },
        {
          field: { messageQueueLabels: true },
          title: "Queue Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Only trigger for queues that already have at least one of these labels. Leave empty to skip the filter.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Queue Labels (optional)",
        },
        {
          field: { messageQueueNamePattern: true },
          title: "Queue Name",
          stepId: "match-criteria",
          sectionTitle: "Match by Pattern",
          sectionDescription:
            "Case-insensitive regexes, each matched against the queue's name, description or messaging system. Discovered queues are named after their destination, so ^orders\\. matches every queue whose name starts with orders. — match the broker with the messaging system pattern.",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "^orders\\.",
        },
        {
          field: { messageQueueDescriptionPattern: true },
          title: "Queue Description",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "production|critical",
        },
        {
          field: { messageQueueSystemPattern: true },
          title: "Messaging System",
          stepId: "match-criteria",
          description:
            "Matched against the OpenTelemetry messaging.system value (kafka, rabbitmq, aws_sqs, servicebus, ...) and its display name (Apache Kafka, RabbitMQ, Amazon SQS, Azure Service Bus, ...). ^kafka$ matches every Kafka topic.",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "^kafka$",
        },
        {
          field: { labelsToAdd: true },
          title: "Labels to Add",
          stepId: "labels",
          sectionTitle: "Labels to Attach",
          sectionDescription:
            "When this rule matches, every selected label is attached to the queue. Already-attached labels are not duplicated.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Labels",
        },
      ]}
      showRefreshButton={true}
    />
  );
};

export default MessageQueueLabelRulesPage;
