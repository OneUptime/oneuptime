import Select from './Select';
import Populate from './Populate';
import PositiveNumber from 'Common/Types/PositiveNumber';
import BaseModel from 'Common/Models/BaseModel';

export default interface SearchBy<TBaseModel extends BaseModel> {
    text: string;
    column: keyof TBaseModel;
    limit: PositiveNumber;
    skip: PositiveNumber;
    select: Select<TBaseModel>;
    populate: Populate<TBaseModel>;
}
