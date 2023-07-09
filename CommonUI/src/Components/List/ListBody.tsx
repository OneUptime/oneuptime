import { JSONObject } from 'Common/Types/JSON';
import React, { FunctionComponent, ReactElement } from 'react';
import ListRow, { ListDetailProps } from './ListRow';
import ActionButtonSchema from '../ActionButton/ActionButtonSchema';
import Field from '../Detail/Field';
import { Droppable, DroppableProvided } from 'react-beautiful-dnd';

export interface ComponentProps {
    data: Array<JSONObject>;
    id: string;
    fields: Array<Field>;
    actionButtons?: undefined | Array<ActionButtonSchema> | undefined;
    enableDragAndDrop?: undefined | boolean;
    dragAndDropScope?: string | undefined;
    dragDropIdField?: string | undefined;
    dragDropIndexField?: string | undefined;
    listDetailOptions?: undefined | ListDetailProps;
}

const ListBody: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const getBody: Function = (provided?: DroppableProvided): ReactElement => {
        return (
            <div
                ref={provided?.innerRef}
                {...provided?.droppableProps}
                id={props.id}
                className="space-y-6"
            >
                {props.data &&
                    props.data.map((item: JSONObject, i: number) => {
                        return (
                            <ListRow
                                key={i}
                                item={item}
                                fields={props.fields}
                                actionButtons={props.actionButtons}
                                dragAndDropScope={props.dragAndDropScope}
                                enableDragAndDrop={props.enableDragAndDrop}
                                dragDropIdField={props.dragDropIdField}
                                dragDropIndexField={props.dragDropIndexField}
                                listDetailOptions={props.listDetailOptions}
                            />
                        );
                    })}
            </div>
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

export default ListBody;
