import BaseModel from 'Common/AnalyticsModels/BaseModel';
import DatabaseCommonInteractionProps from 'Common/Types/BaseDatabase/DatabaseCommonInteractionProps';
import Query from './Query';

export default interface UpdateBy<TBaseModel extends BaseModel> {
    query: Query<TBaseModel>;
    data: TBaseModel;
    props: DatabaseCommonInteractionProps;
}
