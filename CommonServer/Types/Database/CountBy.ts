import BaseModel from 'Common/Models/BaseModel';
import PositiveNumber from 'Common/Types/PositiveNumber';
import DatabaseCommonInteractionProps from 'Common/Types/BaseDatabase/DatabaseCommonInteractionProps';
import Query from './Query';
import GroupBy from './GroupBy';

export default interface CountBy<TBaseModel extends BaseModel> {
    query: Query<TBaseModel>;
    skip?: PositiveNumber | number;
    groupBy?: GroupBy<TBaseModel> | undefined;
    limit?: PositiveNumber | number;
    props: DatabaseCommonInteractionProps;
    distinctOn?: string | undefined;
}
