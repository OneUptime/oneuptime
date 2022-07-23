import { JSONObject } from 'Common/Types/JSON';
import React, { FunctionComponent, ReactElement } from 'react';
import TableRow from './TableRow';
import ActionButtonSchema, { ActionType } from './Types/ActionButtonSchema';
import Columns from './Types/Columns';

export interface ComponentProps {
    data: Array<JSONObject>;
    id: string;
    columns: Columns;
    actionButtons?: undefined | Array<ActionButtonSchema> | undefined;
    onActionEvent?: ((actionType: ActionType, item: JSONObject) => void) | undefined;
}

const TableBody: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <tbody id={props.id}>
            {props.data &&
                props.data.map((item: JSONObject, i: number) => {
                    return (
                        <TableRow key={i} item={item} columns={props.columns} actionButtons={props.actionButtons} onActionEvent={props.onActionEvent} />
                    );
                })}
        </tbody>
    );
};

export default TableBody;
