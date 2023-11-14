import BaseModel from 'Common/AnalyticsModels/BaseModel';
import UpdateOneBy from './UpdateOneBy';
import PositiveNumber from 'Common/Types/PositiveNumber';

export default interface UpdateBy<TBaseModel extends BaseModel> extends UpdateOneBy<TBaseModel> {
    limit?: PositiveNumber | number | undefined;
}
