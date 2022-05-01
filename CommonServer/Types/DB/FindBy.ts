import BaseModel from 'Common/Models/BaseModel';
import PositiveNumber from 'Common/Types/PositiveNumber';
import FindOneBy from './FindOneBy';

export default interface FindBy<TBaseModel extends BaseModel> extends FindOneBy<TBaseModel> {
    limit: PositiveNumber;
    skip: PositiveNumber;
}
