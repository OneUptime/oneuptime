import { CriteriaFilter } from 'Common/Types/Monitor/CriteriaFilter';
import React, { FunctionComponent, ReactElement } from 'react';
import CriteriaFilterElement from './CriteriaFilter';

export interface ComponentProps {
    criteriaFilters: Array<CriteriaFilter>;
}

const CriteriaFilters: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div>
            {props.criteriaFilters.map((i: CriteriaFilter, index: number) => {
                return <CriteriaFilterElement key={index} criteriaFilter={i} />;
            })}
        </div>
    );
};

export default CriteriaFilters;
