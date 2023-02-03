import type Query from './Query';
import type BaseModel from 'Common/Models/BaseModel';
import type User from 'Model/Models/User';
import type DatabaseCommonInteractionProps from 'Common/Types/Database/DatabaseCommonInteractionProps';

export default interface DeleteOneBy<TBaseModel extends BaseModel> {
    query: Query<TBaseModel>;
    deletedByUser?: User;
    props: DatabaseCommonInteractionProps;
}
