
import "reflect-metadata";

const tableColumn = Symbol("TableColumn");

export interface TableColumnMetadata {
    title?: string;
    description?: string;
    placeholder?: string;
}

export default (props?: TableColumnMetadata) => {
    return Reflect.metadata(tableColumn, props);
}

export const getTableColumn = (target: any, propertyKey: string): TableColumnMetadata  => {
    return Reflect.getMetadata(tableColumn, target, propertyKey) as TableColumnMetadata;
}