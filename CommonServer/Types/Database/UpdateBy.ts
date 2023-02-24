import BaseModel from 'Common/Models/BaseModel';
import PositiveNumber from 'Common/Types/PositiveNumber';
import UpdateOneBy from './UpdateOneBy';

interface UpdateBy<TBaseModel extends BaseModel>
    extends UpdateOneBy<TBaseModel> {
    limit: PositiveNumber | number;
    skip: PositiveNumber | number;
}

export default UpdateBy;
