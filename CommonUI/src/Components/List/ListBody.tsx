import ActionButtonSchema from '../ActionButton/ActionButtonSchema';
import Field from '../Detail/Field';
import ListRow, { ListDetailProps } from './ListRow';
import GenericObject from 'Common/Types/GenericObject';
import React, { ReactElement } from 'react';
import { Droppable, DroppableProvided } from 'react-beautiful-dnd';

export interface ComponentProps<T extends GenericObject> {
    data: Array<T>;
    id: string;
    fields: Array<Field<T>>;
    actionButtons?: undefined | Array<ActionButtonSchema<T>> | undefined;
    enableDragAndDrop?: undefined | boolean;
    dragAndDropScope?: string | undefined;
    dragDropIdField?: keyof T | undefined;
    dragDropIndexField?: keyof T | undefined;
    listDetailOptions?: undefined | ListDetailProps;
}

type ListBodyFunction = <T extends GenericObject>(
    props: ComponentProps<T>
) => ReactElement;

const ListBody: ListBodyFunction = <T extends GenericObject>(
    props: ComponentProps<T>
): ReactElement => {
    type GetBodyFunction = (provided?: DroppableProvided) => ReactElement;

    const getBody: GetBodyFunction = (
        provided?: DroppableProvided
    ): ReactElement => {
        return (
            <div
                ref={provided?.innerRef}
                {...provided?.droppableProps}
                id={props.id}
                className="space-y-6 p-6 border-t border-gray-200"
            >
                {props.data &&
                    props.data.map((item: T, i: number) => {
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
