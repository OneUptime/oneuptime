import NotificationRuleConditionElement from "./NotificationRuleCondition";
import IconProp from "Common/Types/Icon/IconProp";
import NotificationRuleCondition, {
  ConditionType,
  NotificationRuleConditionCheckOn,
  NotificationRuleConditionUtil,
} from "Common/Types/Workspace/NotificationRules/NotificationRuleCondition";
import NotificationRuleEventType from "Common/Types/Workspace/NotificationRules/EventType";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import RuleAppliesToChoice from "Common/UI/Components/RuleCriteria/RuleAppliesToChoice";
import React, { FunctionComponent, ReactElement, useEffect } from "react";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import SecurityCasePriority from "Common/Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "Common/Models/DatabaseModels/SecurityCaseStatus";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import Team from "Common/Models/DatabaseModels/Team";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import { RULE_CRITERIA_LIST_CLASS_NAME } from "Common/UI/Components/RuleCriteria/RuleCriteriaRowLayout";
import HorizontalRule from "Common/UI/Components/HorizontalRule/HorizontalRule";
import ObjectID from "Common/Types/ObjectID";
import { isFilterConditionNeeded } from "Common/Types/Filter/FilterConditionUtil";
import {
  APPLIES_TO_ALL_ANSWERS,
  APPLIES_TO_MATCHING_ANSWERS,
  NOTIFICATION_RULE_CONDITIONS_TITLES,
} from "./NotificationRuleCopy";

export interface ComponentProps {
  value: Array<NotificationRuleCondition> | undefined;
  onChange?: undefined | ((value: Array<NotificationRuleCondition>) => void);
  eventType: NotificationRuleEventType;
  /*
   * The short lists a condition picks from whole. Its monitors, labels,
   * SLOs and policies are searched on the server, and the ones it holds
   * read by their ids (RecordConditionPicker, #10646, #10689).
   */
  alertStates: Array<AlertState>;
  alertSeverities: Array<AlertSeverity>;
  incidentSeverities: Array<IncidentSeverity>;
  incidentStates: Array<IncidentState>;
  scheduledMaintenanceStates: Array<ScheduledMaintenanceState>;
  // A security case rule's: the project's own case priorities and statuses.
  securityCasePriorities?: Array<SecurityCasePriority> | undefined;
  securityCaseStatuses?: Array<SecurityCaseStatus> | undefined;
  /*
   * Teams the page knows already, among an owners condition's picks: the
   * others are read by their ids (useTeamIdsAmong, #10689).
   */
  teams?: Array<Team> | undefined;
  monitorStatus: Array<MonitorStatus>;
  /*
   * How the rule combines its conditions, the form's Match Condition: the
   * conditions after the first read "And" for All, "Or" for Any.
   */
  filterCondition?: FilterCondition | undefined;
  /*
   * When the conditions are checked, in English: drawn over them while
   * "Only ... that match conditions" is picked, and left out while the rule
   * is for every record (NOTIFICATION_RULE_CONDITIONS_DESCRIPTIONS).
   */
  conditionsDescription?: string | undefined;
}

/*
 * A condition and the key its row is drawn under. The key is the row's own,
 * made when the row is - never its position: rows keyed by position drew,
 * after the first of two conditions was deleted, the deleted condition in
 * the row that was left (each row keeps what it shows in its own state),
 * while the rule held the other one. Removing a condition is how a rule
 * goes back to one, where All / Any is no longer asked.
 */
interface ConditionRow {
  key: string;
  condition: NotificationRuleCondition;
}

const toRows: (
  conditions: Array<NotificationRuleCondition>,
) => Array<ConditionRow> = (
  conditions: Array<NotificationRuleCondition>,
): Array<ConditionRow> => {
  return conditions.map(
    (condition: NotificationRuleCondition): ConditionRow => {
      return { key: ObjectID.generate().toString(), condition: condition };
    },
  );
};

/*
 * WHICH RECORDS A WORKSPACE RULE IS FOR: ALL OF THEM, OR ONLY THOSE ITS
 * CONDITIONS MATCH.
 *
 *   Which incidents
 *   (o) All incidents
 *   ( ) Only incidents that match conditions
 *
 * Asked as every other rule's conditions are (RuleAppliesToChoice). A new
 * rule starts on "All incidents", with no conditions; picking "Only ..."
 * opens the conditions with one ready to fill in. The choice is read off the
 * conditions, so a saved rule opens on whichever it is, and deleting the
 * last condition goes back to "All". Going back to "All" takes the
 * conditions out of the rule and keeps them aside while the step is open:
 * "Only ..." again puts them back as they were.
 *
 * The divider under it separates the conditions from Match Condition, the
 * form's next field, which only appears with two or more conditions
 * (isFilterConditionNeeded): with fewer it would close off nothing, so it is
 * drawn only then.
 */
const NotificationRuleConditions: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [rows, setRows] = React.useState<Array<ConditionRow>>(() => {
    return toRows(props.value || []);
  });

  // The conditions "All" took out, until "Only ..." is picked again.
  const [rowsSetAside, setRowsSetAside] = React.useState<Array<ConditionRow>>(
    [],
  );

  const notificationRuleConditions: Array<NotificationRuleCondition> = rows.map(
    (row: ConditionRow): NotificationRuleCondition => {
      return row.condition;
    },
  );

  useEffect(() => {
    if (props.onChange) {
      props.onChange(notificationRuleConditions);
    }
  }, [rows]);

  const checkOnByEventType: Array<NotificationRuleConditionCheckOn> =
    NotificationRuleConditionUtil.getCheckOnByEventType(props.eventType);

  const addCondition: () => void = (): void => {
    const firstCheckOn: NotificationRuleConditionCheckOn | undefined =
      checkOnByEventType[0];

    /*
     * An event type with no check-ons has nothing to filter on. Adding a row
     * anyway is what left the Filter Type dropdown empty on the On-Call Duty
     * Policy rule editor (#3459): the row went in with an undefined checkOn
     * over an empty option list, and the rule could not be saved or removed
     * except by deleting the filter.
     */
    if (!firstCheckOn) {
      return;
    }

    const conditionTypes: Array<ConditionType> =
      NotificationRuleConditionUtil.getConditionTypeByCheckOn(firstCheckOn);

    setRows((current: Array<ConditionRow>) => {
      return [
        ...current,
        ...toRows([
          {
            checkOn: firstCheckOn,
            conditionType: conditionTypes[0],
            value: "",
          },
        ]),
      ];
    });
  };

  return (
    <div>
      <RuleAppliesToChoice
        allLabel={APPLIES_TO_ALL_ANSWERS[props.eventType]}
        matchingLabel={APPLIES_TO_MATCHING_ANSWERS[props.eventType]}
        isMatching={rows.length > 0}
        onChooseAll={(): void => {
          setRowsSetAside(rows);
          setRows([]);
        }}
        onChooseMatching={(): void => {
          if (rowsSetAside.length > 0) {
            setRows(rowsSetAside);
            setRowsSetAside([]);
            return;
          }

          addCondition();
        }}
        isMatchingUnavailable={checkOnByEventType.length === 0}
        // The step's heading names it: "Which incidents".
        ariaLabel={NOTIFICATION_RULE_CONDITIONS_TITLES[props.eventType]}
        matchingDescription={props.conditionsDescription}
        dataTestId="notification-rule-applies-to"
      >
        <div
          className="space-y-4 rounded-lg border border-gray-200 bg-white p-4"
          data-testid="notification-rule-conditions"
        >
          <ol className={RULE_CRITERIA_LIST_CLASS_NAME}>
            {rows.map((row: ConditionRow, index: number) => {
              return (
                <NotificationRuleConditionElement
                  {...props}
                  key={row.key}
                  index={index}
                  filterCondition={props.filterCondition}
                  initialValue={row.condition}
                  onDelete={() => {
                    setRows((current: Array<ConditionRow>) => {
                      return current.filter((item: ConditionRow): boolean => {
                        return item.key !== row.key;
                      });
                    });
                  }}
                  onChange={(value: NotificationRuleCondition) => {
                    setRows((current: Array<ConditionRow>) => {
                      return current.map((item: ConditionRow): ConditionRow => {
                        return item.key === row.key
                          ? { key: item.key, condition: value }
                          : item;
                      });
                    });
                  }}
                />
              );
            })}
          </ol>
          {/*
           * Adding a condition is a step inside the form, not its action:
           * an outline button, sized to its words and in line with the
           * conditions at every width, as the rule builder's is (#9116).
           */}
          <div>
            <Button
              title="Add Condition"
              buttonStyle={ButtonStyleType.OUTLINE}
              buttonSize={ButtonSize.Small}
              icon={IconProp.Add}
              disabled={checkOnByEventType.length === 0}
              onClick={addCondition}
              dataTestId="notification-rule-add-condition"
            />
          </div>
        </div>
      </RuleAppliesToChoice>
      {isFilterConditionNeeded(rows) ? <HorizontalRule /> : <></>}
    </div>
  );
};

export default NotificationRuleConditions;
