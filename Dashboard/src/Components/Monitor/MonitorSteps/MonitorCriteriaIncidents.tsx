import React, { FunctionComponent, ReactElement } from 'react';
import MonitorCriteriaIncident from './MonitorCriteriaIncident';
import { CriteriaIncident } from 'Common/Types/Monitor/CriteriaIncident';
import IncidentSeverity from 'Model/Models/IncidentSeverity';

export interface ComponentProps {
    incidents: Array<CriteriaIncident>;
    incidentSeverityOptions: Array<IncidentSeverity>;
}

const MonitorCriteriaIncidentsForm: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div className="mt-4">
            {props.incidents.map((i: CriteriaIncident, index: number) => {
                return (
                    <MonitorCriteriaIncident
                        key={index}
                        incidentSeverityOptions={props.incidentSeverityOptions}
                        incident={i}
                    />
                );
            })}
        </div>
    );
};

export default MonitorCriteriaIncidentsForm;
