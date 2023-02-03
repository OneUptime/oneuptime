import type BaseModel from 'Common/Models/BaseModel';
import type DatabaseCommonInteractionProps from 'Common/Types/Database/DatabaseCommonInteractionProps';
import type Query from './Query';
import type PartialEntity from 'Common/Types/Database/PartialEntity';

export default interface UpdateOneBy<TBaseModel extends BaseModel> {
    query: Query<TBaseModel>;
    data: PartialEntity<TBaseModel>;
    props: DatabaseCommonInteractionProps;
}
