import BaseModel from 'Common/Models/BaseModel';
import CreateBy from './CreateBy';
import DeleteBy from './DeleteBy';
import FindBy from './FindBy';
import UpdateBy from './UpdateBy';

export type DatabaseTriggerType = 'on-create' | 'on-update' | 'on-delete';

export interface OnCreate<TBaseModel extends BaseModel> {
    createBy: CreateBy<TBaseModel>;
    carryForward: any;
}

export interface OnFind<TBaseModel extends BaseModel> {
    findBy: FindBy<TBaseModel>;
    carryForward: any;
}

export interface OnDelete<TBaseModel extends BaseModel> {
    deleteBy: DeleteBy<TBaseModel>;
    carryForward: any;
}

export interface OnUpdate<TBaseModel extends BaseModel> {
    updateBy: UpdateBy<TBaseModel>;
    carryForward: any;
}
