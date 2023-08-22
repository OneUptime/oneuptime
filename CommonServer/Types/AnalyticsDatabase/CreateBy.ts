import AnalyticsBaseModel from 'Common/Models/AnalyticsBaseModel';
import DatabaseCommonInteractionProps from 'Common/Types/Database/DatabaseCommonInteractionProps';

export default interface CreateBy<TBaseModel extends AnalyticsBaseModel> {
    data: TBaseModel;
    props: DatabaseCommonInteractionProps;
}
