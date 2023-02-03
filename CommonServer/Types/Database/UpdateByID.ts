import type BaseModel from 'Common/Models/BaseModel';
import type ObjectID from 'Common/Types/ObjectID';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import type DatabaseCommonInteractionProps from 'Common/Types/Database/DatabaseCommonInteractionProps';

export default interface UpdateBy<TBaseModel extends BaseModel> {
    id: ObjectID;
    data: QueryDeepPartialEntity<TBaseModel> | TBaseModel;
    props: DatabaseCommonInteractionProps;
}
