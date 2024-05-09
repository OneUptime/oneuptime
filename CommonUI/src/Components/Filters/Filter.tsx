import React, { ReactElement, useEffect, useState } from 'react';
import Filter from './Types/Filter';
import ComponentLoader from '../ComponentLoader/ComponentLoader';
import ErrorMessage from '../ErrorMessage/ErrorMessage';
import GenericObject from 'Common/Types/GenericObject';
import FilterData from './Types/FilterData';
import EntityFilter from './EntityFilter';
import BooleanFilter from './BooleanFilter';
import TextFilter from './TextFilter';

export interface ComponentProps<T extends GenericObject> {
    filters: Array<Filter<T>>;
    id: string;
    showFilter: boolean;
    onFilterChanged?: undefined | ((filterData: FilterData<T>) => void);
    isFilterLoading?: undefined | boolean;
    filterError?: string | undefined;
    onFilterRefreshClick?: undefined | (() => void);
}

type FilterComponentFunction = <T extends GenericObject>(
    props: ComponentProps<T>
) => ReactElement;

const FilterComponent: FilterComponentFunction = <T extends GenericObject>(
    props: ComponentProps<T>
): ReactElement => {
    // should filter on textboxes and checkboxes.
    const [filterData, setFilterData] = useState<FilterData<T>>({});

    useEffect(() => {
        setFilterData({});
    }, [props.showFilter]);

    if (!props.showFilter) {
        return <></>;
    }

    const changeFilterData = (filterData: FilterData<T>) => {
        setFilterData(filterData);
        if (props.onFilterChanged) {
            props.onFilterChanged(filterData);
        }
    };

    return (
        <div id={props.id}>
            <div className="relative">
                <div
                    className="absolute inset-0 flex items-center"
                    aria-hidden="true"
                >
                    <div className="w-full border-t border-gray-300"></div>
                </div>
                <div className="relative flex justify-center">
                    <span className="bg-white px-2 text-sm text-gray-500">
                        Filter By
                    </span>
                </div>
            </div>
            <div className="pt-3 pb-5">
                <div className="space-y-5">
                    {props.showFilter &&
                        !props.isFilterLoading &&
                        !props.filterError &&
                        props.filters &&
                        props.filters.map((filter: Filter<T>, i: number) => {
                            return (
                                <div
                                    key={i}
                                    className="col-span-3 sm:col-span-3 "
                                >
                                    <label className="block text-sm font-medium text-gray-700">
                                        {filter.title}
                                    </label>

                                    <EntityFilter
                                        filter={filter}
                                        filterData={filterData}
                                        onFilterChanged={changeFilterData}
                                    />
                                    <BooleanFilter
                                        filter={filter}
                                        filterData={filterData}
                                        onFilterChanged={changeFilterData}
                                    />
                                    <TextFilter
                                        filter={filter}
                                        filterData={filterData}
                                        onFilterChanged={changeFilterData}
                                    />
                                </div>
                            );
                        })}
                </div>
            </div>
            {props.showFilter &&
                props.isFilterLoading &&
                !props.filterError && <ComponentLoader />}

            {props.showFilter && props.filterError && (
                <ErrorMessage
                    error={props.filterError}
                    onRefreshClick={props.onFilterRefreshClick}
                />
            )}
        </div>
    );
};

export default FilterComponent;
