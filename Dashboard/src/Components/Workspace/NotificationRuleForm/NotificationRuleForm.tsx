import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import IncidentNotificationRule from "Common/Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
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
import BaseNotificationRule from "Common/Types/Workspace/NotificationRules/BaseNotificationRule";
import AlertNotificationRule from "Common/Types/Workspace/NotificationRules/NotificationRuleTypes/AlertNotificationRule";
import ScheduledMaintenanceNotificationRule from "Common/Types/Workspace/NotificationRules/NotificationRuleTypes/ScheduledMaintenanceNotificationRule";
import MonitorNotificationRule from "Common/Types/Workspace/NotificationRules/NotificationRuleTypes/MonitorNotificationRule";
import WorkspaceUtil from "../../../Utils/Workspace/Workspace";

export interface ComponentProps {
  value?: undefined | IncidentNotificationRule;
  onChange?: undefined | ((value: IncidentNotificationRule) => void);
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
  const workspaceDisplayName = WorkspaceUtil.getWorkspaceDisplayName(props.workspaceType);

  type NotificationRulesType =
    | IncidentNotificationRule
    | AlertNotificationRule
    | ScheduledMaintenanceNotificationRule
    | MonitorNotificationRule;
  type CreateNewSlackChannelNotificationRuleType =
    | IncidentNotificationRule
    | AlertNotificationRule
    | ScheduledMaintenanceNotificationRule;

  let formFields: Array<Field<NotificationRulesType>> = [];

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
        shouldPostToExistingChannel: true,
      },
      title: `Post to Existing ${workspaceDisplayName} Channel`,
      description: `When above conditions are met, post to an existing ${workspaceDisplayName} channel.`,
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
    },
    {
      field: {
        existingChannelNames: true,
      },
      title: `Existing ${workspaceDisplayName} Channel Name to Post To`,
      description: `Please provide the name of the ${workspaceDisplayName} channel you want to post to.`,
      fieldType: FormFieldSchemaType.Text,
      placeholder: `#channel-name, #general, etc.`,
      required: true,
      showIf: (formValue: FormValues<BaseNotificationRule>) => {
        return Boolean(formValue.shouldPostToExistingChannel) || false;
      },
    },
  ];

  let archiveTitle: string = `Archive ${workspaceDisplayName} Channel`;
  let archiveDescription: string = `When above conditions are met, archive the ${workspaceDisplayName} channel.`;

  if (props.eventType === NotificationRuleEventType.Monitor) {
    archiveTitle = `Archive ${workspaceDisplayName} Channel Automatically`;
    archiveDescription = `Archive the ${workspaceDisplayName} channel automatically when the monitor is deleted.`;
  }

  if (props.eventType === NotificationRuleEventType.ScheduledMaintenance) {
    archiveTitle = `Archive ${workspaceDisplayName} Channel Automatically`;
    archiveDescription = `Archive the ${workspaceDisplayName} channel automatically when the scheduled maintenance is completed.`;
  }

  if (props.eventType === NotificationRuleEventType.OnCallDutyPolicy) {
    archiveTitle = `Archive ${workspaceDisplayName} Channel Automatically`;
    archiveDescription = `Archive the ${workspaceDisplayName} channel automatically when the on call duty policy is deleted.`;
  }

  // incident.
  if (props.eventType === NotificationRuleEventType.Incident) {
    archiveTitle = `Archive ${workspaceDisplayName} Channel Automatically`;
    archiveDescription = `Archive the ${workspaceDisplayName} channel automatically when the incident is resolved.`;
  }

  // alert
  if (props.eventType === NotificationRuleEventType.Alert) {
    archiveTitle = `Archive ${workspaceDisplayName} Channel Automatically`;
    archiveDescription = `Archive the ${workspaceDisplayName} channel automatically when the alert is resolved.`;
  }

  formFields = formFields.concat([
    {
      field: {
        shouldCreateNewChannel: true,
      },
      title: `Create ${workspaceDisplayName} Channel`,
      description: `When above conditions are met, create a new ${workspaceDisplayName} channel.`,
      fieldType: FormFieldSchemaType.Toggle,
      showHorizontalRuleAbove: true,
      required: false,
    },
    {
      field: {
        newChannelTemplateName: true,
      },
      title: `New ${workspaceDisplayName} Channel Name`,
      showIf: (formValue: FormValues<NotificationRulesType>) => {
        return (
          (formValue as CreateNewSlackChannelNotificationRuleType)
            .shouldCreateNewChannel || false
        );
      },
      required: true,
      description: `If your new channel name is "oneuptime-${props.eventType.toLowerCase()}-", then we will append the ${props.eventType === NotificationRuleEventType.Monitor ? "monitor name" : `${props.eventType} number`} in the end so, it'll look like "oneuptime-${props.eventType.toLowerCase()}-${props.eventType === NotificationRuleEventType.Monitor ? "monitor-name" : "X"}".`,
      fieldType: FormFieldSchemaType.Text,
      placeholder: `oneuptime-${props.eventType.toLowerCase()}-`,
    },
    {
      field: {
        shouldInviteOwnersToNewChannel: true,
      },
      showIf: (formValue: FormValues<NotificationRulesType>) => {
        return (
          (formValue as CreateNewSlackChannelNotificationRuleType)
            .shouldCreateNewChannel || false
        );
      },
      title: `Invite ${props.eventType} owners to new ${workspaceDisplayName} Channel`,
      description: `When new ${workspaceDisplayName} channel is created, invite ${props.eventType} owners.`,
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
    },
    {
      field: {
        inviteTeamsToNewChannel: true,
      },
      title: `Invite Teams to New ${workspaceDisplayName} Channel`,
      description: `When new ${workspaceDisplayName} channel is created, invite these teams.`,
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
      required: false,
      showIf: (formValue: FormValues<NotificationRulesType>) => {
        return (
          (formValue as CreateNewSlackChannelNotificationRuleType)
            .shouldCreateNewChannel || false
        );
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
        inviteUsersToNewChannel: true,
      },
      title: `Invite Users to New ${workspaceDisplayName} Channel`,
      description: `When new ${workspaceDisplayName} channel is created, invite these users.`,
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
      required: false,
      showIf: (formValue: FormValues<NotificationRulesType>) => {
        return (
          (formValue as CreateNewSlackChannelNotificationRuleType)
            .shouldCreateNewChannel || false
        );
      },
      dropdownOptions: props.users.map((i: User) => {
        return {
          label: i.name?.toString() || i.email?.toString() || "",
          value: i._id!.toString()!,
        };
      }),
    },
    // automatically archive channel
    {
      field: {
        archiveChannelAutomatically: true,
      },
      title: archiveTitle,
      description: archiveDescription,
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      showIf: (formValue: FormValues<NotificationRulesType>) => {
        return (
          (formValue as CreateNewSlackChannelNotificationRuleType)
            .shouldCreateNewChannel || false
        );
      },
    },
  ]);

  // if alerts or incidents

  if (
    props.eventType === NotificationRuleEventType.Alert ||
    props.eventType === NotificationRuleEventType.Incident
  ) {
    formFields = formFields.concat([
      {
        field: {
          shouldAutomaticallyInviteOnCallUsersToNewChannel: true,
        },
        title: `Automatically Invite On Call Users to New ${workspaceDisplayName} Channel`,
        description: `If this is enabled then all on call users will be invited to the new ${workspaceDisplayName} channel as they are alerted.`,
        fieldType: FormFieldSchemaType.Checkbox,
        required: false,
        showIf: (formValue: FormValues<NotificationRulesType>) => {
          return (
            (formValue as CreateNewSlackChannelNotificationRuleType)
              .shouldCreateNewChannel || false
          );
        },
      },
    ]);
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
