import Query from './Query';
import BaseModel from 'Common/Models/BaseModel';
import User from 'Common/Models/User';
import DatabaseCommonInteractionProps from 'Common/Types/Database/DatabaseCommonInteractionProps';

export default interface DeleteOneBy<TBaseModel extends BaseModel>
    extends DatabaseCommonInteractionProps {
    query: Query<TBaseModel>;
    deletedByUser?: User;
}
