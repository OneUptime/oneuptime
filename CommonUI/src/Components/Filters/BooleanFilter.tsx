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

type BooleanFilterFunction = <T extends GenericObject>(
    props: ComponentProps<T>
) => ReactElement;

const BooleanFilter: BooleanFilterFunction = <T extends GenericObject>(
    props: ComponentProps<T>
): ReactElement => {
    const filter: Filter<T> = props.filter;
    const filterData: FilterData<T> = { ...props.filterData };

    if (filter.type === FieldType.Boolean) {
        return (
            <Dropdown
                options={[
                    {
                        value: true,
                        label: 'Yes',
                    },
                    {
                        value: false,
                        label: 'No',
                    },
                ]}
                onChange={(
                    value: DropdownValue | Array<DropdownValue> | null
                ) => {
                    if (!filter.key) {
                        return;
                    }

                    if (value === null) {
                        delete filterData[filter.key];
                    } else {
                        filterData[filter.key] = value;
                    }

                    if (props.onFilterChanged) {
                        props.onFilterChanged(filterData);
                    }
                }}
                placeholder={`Filter by ${filter.title}`}
            />
        );
    }

    return <></>;
};

export default BooleanFilter;
