import Column from './Column';
import AnalyticsBaseModel from 'Common/AnalyticsModels/BaseModel';
import BaseModel from 'Common/Models/BaseModel';

type Columns<T extends BaseModel | AnalyticsBaseModel> = Array<Column<T>>;

export default Columns;
