import SelectEntityField from '../../Types/SelectEntityField';
import TableColumnType from '../Table/Types/TableColumnType';

export default interface Columns<TEntity> {
    field: SelectEntityField<TEntity>;
    title: string; 
    disbaleSort?: boolean;
    type: TableColumnType;
}
