import { JSONObject } from 'Common/Types/JSON';
import React, { FunctionComponent, ReactElement } from 'react';
import TableRow from './TableRow';
import ActionButtonSchema from '../ActionButton/ActionButtonSchema';
import Columns from './Types/Columns';
import { Droppable, DroppableProvided } from 'react-beautiful-dnd'

export interface ComponentProps {
    data: Array<JSONObject>;
    id: string;
    columns: Columns;
    actionButtons?: undefined | Array<ActionButtonSchema> | undefined;
    enableDragAndDrop?: undefined | boolean;
    dragAndDropScope?: string | undefined;
    dragDropIdField?: string | undefined;
    dragDropIndexField?: string | undefined;
}

const TableBody: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {

    const getBody: Function = (provided?: DroppableProvided): ReactElement => {

        return (<tbody id={props.id} ref={provided?.innerRef}  { ...provided?.droppableProps }>
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
                            dragDropIdField={props.dragDropIdField}
                            dragDropIndexField={props.dragDropIndexField}
                        />
                    );
                })}
            {provided?.placeholder}
        </tbody>);
    }

    if (props.enableDragAndDrop) {
        return (
            <Droppable droppableId={props.dragAndDropScope || ''}>
                {(provided) => getBody(provided)}
            </Droppable>
        );
    } else {
        return getBody();
    }
};

export default TableBody;
