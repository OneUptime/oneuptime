
import "reflect-metadata";
import BaseModel from "../../Models/BaseModel";

const tableColumn = Symbol("TableColumn");

export interface TableColumnMetadata {
    title?: string;
    description?: string;
    placeholder?: string;
}

export default (props?: TableColumnMetadata) => {
    return Reflect.metadata(tableColumn, props);
}

export const getTableColumn = (target: BaseModel, propertyKey: string): TableColumnMetadata  => {
    return Reflect.getMetadata(tableColumn, target, propertyKey) as TableColumnMetadata;
}