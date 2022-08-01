import 'reflect-metadata';
import BaseModel from '../../Models/BaseModel';
import Dictionary from '../Dictionary';
import { ReflectionMetadataType } from '../Reflection';
import TableColumnType from './TableColumnType';

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
    modelType?: { new (): BaseModel }
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
