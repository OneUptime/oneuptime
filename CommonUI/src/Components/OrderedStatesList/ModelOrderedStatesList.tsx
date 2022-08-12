import BaseModel from 'Common/Models/BaseModel';
import React, { ReactElement } from 'react';
import Query from '../../Utils/ModelAPI/Query';


export interface ComponentProps<TBaseModel extends BaseModel> {
    modelType: { new (): TBaseModel };
    query: Query<TBaseModel>, 
    idField: string, 
    textField: string, 
    isDeleteable: boolean;
    isEditable: boolean;
    isCreateable: boolean;
}

const ModelOrderedStatesList: Function = <TBaseModel extends BaseModel>(
    props: ComponentProps<TBaseModel>
): ReactElement => {
    return <div>

    </div>
};

export default ModelOrderedStatesList;
