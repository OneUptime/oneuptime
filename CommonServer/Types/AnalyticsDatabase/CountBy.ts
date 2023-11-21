import AnalyticsBaseModel from 'Common/AnalyticsModels/BaseModel';
import PositiveNumber from 'Common/Types/PositiveNumber';
import DatabaseCommonInteractionProps from 'Common/Types/BaseDatabase/DatabaseCommonInteractionProps';
import Query from './Query';

export default interface CountBy<TBaseModel extends AnalyticsBaseModel> {
    query: Query<TBaseModel>;
    skip?: PositiveNumber | number;
    limit?: PositiveNumber | number;
    props: DatabaseCommonInteractionProps;
}
