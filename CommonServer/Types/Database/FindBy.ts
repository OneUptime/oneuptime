import type BaseModel from 'Common/Models/BaseModel';
import type PositiveNumber from 'Common/Types/PositiveNumber';
import type FindOneBy from './FindOneBy';

export default interface FindBy<TBaseModel extends BaseModel>
    extends FindOneBy<TBaseModel> {
    limit: PositiveNumber | number;
    skip: PositiveNumber | number;
}
