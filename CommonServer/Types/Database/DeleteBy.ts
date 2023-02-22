import DeleteOneBy from './DeleteOneBy';
import BaseModel from 'Common/Models/BaseModel';
import PositiveNumber from 'Common/Types/PositiveNumber';

interface DeleteBy<TBaseModel extends BaseModel> extends DeleteOneBy<TBaseModel>{
    limit:  PositiveNumber | number;
    skip:  PositiveNumber | number;
}

export default DeleteBy;
