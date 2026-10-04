import RuleSettingsPageProps from "../../RuleSettingsPageProps";
import PageMap from "../../../Utils/PageMap";
import RuleViewPageUtil from "../../../Utils/RuleViewPage";
import {
  getOwnerRuleActionFields,
  getOwnerRuleFormSteps,
} from "../../../Utils/Form/ResourceRuleForm";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import RuleTable from "Common/UI/Components/RuleRun/RuleTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import MessageQueueOwnerRule from "Common/Models/DatabaseModels/MessageQueueOwnerRule";
import React, { FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import Label from "Common/Models/DatabaseModels/Label";

const messageQueueOwnerDocumentation: string = `
### How Queue Owner Rules Work

Queue Owner Rules add owner users and teams to a queue automatically when it matches your criteria — without anyone having to remember to assign owners.

### Match Criteria

A rule matches a queue only when **all** specified criteria pass. Empty criteria are skipped.

- **Queue Labels** — any-of (M2M)
- **Queue Name**, **Queue Description**, **Messaging System** — text, or a regular expression or \`*\` wildcard pattern

### Matching Discovered Queues

Discovered queues are named after their destination (\`orders.created\`), so the condition **Queue Name** starts with \`orders.\` covers every queue for that destination. **Messaging System** is compared with both the queue's OpenTelemetry value (\`kafka\`, \`rabbitmq\`, \`aws_sqs\`) and its display name (\`Apache Kafka\`, \`RabbitMQ\`, \`Amazon SQS\`), so the condition **Messaging System** equals \`kafka\` (or matches the pattern \`^kafka$\`) covers every Kafka topic.

### Action

When a rule matches, every user and team listed on the rule is added as an owner. Already-assigned owners are not duplicated. If \`Notify Owners\` is enabled (default), added owners are notified. Multiple matching rules all fire — the union of their owners ends up assigned.
`;

const MessageQueueOwnerRulesPage: FunctionComponent<RuleSettingsPageProps> = (
  props: RuleSettingsPageProps,
): ReactElement => {
  return (
    <RuleTable<MessageQueueOwnerRule>
      modelType={MessageQueueOwnerRule}
      viewRuleId={RuleViewPageUtil.getViewRuleId(props, MessageQueueOwnerRule)}
      listRoute={RuleViewPageUtil.getListRoute(
        PageMap.MESSAGE_QUEUES_SETTINGS_OWNER_RULES,
      )}
      getRuleViewRoute={(rule: MessageQueueOwnerRule): Route => {
        return RuleViewPageUtil.getRuleViewRoute(
          PageMap.MESSAGE_QUEUES_SETTINGS_OWNER_RULES_VIEW,
          rule,
        );
      }}
      id="message-queue-owner-rules-table"
      name="Settings > Queue Owner Rules"
      userPreferencesKey="message-queue-owner-rules-table"
      saveFilterProps={{
        tableId: "message-queue-owner-rules-table",
      }}
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "Queue Owner Rules",
        description:
          "Auto-assign owner users and teams when matching queues are created.",
      }}
      helpContent={{
        title: "How Queue Owner Rules Work",
        description: "Match queues and add owner users/teams automatically.",
        markdown: messageQueueOwnerDocumentation,
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
          getElement: (item: MessageQueueOwnerRule): ReactElement => {
            return item.isEnabled ? (
              <Pill color={Green} text="Enabled" />
            ) : (
              <Pill color={Red} text="Disabled" />
            );
          },
        },
      ]}
      formSteps={getOwnerRuleFormSteps<MessageQueueOwnerRule>()}
      formFields={[
        {
          field: { messageQueueLabels: true },
          title: "Queue Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Filter queues by labels. Leave empty to skip the filter.",
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
        ...getOwnerRuleActionFields<MessageQueueOwnerRule>(),
      ]}
      showRefreshButton={true}
    />
  );
};

export default MessageQueueOwnerRulesPage;
