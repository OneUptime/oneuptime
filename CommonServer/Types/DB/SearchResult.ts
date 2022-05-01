import BaseModel from 'Common/Models/BaseModel';
import PositiveNumber from 'Common/Types/PositiveNumber';

export default interface SearchResult<TBaseModel extends BaseModel> {
    items: Array<TBaseModel>;
    count: PositiveNumber;
}
