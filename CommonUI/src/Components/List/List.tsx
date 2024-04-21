import React, { ReactElement } from 'react';
import Pagination from '../Pagination/Pagination';
import ActionButtonSchema from '../ActionButton/ActionButtonSchema';
import ErrorMessage from '../ErrorMessage/ErrorMessage';
import ComponentLoader from '../ComponentLoader/ComponentLoader';
import ListBody from './ListBody';
import Field from '../Detail/Field';
import { DragDropContext, DropResult } from 'react-beautiful-dnd';
import { ListDetailProps } from './ListRow';
import { GetReactElementFunction } from '../../Types/FunctionTypes';
import FilterType from '../Filters/Types/Filter';
import Filter, { FilterData } from '../Filters/Filter';
import GenericObject from 'Common/Types/GenericObject';

export interface ComponentProps<T extends GenericObject> {
    data: Array<T>;
    id: string;
    fields: Array<Field<T>>;
    disablePagination?: undefined | boolean;
    onNavigateToPage: (pageNumber: number, itemsOnPage: number) => void;
    currentPageNumber: number;
    totalItemsCount: number;
    itemsOnPage: number;
    enableDragAndDrop?: boolean | undefined;
    dragDropIndexField?: keyof T | undefined;
    dragDropIdField?: keyof T | undefined;
    onDragDrop?: ((id: string, newIndex: number) => void) | undefined;
    error: string;
    isLoading: boolean;
    singularLabel: string;
    pluralLabel: string;
    actionButtons?: undefined | Array<ActionButtonSchema<T>>;
    onRefreshClick?: undefined | (() => void);
    noItemsMessage?: undefined | string;
    listDetailOptions?: undefined | ListDetailProps;

    isFilterLoading?: undefined | boolean;
    filters?: Array<FilterType<T>>;
    showFilter?: undefined | boolean;
    filterError?: string | undefined;
    onFilterChanged?: undefined | ((filterData: FilterData<T>) => void);
    onFilterRefreshClick?: undefined | (() => void);
}

type ListFunction = <T extends GenericObject>(
    props: ComponentProps<T>
) => ReactElement;

const List: ListFunction = <T extends GenericObject>(
    props: ComponentProps<T>
): ReactElement => {
    const getListbody: GetReactElementFunction = (): ReactElement => {
        if (props.isLoading) {
            return <ComponentLoader />;
        }

        if (props.error) {
            return (
                <div className="p-6">
                    <ErrorMessage
                        error={props.error}
                        onRefreshClick={props.onRefreshClick}
                    />
                </div>
            );
        }

        if (props.data.length === 0) {
            return (
                <div className="p-6">
                    <ErrorMessage
                        error={
                            props.noItemsMessage
                                ? props.noItemsMessage
                                : `No ${props.singularLabel.toLocaleLowerCase()}`
                        }
                        onRefreshClick={props.onRefreshClick}
                    />
                </div>
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
        <div data-testid="list-container">
            <div className="mt-6">
                <div className="bg-white pr-6 pl-6">
                    <Filter
                        id={`${props.id}-filter`}
                        showFilter={props.showFilter || false}
                        onFilterChanged={props.onFilterChanged || undefined}
                        isFilterLoading={props.isFilterLoading}
                        filterError={props.filterError}
                        onFilterRefreshClick={props.onFilterRefreshClick}
                        filters={props.filters || []}
                    />
                </div>
                <div className="">
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
                        <div className="mt-5 -mb-6">
                            <Pagination
                                singularLabel={props.singularLabel}
                                pluralLabel={props.pluralLabel}
                                currentPageNumber={props.currentPageNumber}
                                totalItemsCount={props.totalItemsCount}
                                itemsOnPage={props.itemsOnPage}
                                onNavigateToPage={props.onNavigateToPage}
                                isLoading={props.isLoading}
                                isError={Boolean(props.error)}
                                dataTestId="list-pagination"
                            />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default List;
