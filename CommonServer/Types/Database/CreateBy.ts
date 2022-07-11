import BaseModel from 'Common/Models/BaseModel';
import DatabaseCommonInteractionProps from 'Common/Types/Database/DatabaseCommonInteractionProps';

export default interface CreateBy<TBaseModel extends BaseModel>
    extends DatabaseCommonInteractionProps {
    data: TBaseModel;
}
