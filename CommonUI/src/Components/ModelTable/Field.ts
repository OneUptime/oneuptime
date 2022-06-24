import TableColumnType from '../Table/TableColumnType';
import SelectEntityField from '../../Types/SelectEntityField';

export default interface Field<TEntity> {
    title?: string;
    description?: string;
    field: SelectEntityField<TEntity>;
    columnType?: TableColumnType;
}
