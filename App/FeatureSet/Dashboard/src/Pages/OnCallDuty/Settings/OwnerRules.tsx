import PageComponentProps from "../../PageComponentProps";
import ProjectUser from "../../../Utils/ProjectUser";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import Navigation from "Common/UI/Utils/Navigation";
import OnCallDutyPolicyOwnerRule from "Common/Models/DatabaseModels/OnCallDutyPolicyOwnerRule";
import OnCallDutyPolicyScheduleOwnerRule from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleOwnerRule";
import IncomingCallPolicyOwnerRule from "Common/Models/DatabaseModels/IncomingCallPolicyOwnerRule";
import Label from "Common/Models/DatabaseModels/Label";
import Team from "Common/Models/DatabaseModels/Team";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";

const policyDocumentation: string = `
### How On-Call Policy Owner Rules Work

On-Call Policy Owner Rules add owner users and teams to an on-call policy automatically when it matches your criteria — without anyone having to remember to assign owners.

### Match Criteria

A rule matches a policy only when **all** specified criteria pass. Empty criteria are skipped.

- **On-Call Policy Labels** — any-of (M2M)
- **Name / Description Pattern** — case-insensitive regex

### Action

When a rule matches, every user and team listed on the rule is added as an owner. Already-assigned owners are not duplicated. If \`Notify Owners\` is enabled (default), added owners are notified. Multiple matching rules all fire — the union of their owners ends up assigned.
`;

const scheduleDocumentation: string = `
### How On-Call Schedule Owner Rules Work

On-Call Schedule Owner Rules add owner users and teams to an on-call schedule automatically when it matches your criteria.

### Match Criteria

A rule matches a schedule only when **all** specified criteria pass. Empty criteria are skipped.

- **On-Call Schedule Labels** — any-of (M2M)
- **Name / Description Pattern** — case-insensitive regex

### Action

When a rule matches, every user and team listed on the rule is added as an owner. Already-assigned owners are not duplicated. If \`Notify Owners\` is enabled (default), added owners are notified.
`;

const incomingCallDocumentation: string = `
### How Incoming Call Policy Owner Rules Work

Incoming Call Policy Owner Rules add owner users and teams to an incoming call policy automatically when it matches your criteria.

### Match Criteria

A rule matches a policy only when **all** specified criteria pass. Empty criteria are skipped.

- **Incoming Call Policy Labels** — any-of (M2M)
- **Name / Description Pattern** — case-insensitive regex

### Action

When a rule matches, every user and team listed on the rule is added as an owner. Already-assigned owners are not duplicated. If \`Notify Owners\` is enabled (default), added owners are notified.
`;

const OnCallPolicyOwnerRulesTable: FunctionComponent = (): ReactElement => {
  return (
    <ModelTable<OnCallDutyPolicyOwnerRule>
      modelType={OnCallDutyPolicyOwnerRule}
      id="on-call-policy-owner-rules-table"
      name="Settings > On-Call Policy Owner Rules"
      userPreferencesKey="on-call-policy-owner-rules-table"
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "On-Call Policy Owner Rules",
        description:
          "Auto-assign owner users and teams when matching on-call policies are created.",
      }}
      helpContent={{
        title: "How On-Call Policy Owner Rules Work",
        description:
          "Match on-call policies and add owner users/teams automatically.",
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
          getElement: (item: OnCallDutyPolicyOwnerRule): ReactElement => {
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
        { title: "Owners", id: "owners", columns: 2 },
      ]}
      formFields={[
        {
          field: { name: true },
          title: "Name",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "Assign team to matching on-call policies",
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
          field: { notifyOwners: true },
          title: "Notify Owners",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          description:
            "Notify owners when they are added by this rule. Disable to add silently.",
        },
        {
          field: { onCallDutyPolicyLabels: true },
          title: "On-Call Policy Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Filter on-call policies by labels. Leave empty to skip the filter.",
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
          field: { ownerTeams: true },
          title: "Owner Teams",
          stepId: "owners",
          sectionTitle: "Owners to Assign",
          sectionDescription:
            "When this rule matches, every selected user and team is added as an owner. Already-assigned owners are not duplicated.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Team,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Teams",
        },
        {
          field: { ownerUsers: true },
          title: "Owner Users",
          stepId: "owners",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          fetchDropdownOptions: async () => {
            return await ProjectUser.fetchProjectUsersAsDropdownOptions(
              ProjectUtil.getCurrentProjectId()!,
            );
          },
          required: false,
          placeholder: "Select Users",
        },
      ]}
      showRefreshButton={true}
    />
  );
};

const OnCallScheduleOwnerRulesTable: FunctionComponent = (): ReactElement => {
  return (
    <ModelTable<OnCallDutyPolicyScheduleOwnerRule>
      modelType={OnCallDutyPolicyScheduleOwnerRule}
      id="on-call-schedule-owner-rules-table"
      name="Settings > On-Call Schedule Owner Rules"
      userPreferencesKey="on-call-schedule-owner-rules-table"
      isDeleteable={true}
      isEditable={true}
      isCreateable={true}
      createEditModalWidth={ModalWidth.Large}
      cardProps={{
        title: "On-Call Schedule Owner Rules",
        description:
          "Auto-assign owner users and teams when matching on-call schedules are created.",
      }}
      helpContent={{
        title: "How On-Call Schedule Owner Rules Work",
        description:
          "Match on-call schedules and add owner users/teams automatically.",
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
            item: OnCallDutyPolicyScheduleOwnerRule,
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
        { title: "Owners", id: "owners", columns: 2 },
      ]}
      formFields={[
        {
          field: { name: true },
          title: "Name",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "Assign team to matching on-call schedules",
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
          field: { notifyOwners: true },
          title: "Notify Owners",
          stepId: "basic-info",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
          description:
            "Notify owners when they are added by this rule. Disable to add silently.",
        },
        {
          field: { onCallDutyPolicyScheduleLabels: true },
          title: "On-Call Schedule Labels",
          stepId: "match-criteria",
          sectionTitle: "Match by Attributes",
          sectionDescription:
            "Filter on-call schedules by labels. Leave empty to skip the filter.",
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
          field: { ownerTeams: true },
          title: "Owner Teams",
          stepId: "owners",
          sectionTitle: "Owners to Assign",
          sectionDescription:
            "When this rule matches, every selected user and team is added as an owner. Already-assigned owners are not duplicated.",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          dropdownModal: {
            type: Team,
            labelField: "name",
            valueField: "_id",
          },
          required: false,
          placeholder: "Select Teams",
        },
        {
          field: { ownerUsers: true },
          title: "Owner Users",
          stepId: "owners",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          fetchDropdownOptions: async () => {
            return await ProjectUser.fetchProjectUsersAsDropdownOptions(
              ProjectUtil.getCurrentProjectId()!,
            );
          },
          required: false,
          placeholder: "Select Users",
        },
      ]}
      showRefreshButton={true}
    />
  );
};

const IncomingCallPolicyOwnerRulesTable: FunctionComponent =
  (): ReactElement => {
    return (
      <ModelTable<IncomingCallPolicyOwnerRule>
        modelType={IncomingCallPolicyOwnerRule}
        id="incoming-call-policy-owner-rules-table"
        name="Settings > Incoming Call Policy Owner Rules"
        userPreferencesKey="incoming-call-policy-owner-rules-table"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        createEditModalWidth={ModalWidth.Large}
        cardProps={{
          title: "Incoming Call Policy Owner Rules",
          description:
            "Auto-assign owner users and teams when matching incoming call policies are created.",
        }}
        helpContent={{
          title: "How Incoming Call Policy Owner Rules Work",
          description:
            "Match incoming call policies and add owner users/teams automatically.",
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
            getElement: (item: IncomingCallPolicyOwnerRule): ReactElement => {
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
          { title: "Owners", id: "owners", columns: 2 },
        ]}
        formFields={[
          {
            field: { name: true },
            title: "Name",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "Assign team to matching incoming call policies",
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
            field: { notifyOwners: true },
            title: "Notify Owners",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description:
              "Notify owners when they are added by this rule. Disable to add silently.",
          },
          {
            field: { incomingCallPolicyLabels: true },
            title: "Incoming Call Policy Labels",
            stepId: "match-criteria",
            sectionTitle: "Match by Attributes",
            sectionDescription:
              "Filter incoming call policies by labels. Leave empty to skip the filter.",
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
            field: { ownerTeams: true },
            title: "Owner Teams",
            stepId: "owners",
            sectionTitle: "Owners to Assign",
            sectionDescription:
              "When this rule matches, every selected user and team is added as an owner. Already-assigned owners are not duplicated.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Team,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Teams",
          },
          {
            field: { ownerUsers: true },
            title: "Owner Users",
            stepId: "owners",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            fetchDropdownOptions: async () => {
              return await ProjectUser.fetchProjectUsersAsDropdownOptions(
                ProjectUtil.getCurrentProjectId()!,
              );
            },
            required: false,
            placeholder: "Select Users",
          },
        ]}
        showRefreshButton={true}
      />
    );
  };

const OnCallDutyOwnerRulesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <Tabs
        tabs={[
          {
            name: "On-Call Policies",
            children: <OnCallPolicyOwnerRulesTable />,
          },
          {
            name: "On-Call Schedules",
            children: <OnCallScheduleOwnerRulesTable />,
          },
          {
            name: "Incoming Call Policies",
            children: <IncomingCallPolicyOwnerRulesTable />,
          },
        ]}
        onTabChange={() => {}}
      />
    </Fragment>
  );
};

export default OnCallDutyOwnerRulesPage;
