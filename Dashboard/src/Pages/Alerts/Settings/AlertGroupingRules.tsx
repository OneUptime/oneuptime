import PageComponentProps from "../../PageComponentProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { ShowAs } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import AlertGroupingRule from "Common/Models/DatabaseModels/AlertGroupingRule";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { Green, Red } from "Common/Types/BrandColors";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Team from "Common/Models/DatabaseModels/Team";
import ProjectUser from "../../../Utils/ProjectUser";
import ProjectUtil from "Common/UI/Utils/Project";

const AlertGroupingRulesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <ModelTable<AlertGroupingRule>
        modelType={AlertGroupingRule}
        id="alert-grouping-rules-table"
        name="Settings > Alert Grouping Rules"
        userPreferencesKey="alert-grouping-rules-table"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        cardProps={{
          title: "Alert Grouping Rules",
          description:
            "Define rules to automatically group related alerts into episodes. Rules are evaluated in priority order - lower priority numbers are evaluated first.",
        }}
        sortBy="priority"
        sortOrder={SortOrder.Ascending}
        selectMoreFields={{
          priority: true,
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
              description: true,
            },
            title: "Description",
            type: FieldType.Text,
          },
          {
            field: {
              priority: true,
            },
            title: "Priority",
            type: FieldType.Number,
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Status",
            type: FieldType.Boolean,
            getElement: (item: AlertGroupingRule): ReactElement => {
              if (item.isEnabled) {
                return <Pill color={Green} text="Enabled" />;
              }
              return <Pill color={Red} text="Disabled" />;
            },
          },
          {
            field: {
              timeWindowMinutes: true,
            },
            title: "Time Window (min)",
            type: FieldType.Number,
          },
          {
            field: {
              inactivityTimeoutMinutes: true,
            },
            title: "Inactivity Timeout (min)",
            type: FieldType.Number,
          },
        ]}
        noItemsMessage={"No grouping rules found."}
        viewPageRoute={Navigation.getCurrentRoute()}
        formSteps={[
          {
            title: "Basic Info",
            id: "basic-info",
          },
          {
            title: "Time Settings",
            id: "time-settings",
          },
          {
            title: "Episode Template",
            id: "episode-template",
          },
          {
            title: "On-Call & Ownership",
            id: "on-call-ownership",
          },
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
            placeholder: "Critical Service Alerts",
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
            placeholder: "Groups all critical alerts from production services",
          },
          {
            field: {
              priority: true,
            },
            title: "Priority",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.Number,
            required: true,
            placeholder: "1",
            description:
              "Lower numbers have higher priority. Rules are evaluated in order.",
          },
          {
            field: {
              isEnabled: true,
            },
            title: "Enabled",
            stepId: "basic-info",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            description: "Enable or disable this grouping rule.",
          },
          {
            field: {
              timeWindowMinutes: true,
            },
            title: "Time Window (minutes)",
            stepId: "time-settings",
            fieldType: FormFieldSchemaType.Number,
            required: true,
            placeholder: "60",
            description:
              "Rolling window that determines how long an episode stays open for new alerts. Alerts arriving within this time gap of the last alert will be grouped into the same episode. For example, if set to 60 minutes, alerts will keep grouping as long as each new alert arrives within 60 minutes of the previous one.",
          },
          {
            field: {
              enableResolveDelay: true,
            },
            title: "Enable Resolve Delay",
            stepId: "time-settings",
            fieldType: FormFieldSchemaType.Checkbox,
            required: false,
            description:
              "Enable this to add a grace period before auto-resolving an episode after all its alerts are resolved. This helps prevent unnecessary state changes during alert flapping - when alerts rapidly toggle between triggered and resolved states. Without this, the episode would resolve immediately when alerts resolve, then potentially reopen moments later if the issue recurs.",
          },
          {
            field: {
              resolveDelayMinutes: true,
            },
            title: "Resolve Delay (minutes)",
            stepId: "time-settings",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "5",
            showIf: (model: AlertGroupingRule): boolean => {
              return model.enableResolveDelay === true;
            },
            description:
              "Number of minutes to wait after all alerts in the episode are resolved before automatically resolving the episode itself.",
          },
          {
            field: {
              enableReopenWindow: true,
            },
            title: "Enable Reopen Window",
            stepId: "time-settings",
            fieldType: FormFieldSchemaType.Checkbox,
            required: false,
            description:
              "Enable this to reopen recently resolved episodes instead of creating new ones when matching alerts arrive. This is useful for recurring issues - if a problem returns shortly after being resolved, it makes more sense to continue tracking it in the same episode rather than fragmenting the incident history across multiple episodes.",
          },
          {
            field: {
              reopenWindowMinutes: true,
            },
            title: "Reopen Window (minutes)",
            stepId: "time-settings",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "30",
            showIf: (model: AlertGroupingRule): boolean => {
              return model.enableReopenWindow === true;
            },
            description:
              "Time window after an episode is resolved during which a new matching alert will reopen that episode instead of creating a new one.",
          },
          {
            field: {
              enableInactivityTimeout: true,
            },
            title: "Enable Inactivity Timeout",
            stepId: "time-settings",
            fieldType: FormFieldSchemaType.Checkbox,
            required: false,
            description:
              "Enable this to automatically resolve episodes after a period of inactivity. This helps clean up stale episodes that are no longer receiving alerts, ensuring your active episode list stays current and relevant. Without this, episodes would remain open indefinitely until manually resolved.",
          },
          {
            field: {
              inactivityTimeoutMinutes: true,
            },
            title: "Inactivity Timeout (minutes)",
            stepId: "time-settings",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: "60",
            showIf: (model: AlertGroupingRule): boolean => {
              return model.enableInactivityTimeout === true;
            },
            description:
              "Number of minutes of inactivity (no new alerts added) after which the episode will be automatically resolved.",
          },
          {
            field: {
              episodeTitleTemplate: true,
            },
            title: "Episode Title Template",
            stepId: "episode-template",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "{alertSeverity} Alert Episode on {monitorName}",
            description:
              "Template for auto-generated episode titles. Use placeholders like {alertSeverity}, {monitorName}, {alertTitle}.",
          },
          {
            field: {
              onCallDutyPolicies: true,
            },
            title: "On-Call Duty Policies",
            stepId: "on-call-ownership",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: OnCallDutyPolicy,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            description:
              "On-call policies to execute when an episode is created with this rule.",
            placeholder: "Select On-Call Policies",
          },
          {
            field: {
              defaultAssignToTeam: true,
            },
            title: "Default Assign To Team",
            stepId: "on-call-ownership",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownModal: {
              type: Team,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            description:
              "Default team to assign episodes created by this rule.",
            placeholder: "Select Team",
          },
          {
            field: {
              defaultAssignToUser: true,
            },
            title: "Default Assign To User",
            stepId: "on-call-ownership",
            fieldType: FormFieldSchemaType.Dropdown,
            fetchDropdownOptions: async () => {
              return await ProjectUser.fetchProjectUsersAsDropdownOptions(
                ProjectUtil.getCurrentProjectId()!,
              );
            },
            required: false,
            description:
              "Default user to assign episodes created by this rule.",
            placeholder: "Select User",
          },
        ]}
        showRefreshButton={true}
        showAs={ShowAs.OrderedStatesList}
        orderedStatesListProps={{
          titleField: "name",
          descriptionField: "description",
          orderField: "priority",
          shouldAddItemInTheEnd: true,
        }}
      />
    </Fragment>
  );
};

export default AlertGroupingRulesPage;
