import type Query from './Query';
import type BaseModel from 'Common/Models/BaseModel';
import type DatabaseCommonInteractionProps from 'Common/Types/Database/DatabaseCommonInteractionProps';

export default interface HardDeleteBy<TBaseModel extends BaseModel> {
    query: Query<TBaseModel>;
    props: DatabaseCommonInteractionProps;
}
