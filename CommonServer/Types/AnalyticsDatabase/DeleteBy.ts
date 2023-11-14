import BaseModel from 'Common/AnalyticsModels/BaseModel';
import PositiveNumber from 'Common/Types/PositiveNumber';
import DeleteOneBy from './DeleteOneBy';

export default interface DeleteBy<TBaseModel extends BaseModel> extends DeleteOneBy<TBaseModel> {
    limit?: PositiveNumber | number | undefined;
    skip?: PositiveNumber | number | undefined;
}
