import BaseModel from 'Common/Models/BaseModel';
import DatabaseCommonInteractionProps from 'Common/Types/BaseDatabase/DatabaseCommonInteractionProps';
import ObjectID from 'Common/Types/ObjectID';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

export default interface UpdateBy<TBaseModel extends BaseModel> {
    id: ObjectID;
    data: QueryDeepPartialEntity<TBaseModel>;
    props: DatabaseCommonInteractionProps;
}
