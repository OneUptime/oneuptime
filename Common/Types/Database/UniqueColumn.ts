import "reflect-metadata";
import BaseModel from "../../Models/BaseModel";
import Columns from "./Columns";

const uniqueColumnSymbol = Symbol("UniqueColumn");

export default () => {
    return Reflect.metadata(uniqueColumnSymbol, true);
}

export const isUniqueColumn = (target: BaseModel, propertyKey: string): boolean => {
    return Reflect.getMetadata(uniqueColumnSymbol, target, propertyKey) as boolean;
}

export const getUniqueColumns = <T extends BaseModel>(target: T): Columns => {
    const keys = Object.keys(target);
    const columns: Array<string> = [];

    for (let key of keys) {
        if (Reflect.getMetadata(uniqueColumnSymbol, target, key)) {
            columns.push(key);
        }
    }
    
    return new Columns(columns);
}