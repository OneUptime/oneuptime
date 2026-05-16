import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import Navigation from "Common/UI/Utils/Navigation";
import OnCallDutyPolicyLabelRule from "Common/Models/DatabaseModels/OnCallDutyPolicyLabelRule";
import OnCallDutyPolicyScheduleLabelRule from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLabelRule";
import IncomingCallPolicyLabelRule from "Common/Models/DatabaseModels/IncomingCallPolicyLabelRule";
import Label from "Common/Models/DatabaseModels/Label";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";

const policyDocumentation: string = `
### How On-Call Policy Label Rules Work

On-Call Policy Label Rules attach labels to an on-call policy automatically when it matches your criteria — so you don't have to remember to tag new policies.

### Match Criteria

A rule matches a policy only when **all** specified criteria pass. Empty criteria are skipped.

- **On-Call Policy Labels** (prerequisite) — any-of
- **Name / Description Pattern** — case-insensitive regex

### Action

When a rule matches, every label listed in \`Labels to Add\` is attached to the policy. Already-attached labels are not duplicated. Multiple matching rules all fire — the union of their labels ends up attached.
`;

const scheduleDocumentation: string = `
### How On-Call Schedule Label Rules Work

On-Call Schedule Label Rules attach labels to an on-call schedule automatically when it matches your criteria.

### Match Criteria

A rule matches a schedule only when **all** specified criteria pass. Empty criteria are skipped.

- **On-Call Schedule Labels** (prerequisite) — any-of
- **Name / Description Pattern** — case-insensitive regex

### Action

When a rule matches, every label listed in \`Labels to Add\` is attached to the schedule. Already-attached labels are not duplicated. Multiple matching rules all fire — the union of their labels ends up attached.
`;

const incomingCallDocumentation: string = `
### How Incoming Call Policy Label Rules Work

Incoming Call Policy Label Rules attach labels to an incoming call policy automatically when it matches your criteria.

### Match Criteria

A rule matches a policy only when **all** specified criteria pass. Empty criteria are skipped.

- **Incoming Call Policy Labels** (prerequisite) — any-of
- **Name / Description Pattern** — case-insensitive regex

### Action

When a rule matches, every label listed in \`Labels to Add\` is attached to the policy. Already-attached labels are not duplicated. Multiple matching rules all fire — the union of their labels ends up attached.
`;

const OnCallPolicyLabelRulesTable: FunctionComponent = (): ReactElement => {
  return (
    <ModelTable<OnCallDutyPolicyLabelRule>
      modelType={OnCallDutyPolicyLabelRule}
      id="on-call-policy-label-rules-table"
      name="Settings > On-Call Policy Label Rules"
      userPreferencesKey="on-call-policy-label-rules-table"
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "On-Call Policy Label Rules",
        description:
          "Auto-attach labels when matching on-call policies are created.",
      }}
      helpContent={{
        title: "How On-Call Policy Label Rules Work",
        description: "Match on-call policies and attach labels automatically.",
        markdown: policyDocumentation,
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
          getElement: (item: OnCallDutyPolicyLabelRule): ReactElement => {
            return item.isEnabled ? (
              <Pill color={Green} text="Enabled" />
            ) : (
              <Pill color={Red} text="Disabled" />
            );
          },
        },
      ]}
      viewPageRoute={Navigation.getCurrentRoute()}
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
          placeholder: "Tag matching on-call policies",
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
          field: { onCallDutyPolicyLabels: true },
          title: "On-Call Policy Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Only trigger for on-call policies that already have at least one of these labels. Leave empty to skip the filter.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select On-Call Policy Labels (optional)",
        },
        {
          field: { onCallDutyPolicyNamePattern: true },
          title: "On-Call Policy Name Pattern",
          stepId: "match-criteria",
          sectionTitle: "Match by Pattern",
          sectionDescription:
            "Case-insensitive regex matched against the on-call policy name and description.",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "prod-.*",
        },
        {
          field: { onCallDutyPolicyDescriptionPattern: true },
          title: "On-Call Policy Description Pattern",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "production|critical",
        },
        {
          field: { labelsToAdd: true },
          title: "Labels to Add",
          stepId: "labels",
          sectionTitle: "Labels to Attach",
          sectionDescription:
            "When this rule matches, every selected label is attached to the on-call policy. Already-attached labels are not duplicated.",
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

const OnCallScheduleLabelRulesTable: FunctionComponent = (): ReactElement => {
  return (
    <ModelTable<OnCallDutyPolicyScheduleLabelRule>
      modelType={OnCallDutyPolicyScheduleLabelRule}
      id="on-call-schedule-label-rules-table"
      name="Settings > On-Call Schedule Label Rules"
      userPreferencesKey="on-call-schedule-label-rules-table"
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "On-Call Schedule Label Rules",
        description:
          "Auto-attach labels when matching on-call schedules are created.",
      }}
      helpContent={{
        title: "How On-Call Schedule Label Rules Work",
        description: "Match on-call schedules and attach labels automatically.",
        markdown: scheduleDocumentation,
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
          getElement: (
            item: OnCallDutyPolicyScheduleLabelRule,
          ): ReactElement => {
            return item.isEnabled ? (
              <Pill color={Green} text="Enabled" />
            ) : (
              <Pill color={Red} text="Disabled" />
            );
          },
        },
      ]}
      viewPageRoute={Navigation.getCurrentRoute()}
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
          placeholder: "Tag matching on-call schedules",
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
          field: { onCallDutyPolicyScheduleLabels: true },
          title: "On-Call Schedule Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Only trigger for on-call schedules that already have at least one of these labels. Leave empty to skip the filter.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Label,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select On-Call Schedule Labels (optional)",
        },
        {
          field: { onCallDutyPolicyScheduleNamePattern: true },
          title: "On-Call Schedule Name Pattern",
          stepId: "match-criteria",
          sectionTitle: "Match by Pattern",
          sectionDescription:
            "Case-insensitive regex matched against the on-call schedule name and description.",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "weekend-.*",
        },
        {
          field: { onCallDutyPolicyScheduleDescriptionPattern: true },
          title: "On-Call Schedule Description Pattern",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.Text,
          required: false,
          placeholder: "production|rotation",
        },
        {
          field: { labelsToAdd: true },
          title: "Labels to Add",
          stepId: "labels",
          sectionTitle: "Labels to Attach",
          sectionDescription:
            "When this rule matches, every selected label is attached to the on-call schedule. Already-attached labels are not duplicated.",
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

const IncomingCallPolicyLabelRulesTable: FunctionComponent =
  (): ReactElement => {
    return (
      <ModelTable<IncomingCallPolicyLabelRule>
        modelType={IncomingCallPolicyLabelRule}
        id="incoming-call-policy-label-rules-table"
        name="Settings > Incoming Call Policy Label Rules"
        userPreferencesKey="incoming-call-policy-label-rules-table"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        createEditModalWidth={ModalWidth.Large}
        cardProps={{
          title: "Incoming Call Policy Label Rules",
          description:
            "Auto-attach labels when matching incoming call policies are created.",
        }}
        helpContent={{
          title: "How Incoming Call Policy Label Rules Work",
          description:
            "Match incoming call policies and attach labels automatically.",
          markdown: incomingCallDocumentation,
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
            getElement: (item: IncomingCallPolicyLabelRule): ReactElement => {
              return item.isEnabled ? (
                <Pill color={Green} text="Enabled" />
              ) : (
                <Pill color={Red} text="Disabled" />
              );
            },
          },
        ]}
        viewPageRoute={Navigation.getCurrentRoute()}
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
            placeholder: "Tag matching incoming call policies",
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
            field: { incomingCallPolicyLabels: true },
            title: "Incoming Call Policy Labels",
            stepId: "match-criteria",
            sectionTitle: "Match by Attributes",
            sectionDescription:
              "Only trigger for incoming call policies that already have at least one of these labels. Leave empty to skip the filter.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Incoming Call Policy Labels (optional)",
          },
          {
            field: { incomingCallPolicyNamePattern: true },
            title: "Incoming Call Policy Name Pattern",
            stepId: "match-criteria",
            sectionTitle: "Match by Pattern",
            sectionDescription:
              "Case-insensitive regex matched against the incoming call policy name and description.",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "support-.*",
          },
          {
            field: { incomingCallPolicyDescriptionPattern: true },
            title: "Incoming Call Policy Description Pattern",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "billing|support",
          },
          {
            field: { labelsToAdd: true },
            title: "Labels to Add",
            stepId: "labels",
            sectionTitle: "Labels to Attach",
            sectionDescription:
              "When this rule matches, every selected label is attached to the incoming call policy. Already-attached labels are not duplicated.",
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

const OnCallDutyLabelRulesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <Tabs
        tabs={[
          {
            name: "On-Call Policies",
            children: <OnCallPolicyLabelRulesTable />,
          },
          {
            name: "On-Call Schedules",
            children: <OnCallScheduleLabelRulesTable />,
          },
          {
            name: "Incoming Call Policies",
            children: <IncomingCallPolicyLabelRulesTable />,
          },
        ]}
        onTabChange={() => {}}
      />
    </Fragment>
  );
};

export default OnCallDutyLabelRulesPage;
