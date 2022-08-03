import Query from './Query';
import BaseModel from 'Model/Models/BaseModel';
import User from 'Model/Models/User';
import DatabaseCommonInteractionProps from 'Common/Types/Database/DatabaseCommonInteractionProps';

export default interface DeleteOneBy<TBaseModel extends BaseModel> {
    query: Query<TBaseModel>;
    deletedByUser?: User;
    props: DatabaseCommonInteractionProps;
}
