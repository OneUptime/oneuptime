import BaseModel from 'Common/Models/BaseModel';
import Route from 'Common/Types/API/Route';
import React, { ReactElement, useEffect } from 'react';
import Columns from './Columns';
import Table from '../Table/Table';
import TableColumn from '../Table/Types/Column';
import { JSONObject } from 'Common/Types/JSON';

export interface ComponentProps<TBaseModel extends BaseModel> {
    model: TBaseModel;
    id: string;
    onFetchInit?: (pageNumber: number, itemsOnPage: number) => void;
    onFetchSuccess?: (data: Array<TBaseModel>, totalCount: number) => void

    // If this is populated, 
    // create button is shown on the card header 
    // and user can click on it and go to create form. 
    createPageRoute?: Route
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
                key:  Object.keys(column.field)[0] as string,
            })
        }
        
    });

    return (<Table data={data} id={props.id} columns={columns} itemsOnPage={props.itemsOnPage} disablePagination={props.disablePagination || false} />)
};

export default ModalTable;
