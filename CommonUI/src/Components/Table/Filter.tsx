import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import Column from './Types/Column';
import Columns from './Types/Columns';
import Dictionary from 'Common/Types/Dictionary';
import Input from '../Input/ColorInput';
import FieldType from '../Types/FieldType';
import Search from 'Common/Types/Database/Search';
import OneUptimeDate from 'Common/Types/Date';
import BaseModel from 'Common/Models/BaseModel';
import ObjectID from 'Common/Types/ObjectID';
import Dropdown, { DropdownValue } from '../Dropdown/Dropdown';
import ComponentLoader from '../ComponentLoader/ComponentLoader';
import ErrorMessage from '../ErrorMessage/ErrorMessage';
import InBetween from 'Common/Types/Database/InBetween';
import DatabaseDate from 'Common/Types/Database/Date';

export type FilterData = Dictionary<
    | string
    | DropdownValue
    | Array<DropdownValue>
    | boolean
    | Search
    | Date
    | BaseModel
    | Array<BaseModel>
    | ObjectID
    | Array<ObjectID>
    | number
    | InBetween
>;

export interface ComponentProps {
    columns: Columns;
    id: string;
    showFilter: boolean;
    onFilterChanged?: undefined | ((filterData: FilterData) => void);
    isTableFilterLoading?: undefined | boolean;
    filterError?: string | undefined;
    onTableFilterRefreshClick?: undefined | (() => void);
}

const Filter: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    // should filter on textboxes and checkboxes.
    const [filterData, setFilterData] = useState<FilterData>({});

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
                        !props.isTableFilterLoading &&
                        !props.filterError &&
                        props.columns &&
                        props.columns
                            .filter((column: Column) => {
                                return column.isFilterable && column.key;
                            })
                            .map((column: Column, i: number) => {
                                return (
                                    <div
                                        key={i}
                                        className="col-span-3 sm:col-span-3 "
                                    >
                                        <label className="block text-sm font-medium text-gray-700">
                                            {column.title}
                                        </label>
                                        {(column.type === FieldType.Entity ||
                                            column.type ===
                                                FieldType.EntityArray) &&
                                            column.filterDropdownOptions && (
                                                <Dropdown
                                                    options={
                                                        column.filterDropdownOptions
                                                    }
                                                    onChange={(
                                                        value:
                                                            | DropdownValue
                                                            | Array<DropdownValue>
                                                            | null
                                                    ) => {
                                                        if (!column.key) {
                                                            return;
                                                        }

                                                        if (
                                                            !value ||
                                                            (Array.isArray(
                                                                value
                                                            ) &&
                                                                value.length ===
                                                                    0)
                                                        ) {
                                                            delete filterData[
                                                                column.key
                                                            ];
                                                        } else {
                                                            filterData[
                                                                column.key
                                                            ] = value;
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
                                                    }}
                                                    isMultiSelect={
                                                        column.type ===
                                                        FieldType.EntityArray
                                                    }
                                                    placeholder={`Filter by ${column.title}`}
                                                />
                                            )}

                                        {column.type === FieldType.Boolean && (
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
                                                    if (!column.key) {
                                                        return;
                                                    }

                                                    if (value === null) {
                                                        delete filterData[
                                                            column.key
                                                        ];
                                                    } else {
                                                        filterData[column.key] =
                                                            value;
                                                    }

                                                    setFilterData(filterData);

                                                    if (props.onFilterChanged) {
                                                        props.onFilterChanged(
                                                            filterData
                                                        );
                                                    }
                                                }}
                                                placeholder={`Filter by ${column.title}`}
                                            />
                                        )}

                                        {(column.type === FieldType.Date ||
                                            column.type ===
                                                FieldType.DateTime ||
                                            column.type ===
                                                FieldType.ObjectID ||
                                            column.type === FieldType.Text) && (
                                            <Input
                                                onChange={(
                                                    changedValue: string | Date
                                                ) => {
                                                    if (column.key) {
                                                        if (!changedValue) {
                                                            delete filterData[
                                                                column.key
                                                            ];
                                                        }

                                                        if (
                                                            changedValue &&
                                                            (column.type ===
                                                                FieldType.Date ||
                                                                column.type ===
                                                                    FieldType.DateTime)
                                                        ) {
                                                            filterData[
                                                                column.key
                                                            ] = OneUptimeDate.asDateForDatabaseQuery(
                                                                changedValue as string
                                                            );
                                                        }

                                                        if (
                                                            changedValue &&
                                                            column.type ===
                                                                FieldType.DateTime
                                                        ) {
                                                            filterData[
                                                                column.key
                                                            ] =
                                                                DatabaseDate.asDateStartOfTheDayEndOfTheDayForDatabaseQuery(
                                                                    changedValue
                                                                );
                                                        }

                                                        if (
                                                            changedValue &&
                                                            column.type ===
                                                                FieldType.Text
                                                        ) {
                                                            filterData[
                                                                column.key
                                                            ] = new Search(
                                                                changedValue as string
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
                                                        column.key || ''
                                                    ] || ''
                                                ).toString()}
                                                placeholder={`Filter by ${column.title}`}
                                                type={
                                                    column.type ===
                                                        FieldType.Date ||
                                                    column.type ===
                                                        FieldType.DateTime
                                                        ? 'date'
                                                        : 'text'
                                                }
                                            />
                                        )}
                                    </div>
                                );
                            })}
                </div>
            </div>
            {props.showFilter &&
                props.isTableFilterLoading &&
                !props.filterError && <ComponentLoader />}

            {props.showFilter && props.filterError && (
                <ErrorMessage
                    error={props.filterError}
                    onRefreshClick={props.onTableFilterRefreshClick}
                />
            )}
        </div>
    );
};

export default Filter;
