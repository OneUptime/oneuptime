import AnalyticsBaseModel from 'Common/Models/AnalyticsBaseModel';
import DatabaseCommonInteractionProps from 'Common/Types/Database/DatabaseCommonInteractionProps';

export default interface DeleteBy<TBaseModel extends AnalyticsBaseModel> {
    data: TBaseModel;
    props: DatabaseCommonInteractionProps;
}
