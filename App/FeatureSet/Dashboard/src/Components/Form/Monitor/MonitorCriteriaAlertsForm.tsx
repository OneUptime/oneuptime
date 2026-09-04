import MonitorCriteriaAlertForm from "./MonitorCriteriaAlertForm";
import { CriteriaAlert } from "Common/Types/Monitor/CriteriaAlert";
import ObjectID from "Common/Types/ObjectID";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import MonitorType from "Common/Types/Monitor/MonitorType";
import React, { FunctionComponent, ReactElement, useEffect } from "react";

export interface ComponentProps {
  initialValue: Array<CriteriaAlert> | undefined;
  onChange?: undefined | ((value: Array<CriteriaAlert>) => void);
  alertSeverityDropdownOptions: Array<DropdownOption>;
  onCallPolicyDropdownOptions: Array<DropdownOption>;
  labelDropdownOptions: Array<DropdownOption>;
  teamDropdownOptions: Array<DropdownOption>;
  userDropdownOptions: Array<DropdownOption>;
  monitorType?: MonitorType | undefined;
  seriesAttributeKeys?: Array<string> | undefined;
}

const MonitorCriteriaAlertsForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [alerts, setAlerts] = React.useState<Array<CriteriaAlert>>(
    props.initialValue && props.initialValue?.length > 0
      ? props.initialValue
      : [
          {
            title: "",
            description: "",
            alertSeverityId: undefined,
            id: ObjectID.generate().toString(),
          },
        ],
  );

  useEffect(() => {
    if (alerts && props.onChange) {
      props.onChange(alerts);
    }
  }, [alerts]);

  return (
    <div className="space-y-5">
      {alerts.map((i: CriteriaAlert, index: number) => {
        return (
          <MonitorCriteriaAlertForm
            key={i?.id || index}
            alertSeverityDropdownOptions={props.alertSeverityDropdownOptions}
            onCallPolicyDropdownOptions={props.onCallPolicyDropdownOptions}
            labelDropdownOptions={props.labelDropdownOptions}
            teamDropdownOptions={props.teamDropdownOptions}
            userDropdownOptions={props.userDropdownOptions}
            monitorType={props.monitorType}
            seriesAttributeKeys={props.seriesAttributeKeys}
            initialValue={i}
            onChange={(value: CriteriaAlert) => {
              const index: number = alerts.indexOf(i);
              const newAlerts: Array<CriteriaAlert> = [...alerts];
              newAlerts[index] = value;
              setAlerts(newAlerts);
            }}
          />
        );
      })}
    </div>
  );
};

export default MonitorCriteriaAlertsForm;
