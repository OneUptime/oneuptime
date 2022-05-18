import "reflect-metadata";
import BaseModel from "../../Models/BaseModel";
import Columns from "./Columns";

const encryptedColumnSymbol = Symbol("EncryptedColumn");

export default () => {
    return Reflect.metadata(encryptedColumnSymbol, true);
}

export const isEncryptedColumn = (target: BaseModel, propertyKey: string): boolean => {
    return Reflect.getMetadata(encryptedColumnSymbol, target, propertyKey) as boolean;
}

export const getEncryptedColumns = <T extends BaseModel>(target: T): Columns => {
    const keys = Object.keys(target);
    const columns: Array<string> = [];

    for (let key of keys) {
        if (Reflect.getMetadata(encryptedColumnSymbol, target, key)) {
            columns.push(key);
        }
    }
    
    return new Columns(columns);
}