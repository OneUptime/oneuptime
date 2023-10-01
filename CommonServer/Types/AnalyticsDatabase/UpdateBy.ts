import AnalyticsBaseModel from 'Common/Models/AnalyticsBaseModel';
import DatabaseCommonInteractionProps from 'Common/Types/Database/DatabaseCommonInteractionProps';

export default interface UpdateBy<TBaseModel extends AnalyticsBaseModel> {
    data: TBaseModel;
    props: DatabaseCommonInteractionProps;
}
