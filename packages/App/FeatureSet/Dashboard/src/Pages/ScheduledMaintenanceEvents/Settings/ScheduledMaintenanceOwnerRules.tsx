import EnabledPill from "Common/UI/Components/Pill/EnabledPill";
import RuleSettingsPageProps from "../../RuleSettingsPageProps";
import PageMap from "../../../Utils/PageMap";
import RuleViewPageUtil from "../../../Utils/RuleViewPage";
import {
  getInheritingOwnerRuleActionFields,
  getOwnerRuleFormSteps,
} from "../../../Utils/Form/ResourceRuleForm";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import RuleTable from "Common/UI/Components/RuleRun/RuleTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import FieldType from "Common/UI/Components/Types/FieldType";
import ScheduledMaintenanceOwnerRule from "Common/Models/DatabaseModels/ScheduledMaintenanceOwnerRule";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Label from "Common/Models/DatabaseModels/Label";

const scheduledMaintenanceOwnerDocumentation: string = `
An owner rule makes people and teams owners of every new maintenance event it matches, so each event has someone responsible for it from the start.

## How It Works

- Rules run as each maintenance event is created. To add owners to events you already have, open a rule and select **Run Now**.
- Every rule that matches adds its owners. An owner the event already has is not added twice.
- A disabled rule does not run.

## Match Criteria

Add conditions on the event, such as its monitors, labels or title, and choose whether all of them or any one must match.

## Owners a Rule Copies

Under **Inherit Owners**, a rule can also add the owners of the event's monitors, and of the hosts, Kubernetes clusters, Docker hosts, Podman hosts and services it affects.

## Telling the New Owners

With **Notify Owners** on (the default), the people and teams a rule adds are told they now own the event. Turn it off to add them quietly.
`;

const ScheduledMaintenanceOwnerRulesPage: FunctionComponent<
  RuleSettingsPageProps
> = (props: RuleSettingsPageProps): ReactElement => {
  return (
    <Fragment>
      <RuleTable<ScheduledMaintenanceOwnerRule>
        modelType={ScheduledMaintenanceOwnerRule}
        viewRuleId={RuleViewPageUtil.getViewRuleId(
          props,
          ScheduledMaintenanceOwnerRule,
        )}
        listRoute={RuleViewPageUtil.getListRoute(
          PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_OWNER_RULES,
        )}
        getRuleViewRoute={(rule: ScheduledMaintenanceOwnerRule): Route => {
          return RuleViewPageUtil.getRuleViewRoute(
            PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_OWNER_RULE_VIEW,
            rule,
          );
        }}
        id="scheduled-maintenance-owner-rules-table"
        name="Settings > Scheduled Maintenance Owner Rules"
        userPreferencesKey="scheduled-maintenance-owner-rules-table"
        saveFilterProps={{
          tableId: "scheduled-maintenance-owner-rules-table",
        }}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        createEditModalWidth={ModalWidth.Large}
        cardProps={{
          title: "Scheduled Maintenance Owner Rules",
          description:
            "Auto-assign owner users and teams when matching maintenance events are created.",
        }}
        helpContent={{
          title: "How Scheduled Maintenance Owner Rules Work",
          description:
            "Match maintenance events and add owner users/teams automatically.",
          markdown: scheduledMaintenanceOwnerDocumentation,
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
            getElement: (item: ScheduledMaintenanceOwnerRule): ReactElement => {
              return <EnabledPill isEnabled={item.isEnabled} />;
            },
          },
        ]}
        formSteps={getOwnerRuleFormSteps<ScheduledMaintenanceOwnerRule>()}
        formFields={[
          {
            field: { monitors: true },
            title: "Monitors",
            stepId: "match-criteria",
            sectionTitle: "Match by Attributes",
            sectionDescription:
              "Filter events by which monitor they affect and their labels. Leave a filter empty to skip it.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Monitor,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Monitors",
          },
          {
            field: { scheduledMaintenanceLabels: true },
            title: "Event Labels",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Select Event Labels",
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
            placeholder: "Select Monitor Labels",
          },
          {
            field: { titlePattern: true },
            title: "Event Title",
            stepId: "match-criteria",
            sectionTitle: "Match by Pattern",
            sectionDescription:
              "Case-insensitive regex matched against event and monitor text.",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "DB.*maintenance",
          },
          {
            field: { descriptionPattern: true },
            title: "Event Description",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "upgrade|migration",
          },
          {
            field: { monitorNamePattern: true },
            title: "Monitor Name",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "prod-.*",
          },
          {
            field: { monitorDescriptionPattern: true },
            title: "Monitor Description",
            stepId: "match-criteria",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "production|critical",
          },
          ...getInheritingOwnerRuleActionFields<ScheduledMaintenanceOwnerRule>(
            "scheduledMaintenance",
          ),
        ]}
        showRefreshButton={true}
      />
    </Fragment>
  );
};

export default ScheduledMaintenanceOwnerRulesPage;
