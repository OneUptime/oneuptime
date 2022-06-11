import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faSortAlphaUpAlt,
    faSortAlphaDownAlt,
    faUnsorted,
} from '@fortawesome/free-solid-svg-icons';
import React, { FunctionComponent, ReactElement } from 'react';
import { ColumnSort, TableColumn } from './Type/Table';
import { IconProp } from '@fortawesome/fontawesome-svg-core';
import { JSONObject } from 'Common/Types/JSON';

export interface ComponentProps {
    columns: Array<TableColumn>;
    records: Array<JSONObject>;
}

const Table: FunctionComponent<ComponentProps> = ({
    columns,
    records,
}: ComponentProps): ReactElement => {
    const getSortIcon: Function = (direction: ColumnSort): IconProp => {
        if (!direction || direction === ColumnSort.DEFAULT) {
            return faUnsorted;
        }
        if (direction === ColumnSort.ASC) {
            return faSortAlphaUpAlt;
        }

        return faSortAlphaDownAlt;
    };

    return (
        <table>
            <thead>
                <tr>
                    {columns.map((column: TableColumn, i: number) => {
                        return (
                            <th key={column.key}>
                                {column.title}
                                {column.isSortable && (
                                    <FontAwesomeIcon
                                        key={i}
                                        icon={getSortIcon(
                                            column.sortDirection ||
                                                ColumnSort.DEFAULT
                                        )}
                                    />
                                )}
                            </th>
                        );
                    })}
                </tr>
            </thead>
            <tbody>
                {records.length > 0 ? (
                    records.map((record: JSONObject, index: number) => {
                        return (
                            <tr key={index}>
                                {columns.map((item: TableColumn, index: number) => {
                                    return (
                                        <td key={index}>
                                            {record[item.key] as string}
                                        </td>
                                    );
                                })}
                            </tr>
                        );
                    })
                ) : (
                    <tr>
                        <td
                            colSpan={columns.length}
                            style={{
                                textAlign: 'center',
                            }}
                        >
                            No record found
                        </td>
                    </tr>
                )}
            </tbody>
        </table>
    );
};

export default Table;
