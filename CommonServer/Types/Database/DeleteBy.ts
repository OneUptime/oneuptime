import DeleteOneBy from './DeleteOneBy';
import BaseModel from 'Model/Models/BaseModel';

type DeleteBy<TBaseModel extends BaseModel> = DeleteOneBy<TBaseModel>;
export default DeleteBy;
