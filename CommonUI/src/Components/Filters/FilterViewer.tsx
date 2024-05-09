import React, { ReactElement, useEffect, useState } from 'react';
import Filter from './Types/Filter';
import GenericObject from 'Common/Types/GenericObject';
import FilterData from './Types/FilterData';
import FilterUtil from './Utils/Filter';
import FilterViewerItem from './FilterViewerItem';
import ErrorMessage from '../ErrorMessage/ErrorMessage';

export interface ComponentProps<T extends GenericObject> {
    filters: Array<Filter<T>>;
    id: string;
    showFilterModal: boolean;
    onFilterChanged?: undefined | ((filterData: FilterData<T>) => void);
    filterError?: string | undefined;
    onFilterModalClose?: undefined | (() => void);
}

type FilterComponentFunction = <T extends GenericObject>(
    props: ComponentProps<T>
) => ReactElement;

const FilterComponent: FilterComponentFunction = <T extends GenericObject>(
    props: ComponentProps<T>
): ReactElement => {

    const [filterData, setFilterData] = useState<FilterData<T>>({});

    const filterTexts: Array<string> = FilterUtil.translateFilterToText({
        filters: props.filters,
        filterData: filterData,
    });


    if(props.filterError){
        return <ErrorMessage error={props.filterError} />;
    }

    return (
        <div className="ml-5 mt-5 mb-5 bg-gray-50 rounded rounded-xl p-5 border border-2 border-gray-100">
            <ul role="list" className="space-y-6">
                {filterTexts.map(
                    (filterText: string, index: number) => {
                        const isLastItem: boolean =
                            index === filterTexts.length - 1;
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
                                <FilterViewerItem
                                    key={index}
                                    text={filterText}
                                />{' '}
                            </li>
                        );
                    }
                )}
            </ul>
        </div>
    );
};

export default FilterComponent;
