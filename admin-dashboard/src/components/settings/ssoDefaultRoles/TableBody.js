import React from 'react';
import TableRow from './TableRow';
import TableEmptyRow from './TableEmptyRow';

const TableBody = ({ ssoDefaultRoles }) => (
    <tbody className="Table-body">
        {ssoDefaultRoles.length ? (
            ssoDefaultRoles.map((item, index) => (
                <TableRow key={index} data={item} />
            ))
        ) : (
            <TableEmptyRow />
        )}
    </tbody>
);

export default TableBody;
