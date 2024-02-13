import BaseModel from 'Common/Models/BaseModel';
import Column from './Column';
import AnalyticsBaseModel from 'Common/AnalyticsModels/BaseModel';

type Columns<T extends BaseModel| AnalyticsBaseModel> = Array<Column<T>>;

export default Columns;
