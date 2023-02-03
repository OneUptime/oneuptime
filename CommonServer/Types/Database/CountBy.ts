import type BaseModel from 'Common/Models/BaseModel';
import type PositiveNumber from 'Common/Types/PositiveNumber';
import type DatabaseCommonInteractionProps from 'Common/Types/Database/DatabaseCommonInteractionProps';
import type Query from './Query';

export default interface CountBy<TBaseModel extends BaseModel> {
    query: Query<TBaseModel>;
    skip?: PositiveNumber | number;
    limit?: PositiveNumber | number;
    props: DatabaseCommonInteractionProps;
    distinctOn?: string | undefined;
}
