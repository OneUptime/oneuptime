import MonitorCriteriaIncidentForm, {
  IncidentRoleOption,
} from "./MonitorCriteriaIncidentForm";
import { CriteriaIncident } from "Common/Types/Monitor/CriteriaIncident";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ObjectID from "Common/Types/ObjectID";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import MonitorType from "Common/Types/Monitor/MonitorType";
import React, { FunctionComponent, ReactElement, useEffect } from "react";

export interface ComponentProps {
  initialValue: Array<CriteriaIncident> | undefined;
  onChange?: undefined | ((value: Array<CriteriaIncident>) => void);
  incidentSeverityDropdownOptions: Array<DropdownOption>;
  onCallPolicyDropdownOptions: Array<DropdownOption>;
  labelDropdownOptions: Array<DropdownOption>;
  teamDropdownOptions: Array<DropdownOption>;
  userDropdownOptions: Array<DropdownOption>;
  incidentRoleOptions?: Array<IncidentRoleOption> | undefined;
  monitorType?: MonitorType | undefined;
  seriesAttributeKeys?: Array<string> | undefined;
}

const MonitorCriteriaIncidentsForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [incidents, setIncidents] = React.useState<Array<CriteriaIncident>>(
    props.initialValue || [
      {
        title: "",
        description: "",
        incidentSeverityId: undefined,
        id: ObjectID.generate().toString(),
      },
    ],
  );

  useEffect(() => {
    if (incidents && props.onChange) {
      props.onChange(incidents);
    }
  }, [incidents]);

  return (
    <div className="space-y-5">
      {incidents.length === 0 && (
        <Button
          title="Configure incident"
          buttonStyle={ButtonStyleType.OUTLINE}
          onClick={() => {
            setIncidents([
              {
                title: "",
                description: "",
                incidentSeverityId: undefined,
                id: ObjectID.generate().toString(),
              },
            ]);
          }}
        />
      )}
      {incidents.map((i: CriteriaIncident, index: number) => {
        return (
          <MonitorCriteriaIncidentForm
            key={i?.id || index}
            incidentSeverityDropdownOptions={
              props.incidentSeverityDropdownOptions
            }
            onCallPolicyDropdownOptions={props.onCallPolicyDropdownOptions}
            labelDropdownOptions={props.labelDropdownOptions}
            teamDropdownOptions={props.teamDropdownOptions}
            userDropdownOptions={props.userDropdownOptions}
            incidentRoleOptions={props.incidentRoleOptions}
            monitorType={props.monitorType}
            seriesAttributeKeys={props.seriesAttributeKeys}
            initialValue={i}
            onChange={(value: CriteriaIncident) => {
              const index: number = incidents.indexOf(i);
              const newIncidents: Array<CriteriaIncident> = [...incidents];
              newIncidents[index] = value;
              setIncidents(newIncidents);
            }}
          />
        );
      })}
    </div>
  );
};

export default MonitorCriteriaIncidentsForm;
