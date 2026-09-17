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

const NotificationRuleConditions: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [notificationRuleConditions, setNotificationRuleConditions] =
    React.useState<Array<NotificationRuleCondition>>(props.value || []);

  useEffect(() => {
    if (notificationRuleConditions && props.onChange) {
      props.onChange(notificationRuleConditions);
    }
  }, [notificationRuleConditions]);

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

            const newNotificationRuleConditions: Array<NotificationRuleCondition> =
              [...notificationRuleConditions];

            const conditionTypes: Array<ConditionType> =
              NotificationRuleConditionUtil.getConditionTypeByCheckOn(
                firstCheckOn,
              );

            newNotificationRuleConditions.push({
              checkOn: firstCheckOn,
              conditionType: conditionTypes[0],
              value: "",
            });

            setNotificationRuleConditions(newNotificationRuleConditions);
          }}
        />
      </div>
      <HorizontalRule />
    </div>
  );
};

export default NotificationRuleConditions;
