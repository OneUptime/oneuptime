import BaseModel from 'Common/Models/BaseModel';
import DatabaseCommonInteractionProps from './DatabaseCommonInteractionProps';

export default interface CreateBy<TBaseModel extends BaseModel>
    extends DatabaseCommonInteractionProps {
    data: TBaseModel;
}
