import { JSONObject } from 'Common/Types/JSON';
import React, { FunctionComponent, ReactElement } from 'react';
import Column from './Types/Column';
import Columns from './Types/Columns';

export interface ComponentProps {
    item: JSONObject;
    columns: Columns;
}

const TableRow: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <tr>
            {props.columns &&
                props.columns.map((column: Column, i: number) => {
                    return (
                        <td key={i}>
                            {column.key ? (
                                (props.item[column.key] as string)
                            ) : (
                                <></>
                            )}
                        </td>
                    );
                })}
        </tr>
    );
};

export default TableRow;
