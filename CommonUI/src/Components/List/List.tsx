import { JSONObject } from 'Common/Types/JSON';
import React, { FunctionComponent, ReactElement } from 'react';
import Pagination from '../Pagination/Pagination';
import ActionButtonSchema from '../ActionButton/ActionButtonSchema';
import ErrorMessage from '../ErrorMessage/ErrorMessage';
import ComponentLoader from '../ComponentLoader/ComponentLoader';
import ListBody from './ListBody';
import Field from '../Detail/Field';
import { DragDropContext, DropResult } from 'react-beautiful-dnd';
import { ListDetailProps } from './ListRow';

export interface ComponentProps {
    data: Array<JSONObject>;
    id: string;
    fields: Array<Field>;
    disablePagination?: undefined | boolean;
    onNavigateToPage: (pageNumber: number, itemsOnPage: number) => void;
    currentPageNumber: number;
    totalItemsCount: number;
    itemsOnPage: number;
    enableDragAndDrop?: boolean | undefined;
    dragDropIndexField?: string | undefined;
    dragDropIdField?: string | undefined;
    onDragDrop?: ((id: string, newIndex: number) => void) | undefined;
    error: string;
    isLoading: boolean;
    singularLabel: string;
    pluralLabel: string;
    actionButtons?: undefined | Array<ActionButtonSchema>;
    onRefreshClick?: undefined | (() => void);
    noItemsMessage?: undefined | string;
    listDetailOptions?: undefined | ListDetailProps;
}

const List: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const getListbody: Function = (): ReactElement => {
        if (props.isLoading) {
            return <ComponentLoader />;
        }

        if (props.error) {
            return (
                <ErrorMessage
                    error={props.error}
                    onRefreshClick={props.onRefreshClick}
                />
            );
        }

        if (props.data.length === 0) {
            return (
                <ErrorMessage
                    error={
                        props.noItemsMessage
                            ? props.noItemsMessage
                            : `No ${props.singularLabel.toLocaleLowerCase()}`
                    }
                    onRefreshClick={props.onRefreshClick}
                />
            );
        }

        return (
            <ListBody
                id={`${props.id}-body`}
                data={props.data}
                fields={props.fields}
                actionButtons={props.actionButtons}
                enableDragAndDrop={props.enableDragAndDrop}
                dragAndDropScope={`${props.id}-dnd`}
                dragDropIdField={props.dragDropIdField}
                dragDropIndexField={props.dragDropIndexField}
                listDetailOptions={props.listDetailOptions}
            />
        );
    };

    return (
        <div>
            <DragDropContext
                onDragEnd={(result: DropResult) => {
                    result.destination?.index &&
                        props.onDragDrop &&
                        props.onDragDrop(
                            result.draggableId,
                            result.destination.index
                        );
                }}
            >
                {getListbody()}
            </DragDropContext>
            {!props.disablePagination && (
                <div className=" -ml-6 mt-5 -mr-6 -mb-6">
                    <Pagination
                        singularLabel={props.singularLabel}
                        pluralLabel={props.pluralLabel}
                        currentPageNumber={props.currentPageNumber}
                        totalItemsCount={props.totalItemsCount}
                        itemsOnPage={props.itemsOnPage}
                        onNavigateToPage={props.onNavigateToPage}
                        isLoading={props.isLoading}
                        isError={Boolean(props.error)}
                    />
                </div>
            )}
        </div>
    );
};

export default List;
