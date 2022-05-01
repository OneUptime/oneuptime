import BaseModel from 'Common/Models/BaseModel';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import Query from './Query';


export default interface UpdateOneBy<TBaseModel extends BaseModel> {
    query: Query<TBaseModel>;
    data: QueryDeepPartialEntity<TBaseModel>;
}
