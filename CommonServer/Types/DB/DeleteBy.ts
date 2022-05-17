import DeleteOneBy from './DeleteOneBy';
import BaseModel from '../../../Common/Models/BaseModel';

type DeleteBy<TBaseModel extends BaseModel> = DeleteOneBy<TBaseModel>;
export default DeleteBy;
