import { JSONObject } from 'Common/Types/JSON';
import React, { FunctionComponent, ReactElement } from 'react';
import TableRow from './TableRow';
import ActionButtonSchema from '../ActionButton/ActionButtonSchema';
import Columns from './Types/Columns';
import { Droppable, DroppableProvided } from 'react-beautiful-dnd';
import GenericObject from 'Common/Types/GenericObject';

export interface ComponentProps<T extends GenericObject> {
    data: Array<T>;
    id: string;
    columns: Columns<T>;
    actionButtons?: undefined | Array<ActionButtonSchema<T>> | undefined;
    enableDragAndDrop?: undefined | boolean;
    dragAndDropScope?: string | undefined;
    dragDropIdField?: string | undefined;
    dragDropIndexField?: string | undefined;
}

const TableBody = <T extends GenericObject>(
    props: ComponentProps<T>
): ReactElement => {
    type GetBodyFunction = (provided?: DroppableProvided) => ReactElement;

    const getBody: GetBodyFunction = (
        provided?: DroppableProvided
    ): ReactElement => {
        return (
            <tbody
                id={props.id}
                ref={provided?.innerRef}
                {...provided?.droppableProps}
                className="divide-y divide-gray-200 bg-white"
            >
                {props.data &&
                    props.data.map((item: T, i: number) => {
                        return (
                            <TableRow
                                dragAndDropScope={props.dragAndDropScope}
                                enableDragAndDrop={props.enableDragAndDrop}
                                key={i}
                                item={item}
                                columns={props.columns}
                                actionButtons={props.actionButtons}
                                dragDropIdField={props.dragDropIdField}
                                dragDropIndexField={props.dragDropIndexField}
                            />
                        );
                    })}
                {provided?.placeholder}
            </tbody>
        );
    };

    if (props.enableDragAndDrop) {
        return (
            <Droppable droppableId={props.dragAndDropScope || ''}>
                {(provided: DroppableProvided) => {
                    return getBody(provided);
                }}
            </Droppable>
        );
    }
    return getBody();
};

export default TableBody;
