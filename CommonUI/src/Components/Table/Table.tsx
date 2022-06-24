import { JSONObject } from 'Common/Types/JSON';
import React, { FunctionComponent, ReactElement } from 'react';
import TableBody from './TableBody';
import TableHeader from './TableHeader';
import Columns from "./Types/Columns";

export interface ComponentProps {
    data: Array<JSONObject>
    id: string;
    columns: Columns;
    itemsOnPage: number;
    disablePagination?: boolean;
}

const Table: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <div className="table-responsive">
            <table className="table mb-0 table">
                <TableHeader id={`${props.id}-header`} columns={props.columns} />
                <TableBody id={`${props.id}-body`} data={props.data} columns={props.columns}/>
            </table>
        </div>
    );
};

export default Table;
