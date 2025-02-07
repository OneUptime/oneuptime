import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import SlackNotificationRule from "Common/Types/ServiceProvider/NotificationRules/SlackNotificationRule";
import NotificationRuleEventType from "Common/Types/ServiceProvider/NotificationRules/EventType";
import ServiceProviderType from "Common/Types/ServiceProvider/ServiceProviderType";
import BasicForm from "Common/UI/Components/Forms/BasicForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import React, { FunctionComponent, ReactElement } from "react";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import NotificationRuleConditions from "./NotificationRuleConditions";
import NotificationRuleCondition from "Common/Types/ServiceProvider/NotificationRules/NotificationRuleCondition";
import Field from "Common/UI/Components/Forms/Types/Field";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";

export interface ComponentProps {
  initialValue?: undefined | SlackNotificationRule;
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
  serviceProviderType: ServiceProviderType;
  teams: Array<Team>;
  users: Array<User>;
}

const NotificaitonRuleForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  let formFields: Array<Field<SlackNotificationRule>> = [];

  if (props.serviceProviderType === ServiceProviderType.Slack) {
    formFields = [
      {
        field: {
          filterCondition: true,
        },
        title: "Filter Condition",
        fieldType: FormFieldSchemaType.RadioButton,
        required: true,
        dropdownOptions:
          DropdownUtil.getDropdownOptionsFromEnum(FilterCondition),
      },
      {
        field: {
          filters: true,
        },
        title: "Filters",
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
                    ...props.initialValue!,
                    filters: value,
                  });
                }
              }}
              initialValue={props.initialValue?.filters || []}
            />
          );
        },
      },
      {
        field: {
          shouldCreateSlackChannel: true,
        },
        title: "Create Slack Channel",
        fieldType: FormFieldSchemaType.Toggle,
        required: false,
      },
      {
        field: {
          inviteTeamsToNewSlackChannel: true,
        },
        title: "Invite Teams to New Slack Channel",
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
        field: {
          shouldPostToExistingSlackChannel: true,
        },
        title: "Post to Existing Slack Channel",
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
        required: false,
        showIf: (formValue: FormValues<SlackNotificationRule>) => {
          return formValue.shouldPostToExistingSlackChannel || false;
        },
      },
    ];
  }

  return (
    <BasicForm
      initialValue={props.initialValue}
      onChange={props.onChange}
      fields={formFields}
    />
  );
};

export default NotificaitonRuleForm;
