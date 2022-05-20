import 'reflect-metadata';
import BaseModel from '../../Models/BaseModel';
import Dictionary from '../Dictionary';

const tableColumn = Symbol('TableColumn');

export interface TableColumnMetadata {
    title?: string;
    description?: string;
    placeholder?: string;
    isDefaultValueColumn?: boolean
}

export default (props?: TableColumnMetadata) => {
    return Reflect.metadata(tableColumn, props);
};

export const getTableColumn = <T extends BaseModel>(
    target: T,
    propertyKey: string
): TableColumnMetadata => {
    return Reflect.getMetadata(
        tableColumn,
        target,
        propertyKey
    ) as TableColumnMetadata;
};

export const getAllTableColumns = <T extends BaseModel>(
    target: T
): Dictionary<TableColumnMetadata> => {
    const dictonary: Dictionary<TableColumnMetadata> = {};
    const keys = Object.keys(target);

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
