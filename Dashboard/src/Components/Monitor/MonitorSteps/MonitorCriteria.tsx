import MonitorCriteria from 'Common/Types/Monitor/MonitorCriteria';
import React, { FunctionComponent, ReactElement } from 'react';
import MonitorCriteriaInstanceElement from './MonitorCriteriaInstance';
import MonitorCriteriaInstance from 'Common/Types/Monitor/MonitorCriteriaInstance';
import { DropdownOption } from 'CommonUI/src/Components/Dropdown/Dropdown';

export interface ComponentProps {
    monitorCriteria: MonitorCriteria;
    monitorStatusDropdownOptions: Array<DropdownOption>;
    incidentSeverityDropdownOptions: Array<DropdownOption>;
}

const MonitorCriteriaElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div className="mt-4">
            {props.monitorCriteria.data?.monitorCriteriaInstanceArray.map(
                (i: MonitorCriteriaInstance, index: number) => {
                    return (
                        <div className="mt-10 mb-10" key={index}>
                            <MonitorCriteriaInstanceElement
                                monitorStatusDropdownOptions={
                                    props.monitorStatusDropdownOptions
                                }
                                incidentSeverityDropdownOptions={
                                    props.incidentSeverityDropdownOptions
                                }
                                monitorCriteriaInstance={i}
                                isLastCriteria={index === (props.monitorCriteria.data?.monitorCriteriaInstanceArray.length || 1) - 1}
                            />
                        </div>
                    );
                }
            )}
        </div>
    );
};

export default MonitorCriteriaElement;
