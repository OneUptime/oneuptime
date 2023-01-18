import { JSONObject } from 'Common/Types/JSON';
import React, { FunctionComponent, ReactElement } from 'react';
import TableBody from './TableBody';
import TableHeader from './TableHeader';
import Columns from './Types/Columns';
import Pagination from '../Pagination/Pagination';
import SortOrder from 'Common/Types/Database/SortOrder';
import ActionButtonSchema from '../ActionButton/ActionButtonSchema';
import ErrorMessage from '../ErrorMessage/ErrorMessage';
import ComponentLoader from '../ComponentLoader/ComponentLoader';
import { DragDropContext, DropResult } from 'react-beautiful-dnd';
import Filter, { FilterData } from './Filter';

export interface ComponentProps {
    data: Array<JSONObject>;
    id: string;
    columns: Columns;
    disablePagination?: undefined | boolean;
    onNavigateToPage: (pageNumber: number, itemsOnPage: number) => void;
    currentPageNumber: number;
    totalItemsCount: number;
    itemsOnPage: number;
    error: string;
    isLoading: boolean;
    singularLabel: string;
    pluralLabel: string;
    actionButtons?: undefined | Array<ActionButtonSchema>;
    onRefreshClick?: undefined | (() => void);
    onTableFilterRefreshClick?: undefined | (() => void);
    noItemsMessage?: undefined | string;
    onSortChanged: (sortBy: string, sortOrder: SortOrder) => void;
    showFilter?: undefined | boolean;
    isTableFilterLoading?: undefined | boolean;
    filterError?: string | undefined;
    onFilterChanged?: undefined | ((filterData: FilterData) => void);
    enableDragAndDrop?: boolean | undefined;
    dragDropIndexField?: string | undefined;
    dragDropIdField?: string | undefined;
    onDragDrop?: ((id: string, newIndex: number) => void) | undefined;
}

const Table: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    let colspan: number = props.columns.length || 0;
    if (props.actionButtons && props.actionButtons?.length > 0) {
        colspan++;
    }

    const getTablebody: Function = (): ReactElement => {
        if (props.isLoading) {
            return (
                <tbody>
                    <tr>
                        <td colSpan={colspan}>
                            <div className="flex justify-center w-full">
                                <ComponentLoader />
                            </div>
                        </td>
                    </tr>
                </tbody>
            );
        }

        if (props.error) {
            return (
                <tbody>
                    <tr>
                        <td colSpan={colspan}>
                            <ErrorMessage
                                error={props.error}
                                onRefreshClick={props.onRefreshClick}
                            />
                        </td>
                    </tr>
                </tbody>
            );
        }

        if (props.data.length === 0) {
            return (
                <tbody>
                    <tr>
                        <td colSpan={colspan}>
                            <ErrorMessage
                                error={
                                    props.noItemsMessage
                                        ? props.noItemsMessage
                                        : `No ${props.singularLabel.toLocaleLowerCase()}`
                                }
                                onRefreshClick={props.onRefreshClick}
                            />
                        </td>
                    </tr>
                </tbody>
            );
        }

        if (props.filterError) {
            return <></>;
        }

        return (
            <TableBody
                id={`${props.id}-body`}
                data={props.data}
                columns={props.columns}
                actionButtons={props.actionButtons}
                enableDragAndDrop={props.enableDragAndDrop}
                dragAndDropScope={`${props.id}-dnd`}
                dragDropIdField={props.dragDropIdField}
                dragDropIndexField={props.dragDropIndexField}
            />
        );
    };

    return (
        <div>
            <Filter
                id={`${props.id}-filter`}
                showFilter={props.showFilter || false}
                onFilterChanged={props.onFilterChanged || undefined}
                isTableFilterLoading={props.isTableFilterLoading}
                filterError={props.filterError}
                onTableFilterRefreshClick={props.onTableFilterRefreshClick}
                columns={props.columns}
            />
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
                <div className="-my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
                    <div className="inline-block min-w-full py-2 align-middle">
                        <div className="overflow-hidden border-t border-gray-200">
                            <table className="min-w-full divide-y divide-gray-200">
                                <TableHeader
                                    id={`${props.id}-header`}
                                    columns={props.columns}
                                    onSortChanged={props.onSortChanged}
                                    enableDragAndDrop={props.enableDragAndDrop}
                                />
                                {getTablebody()}
                            </table>
                        </div>
                    </div>
                </div>
                <div className="bg-gray-50 text-right -mr-6 -ml-6 -mb-6">
                    {!props.disablePagination && (
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
                    )}
                </div>
            </DragDropContext>
        </div>
    );
};

export default Table;
