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
import React, { FunctionComponent, ReactElement, useEffect } from "react";
import Label from "Common/Models/DatabaseModels/Label";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import HorizontalRule from "Common/UI/Components/HorizontalRule/HorizontalRule";
import ObjectID from "Common/Types/ObjectID";

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
  monitorStatus: Array<MonitorStatus>;
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
  return conditions.map((condition: NotificationRuleCondition): ConditionRow => {
    return { key: ObjectID.generate().toString(), condition: condition };
  });
};

const NotificationRuleConditions: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [rows, setRows] = React.useState<Array<ConditionRow>>(() => {
    return toRows(props.value || []);
  });

  const notificationRuleConditions: Array<NotificationRuleCondition> =
    rows.map((row: ConditionRow): NotificationRuleCondition => {
      return row.condition;
    });

  useEffect(() => {
    if (props.onChange) {
      props.onChange(notificationRuleConditions);
    }
  }, [rows]);

  const checkOnByEventType: Array<NotificationRuleConditionCheckOn> =
    NotificationRuleConditionUtil.getCheckOnByEventType(props.eventType);

  return (
    <div>
      {notificationRuleConditions.length === 0 && (
        <p className="text-sm text-gray-700 text-semibold">
          If no filters are added, then this rule will trigger for every{" "}
          {props.eventType}.
        </p>
      )}

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
      <div className="mt-3 -ml-3">
        <Button
          title="Add Condition"
          buttonSize={ButtonSize.Small}
          icon={IconProp.Add}
          disabled={checkOnByEventType.length === 0}
          onClick={() => {
            const firstCheckOn: NotificationRuleConditionCheckOn | undefined =
              checkOnByEventType[0];

            /*
             * An event type with no check-ons has nothing to filter on. Adding
             * a row anyway is what left the Filter Type dropdown empty on the
             * On-Call Duty Policy rule editor (#3459): the row went in with an
             * undefined checkOn over an empty option list, and the rule could
             * not be saved or removed except by deleting the filter.
             */
            if (!firstCheckOn) {
              return;
            }

            const conditionTypes: Array<ConditionType> =
              NotificationRuleConditionUtil.getConditionTypeByCheckOn(
                firstCheckOn,
              );

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
          }}
        />
      </div>
      <HorizontalRule />
    </div>
  );
};

export default NotificationRuleConditions;
