import {
    CriteriaFilter,
} from 'Common/Types/Monitor/CriteriaFilter';
import React, { FunctionComponent, ReactElement } from 'react';
import CriteriaFilterElement from './CriteriaFilter';
import MonitorType from 'Common/Types/Monitor/MonitorType';

export interface ComponentProps {
    criteriaFilters: Array<CriteriaFilter>;
    monitorType: MonitorType;
}

const CriteriaFilters: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
   
    return (
        <div>
            {props.criteriaFilters.map((i: CriteriaFilter, index: number) => {
                return (
                    <CriteriaFilterElement
                        monitorType={props.monitorType}
                        key={index}
                        criteriaFilter={i}
                    />
                );
            })}
            
        </div>
    );
};

export default CriteriaFilters;
