import Monitor from "Common/Models/DatabaseModels/Monitor";
import NotificationRuleConditionElement from "./NotificationRuleCondition";
import IconProp from "Common/Types/Icon/IconProp";
import {
  ConditionType,
  NotificationRuleConditionCheckOn,
  NotificationRuleConditionUtil,
} from "Common/Types/ServiceProvider/NotificationRules/NotificationRuleCondition";
import NotificationRuleEventType from "Common/Types/ServiceProvider/NotificationRules/EventType";
import NotificationRuleCondition from "Common/Types/ServiceProvider/NotificationRules/NotificationRuleCondition";
import Button, { ButtonSize } from "Common/UI/Components/Button/Button";
import React, { FunctionComponent, ReactElement, useEffect } from "react";
import Label from "Common/Models/DatabaseModels/Label";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";

export interface ComponentProps {
  initialValue: Array<NotificationRuleCondition> | undefined;
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

const NotificationRuleConditions: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [notificationRuleConditions, setNotificationRuleConditions] =
    React.useState<Array<NotificationRuleCondition>>(props.initialValue || []);

  useEffect(() => {
    if (notificationRuleConditions && props.onChange) {
      props.onChange(notificationRuleConditions);
    }
  }, [notificationRuleConditions]);

  return (
    <div>
      {notificationRuleConditions.length === 0 && (
        <p>This rule will trigger for all {props.eventType} events.</p>
      )}

      {notificationRuleConditions.map(
        (i: NotificationRuleCondition, index: number) => {
          return (
            <NotificationRuleConditionElement
              {...props}
              key={index}
              initialValue={i}
              onDelete={() => {
                // remove the criteria filter
                const index: number = notificationRuleConditions.indexOf(i);
                const newNotificationRuleConditions: Array<NotificationRuleCondition> =
                  [...notificationRuleConditions];
                newNotificationRuleConditions.splice(index, 1);
                setNotificationRuleConditions(newNotificationRuleConditions);
              }}
              onChange={(value: NotificationRuleCondition) => {
                const index: number = notificationRuleConditions.indexOf(i);
                const newNotificationRuleConditions: Array<NotificationRuleCondition> =
                  [...notificationRuleConditions];
                newNotificationRuleConditions[index] = value;
                setNotificationRuleConditions(newNotificationRuleConditions);
              }}
            />
          );
        },
      )}
      <div className="mt-3 -ml-3">
        <Button
          title="Add Filter"
          buttonSize={ButtonSize.Small}
          icon={IconProp.Add}
          onClick={() => {
            const newNotificationRuleConditions: Array<NotificationRuleCondition> =
              [...notificationRuleConditions];

            const checkOnByEventType: Array<NotificationRuleConditionCheckOn> =
              NotificationRuleConditionUtil.getCheckOnByEventType(
                props.eventType,
              );

            const conditionTypes: Array<ConditionType> =
              NotificationRuleConditionUtil.getConditionTypeByCheckOn(
                checkOnByEventType[0]!,
              );

            newNotificationRuleConditions.push({
              checkOn: checkOnByEventType[0]!,
              conditionType: conditionTypes[0]!,
              value: "",
            });

            setNotificationRuleConditions(newNotificationRuleConditions);
          }}
        />
      </div>
    </div>
  );
};

export default NotificationRuleConditions;
