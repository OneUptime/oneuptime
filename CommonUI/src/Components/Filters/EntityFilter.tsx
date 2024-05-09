import React, { ReactElement } from 'react';
import Dropdown, { DropdownValue } from '../Dropdown/Dropdown';
import Filter from './Types/Filter';
import GenericObject from 'Common/Types/GenericObject';
import FieldType from '../Types/FieldType';
import FilterData from './Types/FilterData';

export interface ComponentProps<T extends GenericObject> {
    filter: Filter<T>;
    onFilterChanged?: undefined | ((filterData: FilterData<T>) => void);
    filterData: FilterData<T>;
}

type EntityFilterFunction = <T extends GenericObject>(
    props: ComponentProps<T>
) => ReactElement;

const EntityFilter: EntityFilterFunction = <T extends GenericObject>(
    props: ComponentProps<T>
): ReactElement => {
    const filter: Filter<T> = props.filter;
    const filterData: FilterData<T> = { ...props.filterData };

    if (
        filter.type !== FieldType.Entity &&
        filter.type !== FieldType.EntityArray &&
        filter.filterDropdownOptions
    ) {
        return (
            <Dropdown
                options={filter.filterDropdownOptions}
                onChange={(
                    value: DropdownValue | Array<DropdownValue> | null
                ) => {
                    if (!filter.key) {
                        return;
                    }

                    if (
                        !value ||
                        (Array.isArray(value) && value.length === 0)
                    ) {
                        delete filterData[filter.key];
                    } else {
                        filterData[filter.key] = value;
                    }

                    if (props.onFilterChanged) {
                        props.onFilterChanged(filterData);
                    }
                }}
                isMultiSelect={false}
                placeholder={`Filter by ${filter.title}`}
            />
        );
    }

    return <></>;
};

export default EntityFilter;
