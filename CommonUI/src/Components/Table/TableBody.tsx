import { JSONObject } from 'Common/Types/JSON';
import React, { FunctionComponent, ReactElement } from 'react';
import TableRow from './TableRow';
import Columns from './Types/Columns';

export interface ComponentProps {
    data: Array<JSONObject>;
    id: string;
    columns: Columns;
}

const TableBody: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <tbody id={props.id}>
            {props.data &&
                props.data.map((item: JSONObject, i: number) => {
                    return (
                        <TableRow key={i} item={item} columns={props.columns} />
                    );
                })}
        </tbody>
    );
};

export default TableBody;
