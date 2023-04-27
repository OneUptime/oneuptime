import MonitorCriteria from 'Common/Types/Monitor/MonitorCriteria';
import React, { FunctionComponent, ReactElement, useEffect } from 'react';
import MonitorCriteriaInstanceElement from './MonitorCriteriaInstance';
import MonitorCriteriaInstance from 'Common/Types/Monitor/MonitorCriteriaInstance';
import { DropdownOption } from 'CommonUI/src/Components/Dropdown/Dropdown';
import MonitorType from 'Common/Types/Monitor/MonitorType';

export interface ComponentProps {
    monitorCriteria: MonitorCriteria;
    monitorStatusDropdownOptions: Array<DropdownOption>;
    incidentSeverityDropdownOptions: Array<DropdownOption>;
    monitorType: MonitorType;
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
                                monitorType={props.monitorType}
                                monitorStatusDropdownOptions={
                                    props.monitorStatusDropdownOptions
                                }
                                incidentSeverityDropdownOptions={
                                    props.incidentSeverityDropdownOptions
                                }
                                monitorCriteriaInstance={i}
                                
                               
                            />
                        </div>
                    );
                }
            )}
            
        </div>
    );
};

export default MonitorCriteriaElement;
