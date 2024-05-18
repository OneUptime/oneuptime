import React, { ReactElement, useEffect, useState } from 'react';
import TableBody from './TableBody';
import TableHeader from './TableHeader';
import Columns from './Types/Columns';
import Pagination from '../Pagination/Pagination';
import SortOrder from 'Common/Types/BaseDatabase/SortOrder';
import ActionButtonSchema from '../ActionButton/ActionButtonSchema';
import ErrorMessage from '../ErrorMessage/ErrorMessage';
import ComponentLoader from '../ComponentLoader/ComponentLoader';
import { DragDropContext, DropResult } from 'react-beautiful-dnd';
import FilterData from '../Filters/Types/FilterData';
import Filter from '../Filters/Types/Filter';
import { GetReactElementFunction } from '../../Types/FunctionTypes';
import GenericObject from 'Common/Types/GenericObject';
import FilterViewer from '../Filters/FilterViewer';
import BulkUpdateForm, {
    BulkActionButtonSchema,
} from '../BulkUpdate/BulkUpdateForm';

export interface BulkActionProps<T extends GenericObject> {
    buttons: Array<BulkActionButtonSchema<T>>;
}

export interface ComponentProps<T extends GenericObject> {
    data: Array<T>;
    id: string;
    columns: Columns<T>;

    disablePagination?: undefined | boolean;
    onNavigateToPage: (pageNumber: number, itemsOnPage: number) => void;
    currentPageNumber: number;
    totalItemsCount: number;
    itemsOnPage: number;
    error: string;
    isLoading: boolean;
    singularLabel: string;
    pluralLabel: string;
    actionButtons?: undefined | Array<ActionButtonSchema<T>>;
    onRefreshClick?: undefined | (() => void);

    noItemsMessage?: undefined | string;
    onSortChanged: (sortBy: keyof T | null, sortOrder: SortOrder) => void;

    isFilterLoading?: undefined | boolean;
    filters?: Array<Filter<T>>;
    showFilterModal?: undefined | boolean;
    filterError?: string | undefined;
    onFilterChanged?: undefined | ((filterData: FilterData<T>) => void);
    onFilterRefreshClick?: undefined | (() => void);
    onFilterModalClose: () => void;
    onFilterModalOpen: () => void;

    enableDragAndDrop?: boolean | undefined;
    dragDropIndexField?: keyof T | undefined;
    dragDropIdField?: keyof T | undefined;
    onDragDrop?: ((id: string, newIndex: number) => void) | undefined;

    // bulk actions
    bulkActions: BulkActionProps<T>;
    bulkSelectedItems: Array<T>;
    onBulkSelectedItemAdded: (item: T) => void;
    onBulkSelectedItemRemoved: (item: T) => void;
    onBulkSelectAllItems: () => void;
    onBulkSelectItemsOnCurrentPage: () => void;
    onBulkClearAllItems: () => void;
    matchBulkSelectedItemByField: keyof T; // which field to use to match selected items. For exmaple this could be '_id'
    onBulkActionEnd: () => void;
    onBulkActionStart: () => void;
}

type TableFunction = <T extends GenericObject>(
    props: ComponentProps<T>
) => ReactElement;

const Table: TableFunction = <T extends GenericObject>(
    props: ComponentProps<T>
): ReactElement => {
    const isBulkActionsEnabled: boolean =
        props.bulkActions &&
        props.bulkActions.buttons &&
        props.bulkActions.buttons.length > 0;

    const [isAllItemsSelected, setIsAllItemsSelected] =
        useState<boolean>(false);
    const [bulkSelectedItems, setBulkSelectedItems] = useState<Array<T>>([]);

    useEffect(() => {
        setBulkSelectedItems(props.bulkSelectedItems);
    }, [props.bulkSelectedItems]);

    let colspan: number = props.columns.length || 0;
    if (props.actionButtons && props.actionButtons?.length > 0) {
        colspan++;
    }

    const getTablebody: GetReactElementFunction = (): ReactElement => {
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
                        <td colSpan={colspan} className="pl-10 pr-10">
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
                isBulkActionsEnabled={isBulkActionsEnabled}
                onItemSelected={(item: T) => {
                    // set bulk selected items.
                    setBulkSelectedItems([...bulkSelectedItems, item]);
                    props.onBulkSelectedItemAdded(item);
                }}
                onItemDeselected={(item: T) => {
                    // set bulk selected items.
                    const index: number = bulkSelectedItems.findIndex((x: T) => {
                        return (
                            x[
                                props.matchBulkSelectedItemByField
                            ]?.toString() ===
                            item[props.matchBulkSelectedItemByField]?.toString()
                        );
                    });

                    if (index > -1) {
                        bulkSelectedItems.splice(index, 1);
                    }

                    props.onBulkSelectedItemRemoved(item);
                }}
                selectedItems={bulkSelectedItems}
                matchBulkSelectedItemByField={
                    props.matchBulkSelectedItemByField
                }
            />
        );
    };

    return (
        <div>
            <FilterViewer
                id={`${props.id}-filter`}
                showFilterModal={props.showFilterModal || false}
                onFilterChanged={props.onFilterChanged || undefined}
                isModalLoading={props.isFilterLoading || false}
                filterError={props.filterError}
                onFilterRefreshClick={props.onFilterRefreshClick}
                filters={props.filters || []}
                onFilterModalClose={props.onFilterModalClose}
                onFilterModalOpen={props.onFilterModalOpen}
                singularLabel={props.singularLabel}
                pluralLabel={props.pluralLabel}
            />
            {props.bulkActions?.buttons && (
                <BulkUpdateForm
                    buttons={props.bulkActions.buttons}
                    onClearSelectionClick={() => {
                        props.onBulkClearAllItems();
                        setIsAllItemsSelected(false);
                    }}
                    onSelectAllClick={() => {
                        props.onBulkSelectAllItems();
                        setIsAllItemsSelected(true);
                    }}
                    selectedItems={bulkSelectedItems}
                    singularLabel={props.singularLabel}
                    pluralLabel={props.pluralLabel}
                    isAllItemsSelected={isAllItemsSelected}
                    onActionStart={props.onBulkActionStart}
                    onActionEnd={props.onBulkActionEnd}
                />
            )}
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
                <div className="-my-2 overflow-x-auto -mx-6">
                    <div className="inline-block min-w-full py-2 align-middle">
                        <div className="overflow-hidden border-t border-gray-200">
                            <table className="min-w-full divide-y divide-gray-200">
                                <TableHeader
                                    id={`${props.id}-header`}
                                    columns={props.columns}
                                    onSortChanged={props.onSortChanged}
                                    enableDragAndDrop={props.enableDragAndDrop}
                                    isBulkActionsEnabled={isBulkActionsEnabled}
                                    onAllItemsDeselected={() => {
                                        setIsAllItemsSelected(false);
                                        props.onBulkClearAllItems();
                                    }}
                                    onAllItemsSelected={() => {
                                        props.onBulkSelectItemsOnCurrentPage();
                                    }}
                                    isAllBulkItemsChecked={isAllItemsSelected}
                                    hasTableItems={props.data.length > 0}
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
