import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faSortAlphaUpAlt,
    faSortAlphaDownAlt,
    faUnsorted,
} from '@fortawesome/free-solid-svg-icons';
import React, { FC, ReactElement } from 'react';
import TableRecord, { ColumnSort, TableColumn } from './Type/Table';
import { IconProp } from '@fortawesome/fontawesome-svg-core';

export interface ComponentProps {
    columns: Array<TableColumn>;
    records: Array<TableRecord>;
}

const Table: FC<ComponentProps> = ({ columns, records }): ReactElement => {
    const getSortIcon = (direction: ColumnSort): IconProp => {
        if (!direction || direction === ColumnSort.DEFAULT) {
            return faUnsorted;
        } else {
            if (direction === ColumnSort.ASC) {
                return faSortAlphaUpAlt;
            }

            return faSortAlphaDownAlt;
        }
    };

    return (
        <table>
            <thead>
                <tr>
                    {columns.map(column => (
                        <th key={column.key}>
                            {column.title}
                            {column.isSortable && (
                                <FontAwesomeIcon
                                    icon={getSortIcon(
                                        column.sortDirection ||
                                            ColumnSort.DEFAULT
                                    )}
                                />
                            )}
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {records.length > 0 ? (
                    records.map((record, index) => {
                        return (
                            <tr key={index}>
                                {columns.map((item, index) => (
                                    <td key={index}>{record[item.key]}</td>
                                ))}
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
