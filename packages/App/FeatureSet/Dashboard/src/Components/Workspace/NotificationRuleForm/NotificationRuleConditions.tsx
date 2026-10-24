import Monitor from "Common/Models/DatabaseModels/Monitor";
import NotificationRuleConditionElement from "./NotificationRuleCondition";
import IconProp from "Common/Types/Icon/IconProp";
import NotificationRuleCondition, {
  ConditionType,
  NotificationRuleConditionCheckOn,
  NotificationRuleConditionUtil,
} from "Common/Types/Workspace/NotificationRules/NotificationRuleCondition";
import NotificationRuleEventType from "Common/Types/Workspace/NotificationRules/EventType";
import Button, { ButtonSize } from "Common/UI/Components/Button/Button";
import RuleAppliesToChoice from "Common/UI/Components/RuleCriteria/RuleAppliesToChoice";
import React, { FunctionComponent, ReactElement, useEffect } from "react";
import Label from "Common/Models/DatabaseModels/Label";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import SecurityCasePriority from "Common/Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "Common/Models/DatabaseModels/SecurityCaseStatus";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
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
        <div data-testid="notification-rule-conditions">
          {rows.map((row: ConditionRow) => {
            return (
              <NotificationRuleConditionElement
                {...props}
                key={row.key}
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
          {/*
           * From md up a Button sits 12px in (md:ml-3, for a dialog's
           * footer), taken back here so it lines up with the conditions.
           * Below md it has no such margin and is as wide as they are.
           */}
          <div className="mt-3 md:-ml-3">
            <Button
              title="Add Condition"
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
