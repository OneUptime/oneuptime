import { JSONObject } from 'Common/Types/JSON';
import React, { FunctionComponent, ReactElement } from 'react';
import Pagination from '../Pagination/Pagination';
import ActionButtonSchema from '../ActionButton/ActionButtonSchema';
import ErrorMessage from '../ErrorMessage/ErrorMessage';
import ComponentLoader from '../ComponentLoader/ComponentLoader';
import ListBody from './ListBody';
import Field from '../Detail/Field';

export interface ComponentProps {
    data: Array<JSONObject>;
    id: string;
    fields: Array<Field>;
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
            />
        );
    };

    return (
        <div>
            {getListbody()}
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
