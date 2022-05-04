import Query from './Query';
import BaseModel from 'Common/Models/BaseModel';
import User from 'Common/Models/User';

export default interface DeleteOneBy<TBaseModel extends BaseModel> {
    query: Query<TBaseModel>;
    deletedByUser?: User;
}
