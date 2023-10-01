import AnalyticsBaseModel from 'Common/AnalyticsModels/BaseModel';
import DatabaseCommonInteractionProps from 'Common/Types/BaseDatabase/DatabaseCommonInteractionProps';

export default interface CreateBy<TBaseModel extends AnalyticsBaseModel> {
    data: TBaseModel;
    props: DatabaseCommonInteractionProps;
}
