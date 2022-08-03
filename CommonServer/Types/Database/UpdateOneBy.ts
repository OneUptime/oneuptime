import BaseModel from 'Model/Models/BaseModel';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import DatabaseCommonInteractionProps from 'Common/Types/Database/DatabaseCommonInteractionProps';
import Query from './Query';

export default interface UpdateOneBy<TBaseModel extends BaseModel> {
    query: Query<TBaseModel>;
    data: QueryDeepPartialEntity<TBaseModel>;
    props: DatabaseCommonInteractionProps;
}
