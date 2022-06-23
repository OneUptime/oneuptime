import BaseModel from 'Common/Models/BaseModel';
import Route from 'Common/Types/API/Route';
import React, { FunctionComponent, ReactElement } from 'react';

export interface ComponentProps<TBaseModel extends BaseModel>  {
    model: TBaseModel;
    id: string;
    onFetchInit?: (pageNumber: number, itemsOnPage: number) => void;
    onFetchSuccess?: (data: Array<TBaseModel>, totalCount: number) => void

    // If this is populated, 
    // create button is shown on the card header 
    // and user can click on it and go to create form. 
    createPageRoute?: Route 

    columns: Fields<TBaseModel>;
    itemsOnPage: number; 
}

const ModalTable: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    return <div>{props.title}</div>;
};

export default ModalTable;
