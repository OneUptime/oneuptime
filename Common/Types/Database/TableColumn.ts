import 'reflect-metadata';
import type BaseModel from '../../Models/BaseModel';
import type Dictionary from '../Dictionary';
import type { ReflectionMetadataType } from '../Reflection';
import type TableColumnType from './TableColumnType';

const tableColumn: Symbol = Symbol('TableColumn');

export interface TableColumnMetadata {
    title?: string;
    description?: string;
    placeholder?: string;
    isDefaultValueColumn?: boolean;
    required?: boolean;
    unique?: boolean;
    hashed?: boolean;
    encrypted?: boolean;
    manyToOneRelationColumn?: string;
    type: TableColumnType;
    canReadOnPopulate?: boolean;
    modelType?: { new (): BaseModel };
}

export default (props: TableColumnMetadata): ReflectionMetadataType => {
    return Reflect.metadata(tableColumn, props);
};

export const getTableColumn: Function = <T extends BaseModel>(
    target: T,
    propertyKey: string
): TableColumnMetadata => {
    return Reflect.getMetadata(
        tableColumn,
        target,
        propertyKey
    ) as TableColumnMetadata;
};

export const getTableColumns: Function = <T extends BaseModel>(
    target: T
): Dictionary<TableColumnMetadata> => {
    const dictonary: Dictionary<TableColumnMetadata> = {};
    const keys: Array<string> = Object.keys(target);

    for (const key of keys) {
        if (Reflect.getMetadata(tableColumn, target, key)) {
            dictonary[key] = Reflect.getMetadata(
                tableColumn,
                target,
                key
            ) as TableColumnMetadata;
        }
    }

    return dictonary;
};
