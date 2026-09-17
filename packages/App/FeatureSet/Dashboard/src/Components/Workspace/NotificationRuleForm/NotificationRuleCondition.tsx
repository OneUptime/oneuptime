import IconProp from "Common/Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import FieldLabelElement from "Common/UI/Components/Detail/FieldLabel";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Input from "Common/UI/Components/Input/Input";
import React, { FunctionComponent, ReactElement, useEffect } from "react";
import NotificationRuleCondition, {
  ConditionType,
  NotificationRuleConditionCheckOn,
  NotificationRuleConditionUtil,
} from "Common/Types/Workspace/NotificationRules/NotificationRuleCondition";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Label from "Common/Models/DatabaseModels/Label";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import NotificationRuleEventType from "Common/Types/Workspace/NotificationRules/EventType";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import ObjectID from "Common/Types/ObjectID";

export interface ComponentProps {
  initialValue: NotificationRuleCondition | undefined;
  onChange?: undefined | ((value: NotificationRuleCondition) => void);
  onDelete?: undefined | (() => void);
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

const NotificationRuleConditionFormElement: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const [notificationRuleCondition, setNotificationRuleCondition] =
    React.useState<NotificationRuleCondition | undefined>(props.initialValue);

  const [valuePlaceholder, setValuePlaceholder] = React.useState<string>("");

  const [checkOnOptions, setCheckOnOptions] = React.useState<
    Array<DropdownOption>
  >([]);

  const [isLoading, setIsLoading] = React.useState<boolean>(true);

  useEffect(() => {
    const checkOnOptions: Array<NotificationRuleConditionCheckOn> =
      NotificationRuleConditionUtil.getCheckOnByEventType(props.eventType);

    const dropdownOptions: Array<DropdownOption> = checkOnOptions.map(
      (checkon: NotificationRuleConditionCheckOn) => {
        return {
          value: checkon,
          label: checkon,
        };
      },
    );

    setCheckOnOptions(dropdownOptions);

    setIsLoading(false);
  }, [props.eventType]);

  const [conditionTypeOptions, setFilterTypeOptions] = React.useState<
    Array<DropdownOption>
  >([]);

  useEffect(() => {
    setFilterTypeOptions(
      notificationRuleCondition?.checkOn
        ? NotificationRuleConditionUtil.getConditionTypeByCheckOn(
            notificationRuleCondition?.checkOn,
          ).map((item: ConditionType) => {
            return {
              value: item,
              label: item,
            };
          })
        : [],
    );
    setValuePlaceholder("");
  }, [notificationRuleCondition]);

  useEffect(() => {
    if (props.onChange && notificationRuleCondition) {
      props.onChange(notificationRuleCondition);
    }
  }, [notificationRuleCondition]);

  if (isLoading) {
    return <></>;
  }

  const filterConditionValue: DropdownOption | undefined =
    conditionTypeOptions.find((i: DropdownOption) => {
      return i.value === notificationRuleCondition?.conditionType;
    });

  return (
    <div>
      <div className="rounded-md p-2 bg-gray-50 my-5 border-gray-200 border-solid border-2">
        <div className="">
          <FieldLabelElement title="Filter Type" />
          <Dropdown
            value={checkOnOptions.find((i: DropdownOption) => {
              return i.value === notificationRuleCondition?.checkOn;
            })}
            options={checkOnOptions}
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              setNotificationRuleCondition({
                checkOn: value?.toString() as NotificationRuleConditionCheckOn,
                conditionType: undefined,
                value: undefined,
              });
            }}
          />
        </div>

        {!notificationRuleCondition?.checkOn ||
          (notificationRuleCondition?.checkOn && (
            <div className="mt-1">
              <FieldLabelElement title="Filter Condition" />
              <Dropdown
                value={filterConditionValue}
                options={conditionTypeOptions}
                onChange={(
                  value: DropdownValue | Array<DropdownValue> | null,
                ) => {
                  setNotificationRuleCondition({
                    ...notificationRuleCondition,
                    conditionType: value?.toString() as ConditionType,
                    value: undefined,
                  });
                }}
              />
            </div>
          ))}

        {!notificationRuleCondition?.checkOn ||
          (notificationRuleCondition?.checkOn &&
            NotificationRuleConditionUtil.hasValueField({
              checkOn: notificationRuleCondition?.checkOn,
              conditionType: notificationRuleCondition?.conditionType,
            }) &&
            !NotificationRuleConditionUtil.isDropdownValueField({
              checkOn: notificationRuleCondition?.checkOn,
              conditionType: notificationRuleCondition?.conditionType,
            }) && (
              <div className="mt-1">
                <FieldLabelElement title="Value" />
                <Input
                  placeholder={valuePlaceholder}
                  value={notificationRuleCondition?.value?.toString()}
                  onChange={(value: string) => {
                    setNotificationRuleCondition({
                      ...notificationRuleCondition,
                      value: value || "",
                    });
                  }}
                />
              </div>
            ))}

        {!notificationRuleCondition?.checkOn ||
          (notificationRuleCondition?.checkOn &&
            NotificationRuleConditionUtil.hasValueField({
              checkOn: notificationRuleCondition?.checkOn,
              conditionType: notificationRuleCondition?.conditionType,
            }) &&
            NotificationRuleConditionUtil.isDropdownValueField({
              checkOn: notificationRuleCondition?.checkOn,
              conditionType: notificationRuleCondition?.conditionType,
            }) && (
              <div className="mt-1">
                <FieldLabelElement title="Value" />
                <Dropdown
                  isMultiSelect={true}
                  options={NotificationRuleConditionUtil.getDropdownOptionsByCheckOn(
                    {
                      checkOn: notificationRuleCondition?.checkOn,
                      monitors: props.monitors,
                      labels: props.labels,
                      alertStates: props.alertStates,
                      incidentStates: props.incidentStates,
                      scheduledMaintenanceStates:
                        props.scheduledMaintenanceStates,
                      monitorStatus: props.monitorStatus,
                      alertSeverities: props.alertSeverities,
                      incidentSeverities: props.incidentSeverities,
                    },
                  )}
                  value={NotificationRuleConditionUtil.getDropdownOptionsByCheckOn(
                    {
                      checkOn: notificationRuleCondition?.checkOn,
                      monitors: props.monitors,
                      labels: props.labels,
                      alertStates: props.alertStates,
                      incidentStates: props.incidentStates,
                      scheduledMaintenanceStates:
                        props.scheduledMaintenanceStates,
                      monitorStatus: props.monitorStatus,
                      alertSeverities: props.alertSeverities,
                      incidentSeverities: props.incidentSeverities,
                    },
                  ).filter((i: DropdownOption) => {
                    if (
                      notificationRuleCondition?.value &&
                      Array.isArray(notificationRuleCondition?.value)
                    ) {
                      return notificationRuleCondition?.value
                        .map((item: string | ObjectID) => {
                          return item.toString();
                        })
                        .includes(i.value.toString());
                    }

                    return i.value === notificationRuleCondition?.value;
                  })}
                  onChange={(
                    value: DropdownValue | Array<DropdownValue> | null,
                  ) => {
                    if (Array.isArray(value)) {
                      setNotificationRuleCondition({
                        ...notificationRuleCondition,
                        value: value.map((item: DropdownValue) => {
                          return item.toString();
                        }),
                      });
                      return;
                    }

                    setNotificationRuleCondition({
                      ...notificationRuleCondition,
                      value: value?.toString(),
                    });
                  }}
                />
              </div>
            ))}

        <div className="mt-3 -mr-2 w-full flex justify-end">
          <Button
            title="Delete Filter"
            buttonStyle={ButtonStyleType.DANGER_OUTLINE}
            icon={IconProp.Trash}
            buttonSize={ButtonSize.Small}
            onClick={() => {
              props.onDelete?.();
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default NotificationRuleConditionFormElement;
