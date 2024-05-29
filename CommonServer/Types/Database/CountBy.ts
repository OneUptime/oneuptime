import GroupBy from './GroupBy';
import Query from './Query';
import BaseModel from 'Common/Models/BaseModel';
import DatabaseCommonInteractionProps from 'Common/Types/BaseDatabase/DatabaseCommonInteractionProps';
import PositiveNumber from 'Common/Types/PositiveNumber';

export default interface CountBy<TBaseModel extends BaseModel> {
    query: Query<TBaseModel>;
    skip?: PositiveNumber | number;
    groupBy?: GroupBy<TBaseModel> | undefined;
    limit?: PositiveNumber | number;
    props: DatabaseCommonInteractionProps;
    distinctOn?: string | undefined;
}
