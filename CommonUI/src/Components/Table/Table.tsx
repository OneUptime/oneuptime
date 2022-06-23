import React, { FunctionComponent, ReactElement } from 'react';
import TableBody from './TableBody';
import TableHeader from './TableHeader';
import TableRow from './TableRow';

export interface ComponentProps {}

const Table: FunctionComponent<ComponentProps> = (
    _props: ComponentProps
): ReactElement => {
    return (
        <div className="table-responsive">
            <table className="table mb-0 table">
                <TableHeader />
                <TableBody>
                    <TableRow />
                    <TableRow />
                </TableBody>
            </table>
        </div>
    );
};

export default Table;
