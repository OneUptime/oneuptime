import GenericObject from 'Common/Types/GenericObject';
import Column from './Column';

type Columns<T extends GenericObject> = Array<Column<T>>;

export default Columns;
