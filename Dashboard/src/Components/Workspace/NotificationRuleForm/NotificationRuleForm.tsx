import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import SlackNotificationRule from "Common/Types/Workspace/NotificationRules/SlackNotificationRule";
import NotificationRuleEventType from "Common/Types/Workspace/NotificationRules/EventType";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import BasicForm from "Common/UI/Components/Forms/BasicForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import React, { FunctionComponent, ReactElement } from "react";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import NotificationRuleConditions from "./NotificationRuleConditions";
import NotificationRuleCondition from "Common/Types/Workspace/NotificationRules/NotificationRuleCondition";
import Field from "Common/UI/Components/Forms/Types/Field";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";

export interface ComponentProps {
  value?: undefined | SlackNotificationRule;
  onChange?: undefined | ((value: SlackNotificationRule) => void);
  eventType: NotificationRuleEventType;
  monitors: Array<Monitor>;
  labels: Array<Label>;
  alertStates: Array<AlertState>;
  alertSeverities: Array<AlertSeverity>;
  incidentSeverities: Array<IncidentSeverity>;
  incidentStates: Array<IncidentState>;
  scheduledMaintenanceStates: Array<ScheduledMaintenanceState>;
  monitorStatus: Array<MonitorStatus>;
  workspaceType: WorkspaceType;
  teams: Array<Team>;
  users: Array<User>;
  error?: string | undefined;
}

const NotificationRuleForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  let formFields: Array<Field<SlackNotificationRule>> = [];

  if (props.workspaceType === WorkspaceType.Slack) {
    formFields = [
      {
        field: {
          filterCondition: true,
        },
        title: "Filter Condition",
        fieldType: FormFieldSchemaType.RadioButton,
        required: true,
        radioButtonOptions: [
          {
            title: "Any",
            value: FilterCondition.Any,
          },
          {
            title: "All",

            value: FilterCondition.All,
          },
        ],
      },
      {
        field: {
          filters: true,
        },
        title: "Conditions",
        fieldType: FormFieldSchemaType.CustomComponent,
        required: false,
        getCustomElement: () => {
          return (
            <NotificationRuleConditions
              eventType={props.eventType}
              monitors={props.monitors}
              labels={props.labels}
              alertStates={props.alertStates}
              alertSeverities={props.alertSeverities}
              incidentSeverities={props.incidentSeverities}
              incidentStates={props.incidentStates}
              scheduledMaintenanceStates={props.scheduledMaintenanceStates}
              monitorStatus={props.monitorStatus}
              onChange={(value: Array<NotificationRuleCondition>) => {
                if (props.onChange) {
                  props.onChange({
                    ...props.value!,
                    filters: value,
                  });
                }
              }}
              value={props.value?.filters || []}
            />
          );
        },
      },
      {
        field: {
          shouldCreateSlackChannel: true,
        },
        title: "Create Slack Channel",
        description:
          "When above conditions are met, create a new slack channel.",
        fieldType: FormFieldSchemaType.Toggle,
        required: false,
      },
      {
        field: {
          inviteTeamsToNewSlackChannel: true,
        },
        title: "Invite Teams to New Slack Channel",
        description: "When new slack channel is created, invite these teams.",
        fieldType: FormFieldSchemaType.MultiSelectDropdown,
        required: false,
        showIf: (formValue: FormValues<SlackNotificationRule>) => {
          return formValue.shouldCreateSlackChannel || false;
        },
        dropdownOptions: props.teams.map((i: Team) => {
          return {
            label: i.name?.toString() || "",
            value: i._id!.toString()!,
          };
        }),
      },
      {
        field: {
          inviteUsersToNewSlackChannel: true,
        },
        title: "Invite Users to New Slack Channel",
        description: "When new slack channel is created, invite these users.",
        fieldType: FormFieldSchemaType.MultiSelectDropdown,
        required: false,
        showIf: (formValue: FormValues<SlackNotificationRule>) => {
          return formValue.shouldCreateSlackChannel || false;
        },
        dropdownOptions: props.users.map((i: User) => {
          return {
            label: i.name?.toString() || "",
            value: i._id!.toString()!,
          };
        }),
      },
      {
        field: {
          shouldAutomaticallyInviteOnCallUsersToNewSlackChannel: true,
        },
        title: "Automatically Invite On Call Users to New Slack Channel",
        description:
          "If this is enabled then all on call users will be invited to the new slack channel as they are alerted.",
        fieldType: FormFieldSchemaType.Checkbox,
        required: false,
        showIf: (formValue: FormValues<SlackNotificationRule>) => {
          return formValue.shouldCreateSlackChannel || false;
        },
      },
      {
        showHorizontalRuleAbove: true,
        field: {
          shouldPostToExistingSlackChannel: true,
        },
        title: "Post to Existing Slack Channel",
        description:
          "When above conditions are met, post to an existing slack channel.",
        fieldType: FormFieldSchemaType.Toggle,
        required: false,
      },
      {
        field: {
          existingSlackChannelName: true,
        },
        title: "Existing Slack Channel Name to Post To",
        description:
          "Please provide the name of the slack channel you want to post to.",
        fieldType: FormFieldSchemaType.Text,
        placeholder: "#channel-name, #general, etc.",
        required: false,
        showIf: (formValue: FormValues<SlackNotificationRule>) => {
          return formValue.shouldPostToExistingSlackChannel || false;
        },
      },
    ];
  }

  return (
    <div>
      <BasicForm
        error={props.error}
        values={props.value}
        onChange={props.onChange}
        fields={formFields}
        hideSubmitButton={true}
      />
    </div>
  );
};

export default NotificationRuleForm;
