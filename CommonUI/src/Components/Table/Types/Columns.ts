import Column from './Column';
import GenericObject from 'Common/Types/GenericObject';

type Columns<T extends GenericObject> = Array<Column<T>>;

export default Columns;
