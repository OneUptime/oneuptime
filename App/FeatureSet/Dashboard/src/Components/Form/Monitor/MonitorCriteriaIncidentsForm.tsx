import MonitorCriteriaIncidentForm, {
  IncidentRoleOption,
} from "./MonitorCriteriaIncidentForm";
import { CriteriaIncident } from "Common/Types/Monitor/CriteriaIncident";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
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
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 px-3 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
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
        >
          <Icon icon={IconProp.Add} className="h-4 w-4" />
          Configure incident
        </button>
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
