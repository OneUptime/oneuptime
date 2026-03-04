import MonitorCriteriaAlertForm from "./MonitorCriteriaAlertForm";
import { CriteriaAlert } from "Common/Types/Monitor/CriteriaAlert";
import ObjectID from "Common/Types/ObjectID";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import React, { FunctionComponent, ReactElement, useEffect } from "react";

export interface ComponentProps {
  initialValue: Array<CriteriaAlert> | undefined;
  onChange?: undefined | ((value: Array<CriteriaAlert>) => void);
  alertSeverityDropdownOptions: Array<DropdownOption>;
  onCallPolicyDropdownOptions: Array<DropdownOption>;
  labelDropdownOptions: Array<DropdownOption>;
  teamDropdownOptions: Array<DropdownOption>;
  userDropdownOptions: Array<DropdownOption>;
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
    <div className="mt-4">
      {alerts.map((i: CriteriaAlert, index: number) => {
        return (
          <MonitorCriteriaAlertForm
            key={index}
            alertSeverityDropdownOptions={props.alertSeverityDropdownOptions}
            onCallPolicyDropdownOptions={props.onCallPolicyDropdownOptions}
            labelDropdownOptions={props.labelDropdownOptions}
            teamDropdownOptions={props.teamDropdownOptions}
            userDropdownOptions={props.userDropdownOptions}
            initialValue={i}
            /*
             * onDelete={() => {
             *     // remove the criteria filter
             *     const index: number = alerts.indexOf(i);
             *     const newAlerts: Array<CriteriaAlert> = [
             *         ...alerts,
             *     ];
             *     newAlerts.splice(index, 1);
             *     setAlerts(newAlerts);
             * }}
             */
            onChange={(value: CriteriaAlert) => {
              const index: number = alerts.indexOf(i);
              const newAlerts: Array<CriteriaAlert> = [...alerts];
              newAlerts[index] = value;
              setAlerts(newAlerts);
            }}
          />
        );
      })}

      {/** Future Proofing */}
      {/* <Button
                title="Add Alert"
                onClick={() => {
                    const newAlerts: Array<CriteriaAlert> = [
                        ...alerts,
                    ];
                    newAlerts.push({
                        title: '',
                        description: '',
                        alertSeverityId: undefined,
                    });
                }}
            /> */}
    </div>
  );
};

export default MonitorCriteriaAlertsForm;
