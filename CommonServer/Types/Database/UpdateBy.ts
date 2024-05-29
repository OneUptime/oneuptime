import UpdateOneBy from './UpdateOneBy';
import BaseModel from 'Common/Models/BaseModel';
import PositiveNumber from 'Common/Types/PositiveNumber';

interface UpdateBy<TBaseModel extends BaseModel>
    extends UpdateOneBy<TBaseModel> {
    limit: PositiveNumber | number;
    skip: PositiveNumber | number;
}

export default UpdateBy;
