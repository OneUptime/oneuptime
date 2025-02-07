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
import React, { FunctionComponent, ReactElement } from "react";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import NotificationRuleConditions from "./NotificationRuleViewConditions";
import Detail from "Common/UI/Components/Detail/Detail";
import FieldType from "Common/UI/Components/Types/FieldType";
import ObjectID from "Common/Types/ObjectID";
import TeamsElement from "../../Team/TeamsElement";


export interface ComponentProps {
    value: SlackNotificationRule;
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
    return (
        <Detail<SlackNotificationRule>
            item={props.value}
            fields={[
                {
                    key: "filters",
                    title: "Filters",
                    fieldType: FieldType.Element,
                    getElement: () => {
                        return <NotificationRuleConditions
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
                    }
                },
                {
                    key: "shouldCreateSlackChannel",
                    title: "Create Slack Channel",
                    fieldType: FieldType.Boolean,
                },
                {
                    key: "inviteTeamsToNewSlackChannel",
                    title: "Invite Teams to New Slack Channel",
                    fieldType: FieldType.Element,
                    showIf: (formValue: SlackNotificationRule) => {
                        return formValue.shouldCreateSlackChannel;
                    },
                    getElement: () => {

                        const selectedTeams: Array<Team> = props.teams.filter((i: Team) => {
                            return props.value.inviteTeamsToNewSlackChannel.find((j: ObjectID) => {
                                return j.toString() === i._id!.toString();
                            })
                        });

                        return <TeamsElement teams={selectedTeams} />
                    }
                },
                {
                    key: "inviteUsersToNewSlackChannel",
                    title: "Invite Users to New Slack Channel",
                    fieldType: FieldType.Element,

                    showIf: (formValue: SlackNotificationRule) => {
                        return formValue.shouldCreateSlackChannel;
                    },

                },
                {
                    key: "shouldAutomaticallyInviteOnCallUsersToNewSlackChannel",
                    title: "Automatically Invite On Call Users to New Slack Channel",
                    description: "If this is enabled then all on call users will be invited to the new slack channel as they are alerted.",
                    fieldType: FieldType.Boolean,

                    showIf: (formValue: SlackNotificationRule) => {
                        return formValue.shouldCreateSlackChannel;
                    }
                },
                {
                    key: "shouldPostToExistingSlackChannel",
                    title: "Post to Existing Slack Channel",
                    fieldType: FieldType.Boolean,


                },
                {
                    key: "existingSlackChannelName",
                    title: "Existing Slack Channel Name to Post To",
                    description: "Please provide the name of the slack channel you want to post to.",
                    fieldType: FieldType.Text,

                    showIf: (formValue: SlackNotificationRule) => {
                        return formValue.shouldPostToExistingSlackChannel;
                    },
                }

            ]} />
    );
};

export default NotificaitonRuleForm;
