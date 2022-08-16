import { JSONObject } from 'Common/Types/JSON';
import React, { FunctionComponent, ReactElement } from 'react';
import Columns from './Types/Columns';
import Pagination from './Pagination';
import ActionButtonSchema from './Types/ActionButtonSchema';
import ErrorMessage from './ErrorMessage';
import TableLoader from './Loader';
import ListBody from './ListBody';

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
    noItemsMessage?: undefined | string;
}

const List: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const getListbody: Function = (): ReactElement => {
        if (props.isLoading) {
            return <TableLoader />;
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
                columns={props.columns}
                actionButtons={props.actionButtons}
            />
        );
    };

    return (
        <div className="table-responsive">
            {getListbody()}
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
    );
};

export default List;
