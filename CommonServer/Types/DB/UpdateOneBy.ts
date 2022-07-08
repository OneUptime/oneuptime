import BaseModel from 'Common/Models/BaseModel';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import DatabaseCommonInteractionProps from './DatabaseCommonInteractionProps';
import Query from './Query';

export default interface UpdateOneBy<TBaseModel extends BaseModel> extends DatabaseCommonInteractionProps {
    query: Query<TBaseModel>;
    data: QueryDeepPartialEntity<TBaseModel>;
}
