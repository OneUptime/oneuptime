import React, { FunctionComponent, ReactElement, useState } from 'react';
import Column from './Types/Column';
import Columns from './Types/Columns';
import Icon, { IconProp, ThickProp } from '../Icon/Icon';
import SortOrder from 'Common/Types/Database/SortOrder';
import Dictionary from 'Common/Types/Dictionary';
import Input from '../Input/Input';

export interface ComponentProps {
    columns: Columns;
    id: string;
    onSortChanged: (sortBy: string, sortOrder: SortOrder) => void;
    showFilter: boolean;
    onFilterChanged?:
        | undefined
        | ((filterData: Dictionary<string | boolean>) => void)
        | undefined;
}

const TableHeader: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [currentSortColumn, setCurrentSortColumn] = useState<string>('');
    const [sortOrder, setSortOrder] = useState<SortOrder>(SortOrder.Ascending);
    const [filterData, setFilterData] = useState<Dictionary<string | boolean>>(
        {}
    );

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
                            style={{
                                textAlign:
                                    i === props.columns.length - 1
                                        ? 'right'
                                        : 'left',
                            }}
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
                                        onChange={(changedValue: string) => {
                                            if (column.key) {
                                                filterData[column.key] =
                                                    changedValue;
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
