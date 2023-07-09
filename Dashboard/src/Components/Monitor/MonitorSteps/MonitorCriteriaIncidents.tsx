import React, { FunctionComponent, ReactElement } from 'react';
import MonitorCriteriaIncident from './MonitorCriteriaIncident';
import { CriteriaIncident } from 'Common/Types/Monitor/CriteriaIncident';
import IncidentSeverity from 'Model/Models/IncidentSeverity';
import OnCallDutyPolicy from 'Model/Models/OnCallDutyPolicy';

export interface ComponentProps {
    incidents: Array<CriteriaIncident>;
    incidentSeverityOptions: Array<IncidentSeverity>;
    onCallPolicyOptions: Array<OnCallDutyPolicy>;
}

const MonitorCriteriaIncidentsForm: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div className="mt-4 ml-5">
            {props.incidents.map((i: CriteriaIncident, index: number) => {
                return (
                    <MonitorCriteriaIncident
                        key={index}
                        onCallPolicyOptions={props.onCallPolicyOptions}
                        incidentSeverityOptions={props.incidentSeverityOptions}
                        incident={i}
                    />
                );
            })}
        </div>
    );
};

export default MonitorCriteriaIncidentsForm;
