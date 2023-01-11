import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import Column from './Types/Column';
import Columns from './Types/Columns';
import Icon, { IconProp, ThickProp } from '../Icon/Icon';
import SortOrder from 'Common/Types/Database/SortOrder';
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
    onSortChanged: (sortBy: string, sortOrder: SortOrder) => void;
    showFilter: boolean;
    onFilterChanged?: undefined | ((filterData: FilterData) => void);
    isTableFilterLoading?: undefined | boolean;
    filterError?: string | undefined;
    onTableFilterRefreshClick?: undefined | (() => void);
    enableDragAndDrop?: undefined | boolean;
}

const TableHeader: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [currentSortColumn, setCurrentSortColumn] = useState<string>('');
    const [sortOrder, setSortOrder] = useState<SortOrder>(SortOrder.Ascending);

    // should filter on textboxes and checkboxes.
    const [filterData, setFilterData] = useState<FilterData>({});

    useEffect(() => {
        setFilterData({});
    }, [props.showFilter]);

    return (
        <thead className="bg-gray-50">
            <tr>
                {props.enableDragAndDrop && <th></th>}
                {props.columns.map((column: Column, i: number) => {
                    const canSort: boolean =
                        !column.disableSort && Boolean(column.key);

                    return (
                        <th
                            key={i}
                            className={`px-6 py-3 text-left text-sm font-semibold text-gray-900 ${canSort ? 'cursor-pointer' : ''
                                }`}
                            onClick={() => {
                                if (!column.key) {
                                    return;
                                }

                                if (!canSort) {
                                    return;
                                }

                                if (currentSortColumn === column.key) {
                                    setSortOrder(
                                        sortOrder === SortOrder.Ascending
                                            ? SortOrder.Descending
                                            : SortOrder.Ascending
                                    );
                                } else {
                                    setCurrentSortColumn(column.key);
                                    setSortOrder(SortOrder.Ascending);
                                }

                                props.onSortChanged(
                                    currentSortColumn,
                                    sortOrder
                                );
                            }}
                        >
                            <div
                                className={`flex ${column.type === FieldType.Actions
                                    ? 'justify-end'
                                    : 'justify-start'
                                    }`}
                            >
                                {column.title}
                                {canSort &&
                                    currentSortColumn === column.key &&
                                    sortOrder === SortOrder.Ascending && (
                                        <Icon
                                            icon={IconProp.ChevronUp}
                                            thick={ThickProp.Thick}
                                            className="ml-2  p-1 flex-none rounded bg-gray-200 text-gray-500 group-hover:bg-gray-300 h-4 w-4"
                                        />
                                    )}
                                {canSort &&
                                    currentSortColumn === column.key &&
                                    sortOrder === SortOrder.Descending && (
                                        <Icon
                                            icon={IconProp.ChevronDown}
                                            thick={ThickProp.Thick}
                                            className="ml-2 p-1 flex-none rounded bg-gray-200 text-gray-500 group-hover:bg-gray-300 h-4 w-4"
                                        />
                                    )}
                            </div>
                        </th>
                    );
                })}
            </tr>
            {props.showFilter &&
                !props.isTableFilterLoading &&
                !props.filterError && (
                    <tr>
                        {props.columns.map((column: Column, i: number) => {
                            return (
                                <td key={i}>
                                    {column.isFilterable && column.key && (
                                        <div>
                                            {(column.type ===
                                                FieldType.Entity ||
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

                                            {column.type ===
                                                FieldType.Boolean && (
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
                                                        placeholder={`Filter by ${column.title}`}
                                                    />
                                                )}

                                            {(column.type === FieldType.Date ||
                                                column.type ===
                                                FieldType.DateTime ||
                                                column.type ===
                                                FieldType.ObjectID ||
                                                column.type ===
                                                FieldType.Text) && (
                                                    <Input
                                                        onChange={(
                                                            changedValue:
                                                                | string
                                                                | Date
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
                                                        className={'form-control'}
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
                                    )}
                                </td>
                            );
                        })}
                    </tr>
                )}

            {props.showFilter &&
                props.isTableFilterLoading &&
                !props.filterError && (
                    <tr>
                        <td colSpan={props.columns.length}>
                            <ComponentLoader />
                        </td>
                    </tr>
                )}

            {props.showFilter && props.filterError && (
                <tr>
                    <td colSpan={props.columns.length}>
                        <ErrorMessage
                            error={props.filterError}
                            onRefreshClick={props.onTableFilterRefreshClick}
                        />
                    </td>
                </tr>
            )}
        </thead>
    );
};

export default TableHeader;
