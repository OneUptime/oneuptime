import React, { FunctionComponent, ReactElement } from 'react';
import MonitorCriteriaIncident from './MonitorCriteriaIncident';
import { CriteriaIncident } from 'Common/Types/Monitor/CriteriaIncident';
import { DropdownOption } from 'CommonUI/src/Components/Dropdown/Dropdown';

export interface ComponentProps {
    incidents: Array<CriteriaIncident>;
    incidentSeverityDropdownOptions: Array<DropdownOption>;
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
                        incidentSeverityDropdownOptions={
                            props.incidentSeverityDropdownOptions
                        }
                        incident={i}
                    />
                );
            })}
        </div>
    );
};

export default MonitorCriteriaIncidentsForm;
