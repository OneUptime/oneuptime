import { JSONObject } from 'Common/Types/JSON';
import React, { FunctionComponent, ReactElement } from 'react';
import TableRow from './TableRow';
import ActionButtonSchema from '../ActionButton/ActionButtonSchema';
import Columns from './Types/Columns';

export interface ComponentProps {
    data: Array<JSONObject>;
    id: string;
    columns: Columns;
    actionButtons?: undefined | Array<ActionButtonSchema> | undefined;
    enableDragAndDrop?: undefined | boolean;
    dragAndDropScope?: string | undefined;
}

const TableBody: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return (
        <tbody id={props.id}>
            {props.data &&
                props.data.map((item: JSONObject, i: number) => {
                    return (
                        <TableRow
                            dragAndDropScope={props.dragAndDropScope}
                            enableDragAndDrop={props.enableDragAndDrop}
                            key={i}
                            item={item}
                            columns={props.columns}
                            actionButtons={props.actionButtons}
                        />
                    );
                })}
        </tbody>
    );
};

export default TableBody;
