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
        <div className="ml-5 mt-5 mb-5 bg-gray-50 rounded rounded-xl p-5">
            <ul role="list" className="space-y-6">
                {props.criteriaFilters.map(
                    (i: CriteriaFilter, index: number) => {
                        const isLastItem: boolean =
                            index === props.criteriaFilters.length - 1;
                        return (
                            <li className="relative flex gap-x-4" key={index}>
                                {!isLastItem && (
                                    <div className="absolute left-0 top-0 flex w-6 justify-center -bottom-6">
                                        <div className="w-px bg-gray-200"></div>
                                    </div>
                                )}
                                <div className="relative flex h-6 w-6  flex-none items-center justify-center bg-gray-50">
                                    <div className="h-1.5 w-1.5 rounded-full bg-gray-100 ring-1 ring-gray-300"></div>
                                </div>
                                <CriteriaFilterElement
                                    key={index}
                                    criteriaFilter={i}
                                />{' '}
                            </li>
                        );
                    }
                )}
            </ul>
        </div>
    );
};

export default CriteriaFilters;
