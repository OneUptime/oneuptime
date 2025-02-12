import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import IncidentNotificationRule from "Common/Types/Workspace/NotificationRules/IncidentNotificationRule";
import NotificationRuleEventType from "Common/Types/Workspace/NotificationRules/EventType";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import React, { FunctionComponent, ReactElement } from "react";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import NotificationRuleConditions from "./NotificationRuleViewConditions";
import Detail from "Common/UI/Components/Detail/Detail";
import FieldType from "Common/UI/Components/Types/FieldType";
import ObjectID from "Common/Types/ObjectID";
import TeamsElement from "../../Team/TeamsElement";
import UsersElement from "../../User/Users";
import Field from "Common/UI/Components/Detail/Field";

export interface ComponentProps {
  value: IncidentNotificationRule;
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

const NotificawtionRuleViewElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  let detailFields: Array<Field<IncidentNotificationRule>> = [];

  if (props.workspaceType === WorkspaceType.Slack) {
    detailFields = [
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
        key: "shouldCreateNewChannel",
        title: "Create Slack Channel",
        description:
          "If this is enabled then a new slack channel will be created for this rule.",
        fieldType: FieldType.Boolean,
      },
      {
        key: "inviteTeamsToNewChannel",
        title: "Invite Teams to New Slack Channel",
        description: "These teams will be invited to the new slack channel.",
        fieldType: FieldType.Element,
        showIf: (formValue: IncidentNotificationRule) => {
          return formValue.shouldCreateNewChannel;
        },
        getElement: () => {
          const selectedTeams: Array<Team> = props.teams.filter((i: Team) => {
            return props.value.inviteTeamsToNewChannel.find(
              (j: ObjectID) => {
                return j.toString() === i._id!.toString();
              },
            );
          });

          return <TeamsElement teams={selectedTeams} />;
        },
      },
      {
        key: "inviteUsersToNewChannel",
        title: "Invite Users to New Slack Channel",
        description: "These users will be invited to the new slack channel.",
        fieldType: FieldType.Element,
        getElement: () => {
          const selectedUsers: Array<User> = props.users.filter((i: User) => {
            return props.value.inviteTeamsToNewChannel.find(
              (j: ObjectID) => {
                return j.toString() === i._id!.toString();
              },
            );
          });

          return <UsersElement users={selectedUsers} />;
        },

        showIf: (formValue: IncidentNotificationRule) => {
          return formValue.shouldCreateNewChannel;
        },
      },
      {
        key: "shouldAutomaticallyInviteOnCallUsersToNewSlackChannel",
        title: "Automatically Invite On Call Users to New Slack Channel",
        description:
          "If this is enabled then all on call users will be invited to the new slack channel as they are alerted.",
        fieldType: FieldType.Boolean,

        showIf: (formValue: IncidentNotificationRule) => {
          return formValue.shouldCreateNewChannel;
        },
      },
      {
        key: "shouldPostToExistingChannel",
        title: "Post to Existing Slack Channel",
        description:
          "If this is enabled then the alert will be posted to an existing slack channel.",
        fieldType: FieldType.Boolean,
      },
      {
        key: "existingChannelNames",
        title: "Existing Slack Channel Name to Post To",
        description:
          "These slack channels will be updated when the rule is triggered.",
        fieldType: FieldType.Text,

        showIf: (formValue: IncidentNotificationRule) => {
          return formValue.shouldPostToExistingChannel;
        },
      },
    ];
  }

  return (
    <Detail<IncidentNotificationRule> item={props.value} fields={detailFields} />
  );
};

export default NotificawtionRuleViewElement;
