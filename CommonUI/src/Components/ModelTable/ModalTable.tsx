import BaseModel from 'Common/Models/BaseModel';
import React, { ReactElement, useEffect } from 'react';
import Columns from './Columns';
import Table from '../Table/Table';
import TableColumn from '../Table/Types/Column';
import { JSONObject } from 'Common/Types/JSON';
import Card, { ComponentProps as CardComponentProps } from '../Card/Card';

export interface ComponentProps<TBaseModel extends BaseModel> {
    model: TBaseModel;
    id: string;
    onFetchInit?: (pageNumber: number, itemsOnPage: number) => void;
    onFetchSuccess?: (data: Array<TBaseModel>, totalCount: number) => void;
    cardProps: CardComponentProps;
    columns: Columns<TBaseModel>;
    itemsOnPage: number;
    disablePagination?: boolean;
}

const ModalTable: Function = <TBaseModel extends BaseModel>(
    props: ComponentProps<TBaseModel>
): ReactElement => {
    const columns: Array<TableColumn> = [];
    const data: Array<JSONObject> = [];

    useEffect(() => {
        /// Convert ModelColumns to TableColumns.
        for (const column of props.columns) {
            columns.push({
                title: column.title,
                disbaleSort: column.disbaleSort || false,
                type: column.type,
                key: column.field
                    ? (Object.keys(column.field)[0] as string)
                    : null,
            });
        }
    });

    return (
        <Card {...props.cardProps}>
            <Table
                data={data}
                id={props.id}
                columns={columns}
                itemsOnPage={props.itemsOnPage}
                disablePagination={props.disablePagination || false}
            />
        </Card>
    );
};

export default ModalTable;
