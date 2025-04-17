import React, { FunctionComponent, ReactElement } from "react";
import IncidentNotificationRule from "Common/Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import AlertNotificationRule from "Common/Types/Workspace/NotificationRules/NotificationRuleTypes/AlertNotificationRule";
import ScheduledMaintenanceNotificationRule from "Common/Types/Workspace/NotificationRules/NotificationRuleTypes/ScheduledMaintenanceNotificationRule";
import MonitorNotificationRule from "Common/Types/Workspace/NotificationRules/NotificationRuleTypes/MonitorNotificationRule";
import NotificationRuleEventType from "Common/Types/Workspace/NotificationRules/EventType";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import FieldType from "Common/UI/Components/Types/FieldType";
import Field from "Common/UI/Components/Detail/Field";
import Detail from "Common/UI/Components/Detail/Detail";
import NotificationRuleConditions from "./NotificationRuleViewConditions";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import ObjectID from "Common/Types/ObjectID";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Label from "Common/Models/DatabaseModels/Label";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import TeamsElement from "../../Team/TeamsElement";
import UsersElement from "../../User/Users";

export interface ComponentProps {
  value:
    | IncidentNotificationRule
    | AlertNotificationRule
    | ScheduledMaintenanceNotificationRule
    | MonitorNotificationRule;
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
}

const NotificationRuleViewElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  let detailFields: Array<
    Field<
      | IncidentNotificationRule
      | AlertNotificationRule
      | ScheduledMaintenanceNotificationRule
      | MonitorNotificationRule
    >
  > = [
    {
      key: "filters",
      title: "",
      fieldType: FieldType.Element,
      getElement: () => {
        if (
          props.value.filters === undefined ||
          props.value.filters.length === 0
        ) {
          return (
            <div className="text-gray-700 text-sm">
              No filters have been set. This rule will be executed for all{" "}
              {props.eventType}
            </div>
          );
        }

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
            filterCondition={props.value.filterCondition}
            criteriaFilters={props.value.filters}
          />
        );
      },
    },
    {
      key: "shouldPostToExistingChannel",
      title: `Post to Existing ${props.workspaceType} Channel`,
      description: `When above conditions are met, post to an existing ${props.workspaceType} channel.`,
      fieldType: FieldType.Boolean,
    },
    {
      key: "existingChannelNames",
      title: `Existing ${props.workspaceType} Channel Name to Post To`,
      description: `Please provide the name of the ${props.workspaceType} channel you want to post to.`,
      fieldType: FieldType.Text,
      showIf: (
        formValue:
          | IncidentNotificationRule
          | AlertNotificationRule
          | ScheduledMaintenanceNotificationRule
          | MonitorNotificationRule,
      ) => {
        return Boolean(formValue.shouldPostToExistingChannel) || false;
      },
    },
  ];

  let archiveTitle: string = `Archive ${props.workspaceType} Channel`;
  let archiveDescription: string = `When above conditions are met, archive the ${props.workspaceType} channel.`;

  if (props.eventType === NotificationRuleEventType.Monitor) {
    archiveTitle = `Archive ${props.workspaceType} Channel Automatically`;
    archiveDescription = `Archive the ${props.workspaceType} channel automatically when the monitor is deleted.`;
  }

  if (props.eventType === NotificationRuleEventType.ScheduledMaintenance) {
    archiveTitle = `Archive ${props.workspaceType} Channel Automatically`;
    archiveDescription = `Archive the ${props.workspaceType} channel automatically when the scheduled maintenance is completed.`;
  }

  // incident.
  if (props.eventType === NotificationRuleEventType.Incident) {
    archiveTitle = `Archive ${props.workspaceType} Channel Automatically`;
    archiveDescription = `Archive the ${props.workspaceType} channel automatically when the incident is resolved.`;
  }

  // alert
  if (props.eventType === NotificationRuleEventType.Alert) {
    archiveTitle = `Archive ${props.workspaceType} Channel Automatically`;
    archiveDescription = `Archive the ${props.workspaceType} channel automatically when the alert is resolved.`;
  }

  const incidentAlertMaintenanceFields: Array<
    Field<
      | IncidentNotificationRule
      | AlertNotificationRule
      | ScheduledMaintenanceNotificationRule
    >
  > = [
    {
      key: "shouldCreateNewChannel",
      title: `Create ${props.workspaceType} Channel`,
      description: `When above conditions are met, create a new ${props.workspaceType} channel.`,
      fieldType: FieldType.Boolean,
    },
    {
      key: "newChannelTemplateName",
      title: `${props.workspaceType} Channel Template Name`,
      description: `If your new channel name is "oneuptime-${props.eventType?.toLowerCase()}-", then we will append the ${props.eventType} in the end so, it'll look like "oneuptime-${props.eventType?.toLowerCase()}-X".`,
      fieldType: FieldType.Text,
      placeholder: `oneuptime-${props.eventType?.toLowerCase()}-`,
      showIf: (
        formValue:
          | IncidentNotificationRule
          | AlertNotificationRule
          | ScheduledMaintenanceNotificationRule,
      ) => {
        return formValue.shouldCreateNewChannel || false;
      },
    },
    {
      key: "shouldInviteOwnersToNewChannel",
      title: `Invite ${props.eventType} owners to new ${props.workspaceType} Channel`,
      description: `When new ${props.workspaceType} channel is created, invite ${props.eventType} owners.`,
      fieldType: FieldType.Boolean,
      showIf: (
        formValue:
          | IncidentNotificationRule
          | AlertNotificationRule
          | ScheduledMaintenanceNotificationRule,
      ) => {
        return formValue.shouldCreateNewChannel || false;
      },
    },
    {
      key: "inviteTeamsToNewChannel",
      title: `Invite Teams to New ${props.workspaceType} Channel`,
      description: `When new ${props.workspaceType} channel is created, invite these teams.`,
      fieldType: FieldType.Element,
      showIf: (
        formValue:
          | IncidentNotificationRule
          | AlertNotificationRule
          | ScheduledMaintenanceNotificationRule,
      ) => {
        return formValue.shouldCreateNewChannel || false;
      },
      getElement: () => {
        const selectedTeams: Array<Team> = props.teams.filter((i: Team) => {
          return (
            props.value as
              | IncidentNotificationRule
              | AlertNotificationRule
              | ScheduledMaintenanceNotificationRule
          ).inviteTeamsToNewChannel?.find((j: ObjectID) => {
            return j.toString() === i._id!.toString();
          });
        });

        return <TeamsElement teams={selectedTeams} />;
      },
    },
    {
      key: "inviteUsersToNewChannel",
      title: `Invite Users to New ${props.workspaceType} Channel`,
      description: `When new ${props.workspaceType} channel is created, invite these users.`,
      fieldType: FieldType.Element,
      showIf: (
        formValue:
          | IncidentNotificationRule
          | AlertNotificationRule
          | ScheduledMaintenanceNotificationRule,
      ) => {
        return formValue.shouldCreateNewChannel || false;
      },
      getElement: () => {
        const selectedUsers: Array<User> = props.users.filter((i: User) => {
          return (
            props.value as
              | IncidentNotificationRule
              | AlertNotificationRule
              | ScheduledMaintenanceNotificationRule
          ).inviteUsersToNewChannel?.find((j: ObjectID) => {
            return j.toString() === i._id!.toString();
          });
        });

        return <UsersElement users={selectedUsers} />;
      },
    },

    // archive channel automatically
    {
      key: "archiveChannelAutomatically",
      title: archiveTitle,
      description: archiveDescription,
      fieldType: FieldType.Boolean,
      showIf: (
        formValue:
          | IncidentNotificationRule
          | AlertNotificationRule
          | ScheduledMaintenanceNotificationRule,
      ) => {
        return formValue.shouldCreateNewChannel || false;
      },
    },
  ];

  detailFields = detailFields.concat(
    incidentAlertMaintenanceFields as Field<
      | IncidentNotificationRule
      | AlertNotificationRule
      | ScheduledMaintenanceNotificationRule
      | MonitorNotificationRule
    >[],
  );

  if (
    props.eventType === NotificationRuleEventType.Alert ||
    props.eventType === NotificationRuleEventType.Incident
  ) {
    const alertIncidentField: Array<
      Field<AlertNotificationRule | IncidentNotificationRule>
    > = [
      {
        key: "shouldAutomaticallyInviteOnCallUsersToNewChannel",
        title: `Automatically Invite On Call Users to New ${props.workspaceType} Channel`,
        description: `If this is enabled then all on call users will be invited to the new ${props.workspaceType} channel as they are alerted.`,
        fieldType: FieldType.Boolean,
        showIf: (
          formValue: IncidentNotificationRule | AlertNotificationRule,
        ) => {
          return formValue.shouldCreateNewChannel || false;
        },
      },
    ];

    detailFields = detailFields.concat(
      alertIncidentField as Field<
        | IncidentNotificationRule
        | AlertNotificationRule
        | ScheduledMaintenanceNotificationRule
        | MonitorNotificationRule
      >[],
    );
  }

  return (
    <Detail<
      | IncidentNotificationRule
      | AlertNotificationRule
      | ScheduledMaintenanceNotificationRule
      | MonitorNotificationRule
    >
      item={props.value}
      fields={detailFields}
    />
  );
};

export default NotificationRuleViewElement;
