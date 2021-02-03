import React from 'react';
import TableBody from './TableBody';
import TableHeader from './TableHeader';
const Table = ({ ssoDefaultRoles }) => (
    <table className="Table">
        <TableHeader />
        <TableBody ssoDefaultRoles={ssoDefaultRoles} />
    </table>
);

export default Table;
