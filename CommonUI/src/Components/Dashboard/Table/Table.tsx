import React, { FC, ReactElement } from 'react';
import TableRecord, { TableColumn } from './Type/Table';

export interface ComponentProps {
    columns: Array<TableColumn>;
    records: Array<TableRecord>;
}

const Table: FC<ComponentProps> = ({ columns, records }): ReactElement => {
    return (
        <table>
            <thead>
                <tr>
                    {columns.map(column => (
                        <th key={column.key}>{column.title}</th>
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
