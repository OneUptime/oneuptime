import React, {
    ReactElement,
    useEffect,
    useState,
} from 'react';
import Filter from './Types/Filter';
import Input, { InputType } from '../Input/Input';
import FieldType from '../Types/FieldType';
import Search from 'Common/Types/BaseDatabase/Search';
import OneUptimeDate from 'Common/Types/Date';
import BaseModel from 'Common/Models/BaseModel';
import ObjectID from 'Common/Types/ObjectID';
import Dropdown, { DropdownValue } from '../Dropdown/Dropdown';
import ComponentLoader from '../ComponentLoader/ComponentLoader';
import ErrorMessage from '../ErrorMessage/ErrorMessage';
import InBetween from 'Common/Types/BaseDatabase/InBetween';
import DatabaseDate from 'Common/Types/Database/Date';
import GenericObject from 'Common/Types/GenericObject';

export type FilterData<T extends GenericObject> = {
    [P in keyof T]?: string | DropdownValue | Array<DropdownValue> | Search | Date | BaseModel | ObjectID | number | InBetween;
};


export interface ComponentProps<T extends GenericObject> {
    filters: Array<Filter<T>>;
    id: string;
    showFilter: boolean;
    onFilterChanged?: undefined | ((filterData: FilterData<T>) => void);
    isFilterLoading?: undefined | boolean;
    filterError?: string | undefined;
    onFilterRefreshClick?: undefined | (() => void);
}

type FilterComponentFunction = <T extends GenericObject>(props: ComponentProps<T>) => ReactElement;

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
                <div className="grid grid-cols-6 sm:grid-cols-12 md:grid-cols-12 gap-6">
                    {props.showFilter &&
                        !props.isFilterLoading &&
                        !props.filterError &&
                        props.filters &&
                        props.filters.map((filter: Filter<T>, i: number) => {
                            let inputType: InputType = InputType.TEXT;

                            if (filter.type === FieldType.Date) {
                                inputType = InputType.DATE;
                            } else if (filter.type === FieldType.DateTime) {
                                inputType = InputType.DATETIME_LOCAL;
                            }

                            return (
                                <div
                                    key={i}
                                    className="col-span-3 sm:col-span-3 "
                                >
                                    <label className="block text-sm font-medium text-gray-700">
                                        {filter.title}
                                    </label>
                                    {(filter.type === FieldType.Entity ||
                                        filter.type ===
                                        FieldType.EntityArray) &&
                                        filter.filterDropdownOptions && (
                                            <Dropdown
                                                options={
                                                    filter.filterDropdownOptions
                                                }
                                                onChange={(
                                                    value:
                                                        | DropdownValue
                                                        | Array<DropdownValue>
                                                        | null
                                                ) => {
                                                    if (!filter.key) {
                                                        return;
                                                    }

                                                    if (
                                                        !value ||
                                                        (Array.isArray(value) &&
                                                            value.length === 0)
                                                    ) {
                                                        delete filterData[
                                                            filter.key
                                                        ];
                                                    } else {
                                                        filterData[filter.key] =
                                                            value;
                                                    }

                                                    setFilterData(filterData);

                                                    if (props.onFilterChanged) {
                                                        props.onFilterChanged(
                                                            filterData
                                                        );
                                                    }
                                                }}
                                                isMultiSelect={
                                                    filter.type ===
                                                    FieldType.EntityArray
                                                }
                                                placeholder={`Filter by ${filter.title}`}
                                            />
                                        )}

                                    {filter.type !== FieldType.Entity &&
                                        filter.type !== FieldType.EntityArray &&
                                        filter.filterDropdownOptions && (
                                            <Dropdown
                                                options={
                                                    filter.filterDropdownOptions
                                                }
                                                onChange={(
                                                    value:
                                                        | DropdownValue
                                                        | Array<DropdownValue>
                                                        | null
                                                ) => {
                                                    if (!filter.key) {
                                                        return;
                                                    }

                                                    if (
                                                        !value ||
                                                        (Array.isArray(value) &&
                                                            value.length === 0)
                                                    ) {
                                                        delete filterData[
                                                            filter.key
                                                        ];
                                                    } else {
                                                        filterData[filter.key] =
                                                            value;
                                                    }

                                                    setFilterData(filterData);

                                                    if (props.onFilterChanged) {
                                                        props.onFilterChanged(
                                                            filterData
                                                        );
                                                    }
                                                }}
                                                isMultiSelect={false}
                                                placeholder={`Filter by ${filter.title}`}
                                            />
                                        )}

                                    {filter.type === FieldType.Boolean && (
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
                                                value:
                                                    | DropdownValue
                                                    | Array<DropdownValue>
                                                    | null
                                            ) => {
                                                if (!filter.key) {
                                                    return;
                                                }

                                                if (value === null) {
                                                    delete filterData[
                                                        filter.key
                                                    ];
                                                } else {
                                                    filterData[filter.key] =
                                                        value;
                                                }

                                                setFilterData(filterData);

                                                if (props.onFilterChanged) {
                                                    props.onFilterChanged(
                                                        filterData
                                                    );
                                                }
                                            }}
                                            placeholder={`Filter by ${filter.title}`}
                                        />
                                    )}

                                    {!filter.filterDropdownOptions &&
                                        (filter.type === FieldType.Date ||
                                            filter.type === FieldType.Email ||
                                            filter.type === FieldType.Phone ||
                                            filter.type === FieldType.Name ||
                                            filter.type === FieldType.Port ||
                                            filter.type === FieldType.URL ||
                                            filter.type ===
                                            FieldType.DateTime ||
                                            filter.type ===
                                            FieldType.ObjectID ||
                                            filter.type === FieldType.Text) && (
                                            <Input
                                                onChange={(
                                                    changedValue: string | Date
                                                ) => {
                                                    if (filter.key) {
                                                        if (!changedValue) {
                                                            delete filterData[
                                                                filter.key
                                                            ];
                                                        }

                                                        if (
                                                            changedValue &&
                                                            (filter.type ===
                                                                FieldType.Date ||
                                                                filter.type ===
                                                                FieldType.DateTime)
                                                        ) {
                                                            filterData[
                                                                filter.key
                                                            ] = OneUptimeDate.asFilterDateForDatabaseQuery(
                                                                changedValue as string
                                                            );
                                                        }

                                                        if (
                                                            changedValue &&
                                                            filter.type ===
                                                            FieldType.DateTime
                                                        ) {
                                                            filterData[
                                                                filter.key
                                                            ] =
                                                                DatabaseDate.asDateStartOfTheDayEndOfTheDayForDatabaseQuery(
                                                                    changedValue
                                                                );
                                                        }

                                                        if (
                                                            changedValue &&
                                                            (filter.type ===
                                                                FieldType.Text ||
                                                                filter.type ===
                                                                FieldType.Email ||
                                                                filter.type ===
                                                                FieldType.Phone ||
                                                                filter.type ===
                                                                FieldType.Name ||
                                                                filter.type ===
                                                                FieldType.Port ||
                                                                filter.type ===
                                                                FieldType.URL ||
                                                                filter.type ===
                                                                FieldType.ObjectID)
                                                        ) {
                                                            filterData[
                                                                filter.key
                                                            ] = new Search(
                                                                changedValue.toString()
                                                            );
                                                        }

                                                        setFilterData(
                                                            filterData
                                                        );

                                                        if (
                                                            props.onFilterChanged
                                                        ) {
                                                            props.onFilterChanged(
                                                                filterData
                                                            );
                                                        }
                                                    }
                                                }}
                                                initialValue={(
                                                    filterData[
                                                    filter.key
                                                    ] || ''
                                                ).toString()}
                                                placeholder={`Filter by ${filter.title}`}
                                                type={inputType}
                                            />
                                        )}
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
