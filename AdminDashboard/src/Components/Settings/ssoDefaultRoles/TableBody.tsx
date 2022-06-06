import React from 'react';
import PropTypes from 'prop-types';
import TableRow from './TableRow';
import TableEmptyRow from './TableEmptyRow';

const TableBody: Function = ({ ssoDefaultRoles }: $TSFixMe) => {
    return (
        <tbody className="Table-body">
            {ssoDefaultRoles.length ? (
                ssoDefaultRoles.map((item: $TSFixMe, index: $TSFixMe) => {
                    return <TableRow key={index} data={item} />;
                })
            ) : (
                <TableEmptyRow />
            )}
        </tbody>
    );
};

TableBody.displayName = 'TableBody';

TableBody.propTypes = {
    ssoDefaultRoles: PropTypes.string,
};

export default TableBody;
