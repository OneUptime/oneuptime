import BaseModel from 'Common/Models/BaseModel';
import PositiveNumber from 'Common/Types/PositiveNumber';
import Query from './Query';

export default interface CountBy<TBaseModel extends BaseModel> {
    query: Query<TBaseModel>;
    skip?: PositiveNumber,
    limit?: PositiveNumber
}
