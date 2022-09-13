import { JSONObject } from 'Common/Types/JSON';
import React, { FunctionComponent, ReactElement } from 'react';
import TableBody from './TableBody';
import TableHeader, { FilterData } from './TableHeader';
import Columns from './Types/Columns';
import Pagination from '../Pagination/Pagination';
import SortOrder from 'Common/Types/Database/SortOrder';
import ActionButtonSchema from '../ActionButton/ActionButtonSchema';
import ErrorMessage from '../ErrorMessage/ErrorMessage';
import ComponentLoader from '../ComponentLoader/ComponentLoader';
import { DragDropContext, DropResult } from 'react-beautiful-dnd';

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
    const getTablebody: Function = (): ReactElement => {
        if (props.isLoading) {
            return (
                <tbody>
                    <tr>
                        <td colSpan={props.columns.length}>
                            <ComponentLoader />
                        </td>
                    </tr>
                </tbody>
            );
        }

        if (props.error) {
            return (
                <tbody>
                    <tr>
                        <td colSpan={props.columns.length}>
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
                        <td colSpan={props.columns.length}>
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
        <DragDropContext onDragEnd={(result: DropResult) => {
            result.destination?.index && props.onDragDrop && props.onDragDrop(result.draggableId, result.destination.index);
        }}>
            <div className="table-responsive">
                <table className="table mb-0 table">
                    <TableHeader
                        id={`${props.id}-header`}
                        columns={props.columns}
                        onSortChanged={props.onSortChanged}
                        showFilter={props.showFilter || false}
                        onFilterChanged={props.onFilterChanged || undefined}
                        isTableFilterLoading={props.isTableFilterLoading}
                        filterError={props.filterError}
                        enableDragAndDrop={props.enableDragAndDrop}
                        onTableFilterRefreshClick={props.onTableFilterRefreshClick}
                    />
                    {getTablebody()}
                </table>
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
    );
};

export default Table;
