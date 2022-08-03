import BaseModel from 'Model/Models/BaseModel';
import DatabaseCommonInteractionProps from 'Common/Types/Database/DatabaseCommonInteractionProps';

export default interface CreateBy<TBaseModel extends BaseModel> {
    data: TBaseModel;
    props: DatabaseCommonInteractionProps;
}
