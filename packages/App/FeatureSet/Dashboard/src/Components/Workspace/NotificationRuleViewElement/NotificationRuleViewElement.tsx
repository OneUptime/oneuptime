import React, { FunctionComponent, ReactElement } from "react";
import IncidentNotificationRule from "Common/Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import NotificationRuleEventType from "Common/Types/Workspace/NotificationRules/EventType";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import WorkspaceNotificationRule from "Common/Models/DatabaseModels/WorkspaceNotificationRule";
import Columns from "Common/UI/Components/ModelTable/Columns";
import FieldType from "Common/UI/Components/Types/FieldType";
import NotificationRuleConditions from "./NotificationRuleViewConditions";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import OnCallDutyPolicySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Label from "Common/Models/DatabaseModels/Label";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import SecurityCasePriority from "Common/Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "Common/Models/DatabaseModels/SecurityCaseStatus";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import VideoCallConnection from "Common/Models/DatabaseModels/VideoCallConnection";
import {
  MicrosoftTeamsChat,
  MicrosoftTeamsTeam,
} from "Common/Models/DatabaseModels/WorkspaceProjectAuthToken";
import { WorkspaceChannelNumberPrefixes } from "Common/Utils/Workspace/WorkspaceChannelName";
import NotificationRuleSummary from "../NotificationRuleForm/NotificationRuleSummary";
import {
  NO_CONDITIONS_SENTENCES,
  NOTIFICATION_RULE_CONDITIONS_TITLES,
  RULE_THEN_TITLE,
} from "../NotificationRuleForm/NotificationRuleCopy";
import VideoCallRuleSummary from "./VideoCallRuleSummary";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

/*
 * A WORKSPACE NOTIFICATION RULE'S CARD: WHICH RECORDS, THEN WHAT.
 *
 *   Rule Name        Acknowledged incidents
 *   Which incidents  Incident State  Contains Any  (Acknowledged)
 *   Then             - Creates a channel like #ack-inc-42 for each incident.
 *                    - Invites on-call responders as they are paged, the
 *                      Incident Commander and other incident roles as they
 *                      are assigned and owners as they are added.
 *                    - Archives the channel when the incident is resolved.
 *   Video Call       Starts a Zoom call with Zoom (Ops)
 *
 * "Which incidents" and "Then" are the rule form's own words: the
 * Conditions step asks "Which incidents", the Destination step opens with
 * "Then, in Slack".
 *
 * Each is a row of the rule's card of its own (a column of the rules list),
 * so the rows line up and the list's Customize Columns names every one. A
 * rule without a description, or without a video call, leaves that row off
 * its card instead of drawing a label over nothing.
 *
 * The card listed every switch the rule holds, Yes or No, a dozen rows a
 * rule. Then When and Then were a card inside a row with no name - the
 * Customize Columns list showed a box with no name for it - and the name of
 * the channel the rule creates was said twice: in Then, and in a Channel
 * Name Prefix row of its own.
 */

// Which records the rule is for: its conditions, or every record.
export interface NotificationRuleWhenProps {
  rule: IncidentNotificationRule | undefined;
  eventType: NotificationRuleEventType;
  monitors: Array<Monitor>;
  labels: Array<Label>;
  alertStates: Array<AlertState>;
  alertSeverities: Array<AlertSeverity>;
  incidentSeverities: Array<IncidentSeverity>;
  incidentStates: Array<IncidentState>;
  scheduledMaintenanceStates: Array<ScheduledMaintenanceState>;
  // A security case rule's: the project's own case priorities and statuses.
  securityCasePriorities?: Array<SecurityCasePriority> | undefined;
  securityCaseStatuses?: Array<SecurityCaseStatus> | undefined;
  monitorStatus: Array<MonitorStatus>;
}

export const NotificationRuleWhen: FunctionComponent<
  NotificationRuleWhenProps
> = (props: NotificationRuleWhenProps): ReactElement => {
  const translator: Translator = useTranslator();

  if (!props.rule?.filters || props.rule.filters.length === 0) {
    return (
      <div
        className="text-sm text-gray-700"
        data-testid="notification-rule-no-conditions"
      >
        {translator.translateText(NO_CONDITIONS_SENTENCES[props.eventType])}
      </div>
    );
  }

  return (
    <NotificationRuleConditions
      monitors={props.monitors}
      labels={props.labels}
      alertStates={props.alertStates}
      alertSeverities={props.alertSeverities}
      incidentSeverities={props.incidentSeverities}
      incidentStates={props.incidentStates}
      scheduledMaintenanceStates={props.scheduledMaintenanceStates}
      securityCasePriorities={props.securityCasePriorities}
      securityCaseStatuses={props.securityCaseStatuses}
      monitorStatus={props.monitorStatus}
      filterCondition={props.rule.filterCondition}
      criteriaFilters={props.rule.filters}
    />
  );
};

// What the rule does with them, in sentences (NotificationRuleSummary).
export interface NotificationRuleThenProps {
  rule: IncidentNotificationRule | undefined;
  eventType: NotificationRuleEventType;
  workspaceType: WorkspaceType;
  teams: Array<Team>;
  users: Array<User>;
  onCallSchedules?: Array<OnCallDutyPolicySchedule> | undefined;
  microsoftTeamsTeams?: Array<MicrosoftTeamsTeam> | undefined;
  microsoftTeamsChats?: Array<MicrosoftTeamsChat> | undefined;
  // For the example of the name of the channel the rule creates.
  numberPrefixes?: WorkspaceChannelNumberPrefixes | undefined;
  exampleRecordName?: string | undefined;
}

export const NotificationRuleThen: FunctionComponent<
  NotificationRuleThenProps
> = (props: NotificationRuleThenProps): ReactElement => {
  return (
    <NotificationRuleSummary
      rule={props.rule}
      eventType={props.eventType}
      workspaceType={props.workspaceType}
      users={props.users}
      teams={props.teams}
      onCallSchedules={props.onCallSchedules}
      microsoftTeamsTeams={props.microsoftTeamsTeams}
      microsoftTeamsChats={props.microsoftTeamsChats}
      numberPrefixes={props.numberPrefixes}
      exampleRecordName={props.exampleRecordName}
      showWhenEmpty={true}
      dataTestId="notification-rule-summary"
    />
  );
};

// Everything a rule's card refers to by id, loaded once for the whole list.
export interface NotificationRuleCardData
  extends Omit<NotificationRuleWhenProps, "rule">,
    Omit<NotificationRuleThenProps, "rule" | "eventType"> {
  // Incident and alert rules can start a video call; the others cannot.
  canStartVideoCall: boolean;
  videoCallConnections: Array<VideoCallConnection>;
}

/*
 * The ids the card's rows are kept under in a viewer's Customize Columns
 * choices. When, Then and Video Call all read the rule's notificationRule,
 * so each names its own.
 */
export const NOTIFICATION_RULE_CARD_COLUMN_IDS: {
  readonly when: string;
  readonly then: string;
  readonly videoCall: string;
} = {
  when: "when",
  then: "then",
  videoCall: "videoCall",
};

function ruleOf(item: WorkspaceNotificationRule): IncidentNotificationRule {
  return item.notificationRule as IncidentNotificationRule;
}

// The rows of a rule's card, as the rules list's columns.
export function getNotificationRuleCardColumns(
  data: NotificationRuleCardData,
): Columns<WorkspaceNotificationRule> {
  const columns: Columns<WorkspaceNotificationRule> = [
    {
      field: {
        name: true,
      },
      title: "Rule Name",
      type: FieldType.Text,
    },
    {
      field: {
        description: true,
      },
      noValueMessage: "-",
      title: "Rule Description",
      type: FieldType.Text,
      showInListIf: (item: WorkspaceNotificationRule): boolean => {
        return Boolean(item.description?.toString().trim());
      },
    },
    {
      field: {
        notificationRule: true,
      },
      id: NOTIFICATION_RULE_CARD_COLUMN_IDS.when,
      title: NOTIFICATION_RULE_CONDITIONS_TITLES[data.eventType],
      type: FieldType.Element,
      disableSort: true,
      getElement: (item: WorkspaceNotificationRule): ReactElement => {
        return (
          <NotificationRuleWhen
            rule={ruleOf(item)}
            eventType={data.eventType}
            monitors={data.monitors}
            labels={data.labels}
            alertStates={data.alertStates}
            alertSeverities={data.alertSeverities}
            incidentSeverities={data.incidentSeverities}
            incidentStates={data.incidentStates}
            scheduledMaintenanceStates={data.scheduledMaintenanceStates}
            securityCasePriorities={data.securityCasePriorities}
            securityCaseStatuses={data.securityCaseStatuses}
            monitorStatus={data.monitorStatus}
          />
        );
      },
    },
    {
      field: {
        notificationRule: true,
      },
      id: NOTIFICATION_RULE_CARD_COLUMN_IDS.then,
      title: RULE_THEN_TITLE,
      type: FieldType.Element,
      disableSort: true,
      getElement: (item: WorkspaceNotificationRule): ReactElement => {
        return (
          <NotificationRuleThen
            rule={ruleOf(item)}
            eventType={data.eventType}
            workspaceType={data.workspaceType}
            users={data.users}
            teams={data.teams}
            onCallSchedules={data.onCallSchedules}
            microsoftTeamsTeams={data.microsoftTeamsTeams}
            microsoftTeamsChats={data.microsoftTeamsChats}
            numberPrefixes={data.numberPrefixes}
            exampleRecordName={data.exampleRecordName}
          />
        );
      },
    },
  ];

  if (data.canStartVideoCall) {
    columns.push({
      field: {
        notificationRule: true,
      },
      id: NOTIFICATION_RULE_CARD_COLUMN_IDS.videoCall,
      title: "Video Call",
      type: FieldType.Element,
      disableSort: true,
      showInListIf: (item: WorkspaceNotificationRule): boolean => {
        return ruleOf(item)?.shouldStartVideoCall === true;
      },
      getElement: (item: WorkspaceNotificationRule): ReactElement => {
        return (
          <VideoCallRuleSummary
            rule={ruleOf(item)}
            connections={data.videoCallConnections}
          />
        );
      },
    });
  }

  return columns;
}
