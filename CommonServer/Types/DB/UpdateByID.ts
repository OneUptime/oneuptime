import BaseModel from 'Common/Models/BaseModel';
import ObjectID from 'Common/Types/ObjectID';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

export default interface UpdateBy<TBaseModel extends BaseModel> {
    id: ObjectID;
    data: QueryDeepPartialEntity<TBaseModel>;
}
