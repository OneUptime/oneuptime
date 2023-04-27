import { CriteriaFilter } from 'Common/Types/Monitor/CriteriaFilter';
import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps {
    criteriaFilter: CriteriaFilter | undefined;
}

const CriteriaFilterElement: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div className="flex w-full">
            {props.criteriaFilter?.checkOn && (
                <div className="w-1/3 mr-1">
                    <div>{props.criteriaFilter?.checkOn}</div>
                </div>
            )}
            {props.criteriaFilter?.filterType && (
                <div className="w-1/3 mr-1 ml-1">
                    <div>{props.criteriaFilter?.filterType}</div>
                </div>
            )}
            {props.criteriaFilter?.value && (
                <div className="w-1/3 mr-1 ml-1">
                    <div>{props.criteriaFilter?.value}</div>
                </div>
            )}
        </div>
    );
};

export default CriteriaFilterElement;
