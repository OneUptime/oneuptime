import Query from './Query';
import BaseModel from 'Common/AnalyticsModels/BaseModel';
import DatabaseCommonInteractionProps from 'Common/Types/BaseDatabase/DatabaseCommonInteractionProps';

export default interface DeleteOneBy<TBaseModel extends BaseModel> {
    query: Query<TBaseModel>;
    props: DatabaseCommonInteractionProps;
}
