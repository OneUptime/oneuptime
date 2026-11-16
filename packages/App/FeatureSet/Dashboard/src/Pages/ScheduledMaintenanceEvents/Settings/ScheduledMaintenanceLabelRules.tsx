import RuleSettingsPageProps from "../../RuleSettingsPageProps";
import PageMap from "../../../Utils/PageMap";
import RuleViewPageUtil from "../../../Utils/RuleViewPage";
import {
  getInheritingLabelRuleActionFields,
  getLabelRuleFormSteps,
} from "../../../Utils/Form/ResourceRuleForm";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import LabelRuleTable from "Common/UI/Components/LabelRule/LabelRuleTable";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import ScheduledMaintenanceLabelRule from "Common/Models/DatabaseModels/ScheduledMaintenanceLabelRule";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Label from "Common/Models/DatabaseModels/Label";

const scheduledMaintenanceLabelDocumentation: string = `
A label rule labels every new maintenance event it matches: with the labels it names and, if you like, the labels of the monitors, hosts, clusters and services the event affects.

## How It Works

- Rules run as each maintenance event is created. To label events you already have, open a rule and select **Run Now**.
- Every rule that matches adds its labels. A label the event already has is not added twice, and a rule never takes a label away.
- A disabled rule does not run.

## Match Criteria

Add conditions on the event, such as its monitors, labels or title, and choose whether all of them or any one must match.

## Labels a Rule Copies

Under **Inherit Labels**, a rule can also copy every label of the event's monitors, and of the hosts, Kubernetes clusters, Docker hosts, Podman hosts and services it affects. A rule that copies labels needs no labels of its own.
`;

const ScheduledMaintenanceLabelRulesPage: FunctionComponent<
  RuleSettingsPageProps
> = (props: RuleSettingsPageProps): ReactElement => {
  return (
    <Fragment>
      <LabelRuleTable<ScheduledMaintenanceLabelRule>
        modelType={ScheduledMaintenanceLabelRule}
        viewRuleId={RuleViewPageUtil.getViewRuleId(
          props,
          ScheduledMaintenanceLabelRule,
        )}
        listRoute={RuleViewPageUtil.getListRoute(
          PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_LABEL_RULES,
        )}
        getRuleViewRoute={(rule: ScheduledMaintenanceLabelRule): Route => {
          return RuleViewPageUtil.getRuleViewRoute(
            PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_LABEL_RULE_VIEW,
            rule,
          );
        }}
        id="scheduled-maintenance-label-rules-table"
        name="Settings > Scheduled Maintenance Label Rules"
        userPreferencesKey="scheduled-maintenance-label-rules-table"
        saveFilterProps={{
          tableId: "scheduled-maintenance-label-rules-table",
        }}
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        createEditModalWidth={ModalWidth.Large}
        cardProps={{
          title: "Scheduled Maintenance Label Rules",
          description:
            "Auto-attach labels to new maintenance events that match, including labels from their monitors and infrastructure.",
        }}
        helpContent={{
          title: "How Scheduled Maintenance Label Rules Work",
          description:
            "Match events and attach labels (explicit and inherited) automatically.",
          markdown: scheduledMaintenanceLabelDocumentation,
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
            getElement: (item: ScheduledMaintenanceLabelRule): ReactElement => {
              return item.isEnabled ? (
                <Pill color={Green} text="Enabled" />
              ) : (
                <Pill color={Red} text="Disabled" />
              );
            },
          },
        ]}
        formSteps={getLabelRuleFormSteps<ScheduledMaintenanceLabelRule>()}
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
          ...getInheritingLabelRuleActionFields<ScheduledMaintenanceLabelRule>(
            "scheduledMaintenance",
          ),
        ]}
        showRefreshButton={true}
      />
    </Fragment>
  );
};

export default ScheduledMaintenanceLabelRulesPage;
