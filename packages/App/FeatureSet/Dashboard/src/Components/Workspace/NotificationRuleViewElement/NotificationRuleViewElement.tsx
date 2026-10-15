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
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Label from "Common/Models/DatabaseModels/Label";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import {
  MicrosoftTeamsChat,
  MicrosoftTeamsTeam,
} from "Common/Models/DatabaseModels/WorkspaceProjectAuthToken";
import VideoCallConnection from "Common/Models/DatabaseModels/VideoCallConnection";
import VideoCallRuleSummary from "./VideoCallRuleSummary";
import { WorkspaceChannelNumberPrefixes } from "Common/Utils/Workspace/WorkspaceChannelName";
import { ChannelNameSummary } from "../NotificationRuleForm/ChannelNamePreview";
import NotificationRuleSummary from "../NotificationRuleForm/NotificationRuleSummary";
import {
  NO_CONDITIONS_SENTENCES,
  RULE_THEN_TITLE,
  RULE_WHEN_TITLE,
} from "../NotificationRuleForm/NotificationRuleCopy";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

/*
 * A WORKSPACE NOTIFICATION RULE'S CARD, AS SENTENCES.
 *
 *   When  Incident State · Contains Any · Acknowledged
 *   Then  - Creates a channel like #inc-42 for each incident.
 *         - Invites on-call responders as they are paged, the Incident
 *           Commander and other incident roles as they are assigned and
 *           owners as they are added.
 *         - Archives the channel when the incident is resolved.
 *         - Posts updates in #ops.
 *   Channel Name Prefix  No prefix   Example: #inc-42
 *   Video Call  ...
 *
 * It listed every switch the rule holds, Yes or No, a dozen rows a rule.
 */

type NotificationRulesType =
  | IncidentNotificationRule
  | AlertNotificationRule
  | ScheduledMaintenanceNotificationRule
  | MonitorNotificationRule;

export interface ComponentProps {
  value: NotificationRulesType;
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
  microsoftTeamsTeams?: Array<MicrosoftTeamsTeam>;
  microsoftTeamsChats?: Array<MicrosoftTeamsChat>;
  users: Array<User>;
  videoCallConnections?: Array<VideoCallConnection> | undefined;
  // For the example of the name of the channel the rule creates.
  numberPrefixes?: WorkspaceChannelNumberPrefixes | undefined;
  exampleRecordName?: string | undefined;
}

const NotificationRuleViewElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const fields: Array<Field<NotificationRulesType>> = [
    // Which records the rule is for.
    {
      key: "filters",
      title: RULE_WHEN_TITLE,
      fieldType: FieldType.Element,
      getElement: (): ReactElement => {
        if (!props.value.filters || props.value.filters.length === 0) {
          return (
            <div
              className="text-sm text-gray-700"
              data-testid="notification-rule-no-conditions"
            >
              {translator.translateText(
                NO_CONDITIONS_SENTENCES[props.eventType],
              )}
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
    // What it does with them.
    {
      key: "shouldPostToExistingChannel",
      title: RULE_THEN_TITLE,
      fieldType: FieldType.Element,
      getElement: (): ReactElement => {
        return (
          <NotificationRuleSummary
            rule={props.value as IncidentNotificationRule}
            eventType={props.eventType}
            workspaceType={props.workspaceType}
            users={props.users}
            teams={props.teams}
            microsoftTeamsTeams={props.microsoftTeamsTeams}
            microsoftTeamsChats={props.microsoftTeamsChats}
            numberPrefixes={props.numberPrefixes}
            exampleRecordName={props.exampleRecordName}
            showWhenEmpty={true}
            dataTestId="notification-rule-summary"
          />
        );
      },
    },
    /*
     * The rule's prefix, or "No prefix", and the name an example record's
     * channel gets: "prod-   Example: #prod-inc-42".
     */
    {
      key: "newChannelTemplateName" as keyof NotificationRulesType,
      title: "Channel Name Prefix",
      fieldType: FieldType.Element,
      showIf: (rule: NotificationRulesType): boolean => {
        return Boolean(
          (rule as IncidentNotificationRule).shouldCreateNewChannel,
        );
      },
      getElement: (): ReactElement => {
        return (
          <ChannelNameSummary
            workspaceType={props.workspaceType}
            eventType={props.eventType}
            prefix={
              (props.value as IncidentNotificationRule).newChannelTemplateName
            }
            numberPrefixes={props.numberPrefixes}
            exampleRecordName={props.exampleRecordName}
            dataTestId="channel-name-summary"
          />
        );
      },
    },
  ];

  if (
    props.eventType === NotificationRuleEventType.Alert ||
    props.eventType === NotificationRuleEventType.Incident
  ) {
    fields.push({
      key: "shouldStartVideoCall" as keyof NotificationRulesType,
      title: "Video Call",
      fieldType: FieldType.Element,
      getElement: (): ReactElement => {
        return (
          <VideoCallRuleSummary
            rule={props.value as IncidentNotificationRule}
            connections={props.videoCallConnections || []}
          />
        );
      },
      showIf: (rule: NotificationRulesType): boolean => {
        return (rule as IncidentNotificationRule).shouldStartVideoCall === true;
      },
    });
  }

  return <Detail<NotificationRulesType> item={props.value} fields={fields} />;
};

export default NotificationRuleViewElement;
