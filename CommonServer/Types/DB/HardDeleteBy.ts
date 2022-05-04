import Query from './Query';
import BaseModel from 'Common/Models/BaseModel';

export default interface HardDeleteBy<TBaseModel extends BaseModel> {
    query: Query<TBaseModel>;
}
