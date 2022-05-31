import React, { FC, ReactElement } from 'react';
import TableRecord from './Type/Table';

export interface ComponentProps {
    columns: Array<string>;
    records: Array<TableRecord>;
}

const Table: FC<ComponentProps> = ({ columns, records }): ReactElement => {
    return (
        <table>
            <thead>
                <tr>
                    {columns.map(column => (
                        <th key={column}>{column}</th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {records.length > 0 ? (
                    records.map(record => (
                        <tr>
                            <td>{record.title}</td>
                        </tr>
                    ))
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
