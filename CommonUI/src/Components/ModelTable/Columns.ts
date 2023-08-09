import BaseModel from 'Common/Models/BaseModel';
import Column from './Column';

type Columns<T extends BaseModel> = Array<Column<T>>;

export default Columns;
