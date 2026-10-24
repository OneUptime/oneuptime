import FilterCondition from "Common/Types/Filter/FilterCondition";
import { isFilterConditionNeeded } from "Common/Types/Filter/FilterConditionUtil";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import NotificationRuleConditionElement from "./NotificationRuleViewCondition";
import React, { FunctionComponent, ReactElement } from "react";
import NotificationRuleCondition from "Common/Types/Workspace/NotificationRules/NotificationRuleCondition";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Label from "Common/Models/DatabaseModels/Label";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import SecurityCasePriority from "Common/Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "Common/Models/DatabaseModels/SecurityCaseStatus";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";

export interface ComponentProps {
  criteriaFilters: Array<NotificationRuleCondition>;
  filterCondition: FilterCondition;
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

/*
 * The line over a rule's conditions, under the card's "Which incidents".
 * All or Any is said only when there are two or more conditions to combine
 * (isFilterConditionNeeded): one condition is simply the condition, on a
 * line of its own. A rule saved without a match condition reads as "any",
 * as it always did here.
 *
 * It said "This rule runs when this condition is met:" over a single
 * condition, in a framed box with a timeline's dots, under a label that
 * asks which records the rule is for already.
 */
export const RULE_CONDITIONS_SENTENCES: {
  readonly all: string;
  readonly any: string;
} = {
  all: translationKey("Those that match all of these:"),
  any: translationKey("Those that match any one of these:"),
};

export const getRuleConditionsSentence: (data: {
  filters: Array<NotificationRuleCondition> | undefined;
  filterCondition: FilterCondition | undefined;
}) => string | undefined = (data: {
  filters: Array<NotificationRuleCondition> | undefined;
  filterCondition: FilterCondition | undefined;
}): string | undefined => {
  /*
   * No conditions: the rule runs for every event, which its card says
   * itself. One condition: the condition says it all.
   */
  if (!data.filters || !isFilterConditionNeeded(data.filters)) {
    return undefined;
  }

  return data.filterCondition === FilterCondition.All
    ? RULE_CONDITIONS_SENTENCES.all
    : RULE_CONDITIONS_SENTENCES.any;
};

const NotificationRuleConditions: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const conditions: Array<NotificationRuleCondition> =
    props.criteriaFilters || [];
  const sentence: string | undefined = getRuleConditionsSentence({
    filters: conditions,
    filterCondition: props.filterCondition,
  });

  const drawCondition: (
    condition: NotificationRuleCondition,
  ) => ReactElement = (condition: NotificationRuleCondition): ReactElement => {
    return (
      <NotificationRuleConditionElement
        notificationRuleCondition={condition}
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
      />
    );
  };

  // One condition: the condition, as a line of its own.
  if (!sentence) {
    return (
      <ul role="list" className="text-sm text-gray-700">
        {conditions.map(
          (condition: NotificationRuleCondition, index: number) => {
            return <li key={index}>{drawCondition(condition)}</li>;
          },
        )}
      </ul>
    );
  }

  /*
   * Several: whether all of them or any one must be true, then each, as the
   * card's Then lists what the rule does.
   */
  return (
    <div className="space-y-1">
      <p
        className="text-sm text-gray-700"
        data-testid="notification-rule-conditions-sentence"
      >
        {translator.translateText(sentence)}
      </p>
      <ul
        role="list"
        className="list-disc space-y-1 pl-5 text-sm text-gray-700 marker:text-gray-400"
      >
        {conditions.map(
          (condition: NotificationRuleCondition, index: number) => {
            return <li key={index}>{drawCondition(condition)}</li>;
          },
        )}
      </ul>
    </div>
  );
};

export default NotificationRuleConditions;
