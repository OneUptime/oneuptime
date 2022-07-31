import React, { FunctionComponent, ReactElement, useEffect, useState } from 'react';
import Column from './Types/Column';
import Columns from './Types/Columns';
import Icon, { IconProp, ThickProp } from '../Icon/Icon';
import SortOrder from 'Common/Types/Database/SortOrder';
import Dictionary from 'Common/Types/Dictionary';
import Input from '../Input/Input';
import TableColumnType from './Types/TableColumnType';
import Search from 'Common/Types/Database/Search';
import OneUptimeDate from 'Common/Types/Date';

export interface ComponentProps {
    columns: Columns;
    id: string;
    onSortChanged: (sortBy: string, sortOrder: SortOrder) => void;
    showFilter: boolean;
    onFilterChanged?:
        | undefined
        | ((filterData: Dictionary<string | boolean | Search | Date>) => void);
}

const TableHeader: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [currentSortColumn, setCurrentSortColumn] = useState<string>('');
    const [sortOrder, setSortOrder] = useState<SortOrder>(SortOrder.Ascending);

    // should filter on textboxes and checkboxes.
    const [filterData, setFilterData] = useState<Dictionary<string | boolean | Search | Date>>(
        {}
    );

    useEffect(() => {
        setFilterData({});
    }, [props.showFilter])

    return (
        <thead id={props.id}>
            <tr>
                {props.columns.map((column: Column, i: number) => {
                    const canSort: boolean =
                        !column.disableSort && Boolean(column.key);

                    return (
                        <th
                            key={i}
                            className={`${canSort ? 'pointer' : ''}`}
                            onClick={() => {
                                if (!column.key) {
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
                                className="flex"
                                style={{
                                    justifyContent:
                                        i === props.columns.length - 1
                                            ? 'end'
                                            : 'start',
                                }}
                            >
                                {column.title}
                                {canSort &&
                                    currentSortColumn === column.key &&
                                    sortOrder === SortOrder.Ascending && (
                                        <Icon
                                            icon={IconProp.ChevronUp}
                                            thick={ThickProp.Thick}
                                        />
                                    )}
                                {canSort &&
                                    currentSortColumn === column.key &&
                                    sortOrder === SortOrder.Descending && (
                                        <Icon
                                            icon={IconProp.ChevronDown}
                                            thick={ThickProp.Thick}
                                        />
                                    )}
                            </div>
                        </th>
                    );
                })}
            </tr>
            {props.showFilter && (
                <tr>
                    {props.columns.map((column: Column, i: number) => {
                        return (
                            <td key={i}>
                                {column.isFilterable && (
                                    <Input
                                        onChange={(changedValue: string | Date) => {
                                            if (column.key) {

                                                if (!changedValue) {
                                                    delete filterData[column.key];
                                                }

                                                if (changedValue && column.type === TableColumnType.Date) {
                                                    filterData[column.key] = OneUptimeDate.asDateForDatabaseQuery(changedValue as string);
                                                }
                                                
                                                if (changedValue && column.type === TableColumnType.Text) {
                                                    filterData[column.key] = new Search(changedValue as string);
                                                }
                                               
                                                setFilterData(filterData);

                                                if (props.onFilterChanged) {
                                                    props.onFilterChanged(
                                                        filterData
                                                    );
                                                }
                                            }
                                        }}
                                        initialValue={(
                                            filterData[column.key || ''] || ''
                                        ).toString()}
                                        placeholder={`Filter by ${column.title}`}
                                        className={'form-control'}
                                        type={column.type === TableColumnType.Date ? "date" : "text"}
                                    />
                                )}
                            </td>
                        );
                    })}
                </tr>
            )}
        </thead>
    );
};

export default TableHeader;
