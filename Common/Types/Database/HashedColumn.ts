import 'reflect-metadata';
import BaseModel from '../../Models/BaseModel';
import Columns from './Columns';

const hashedColumnSymbol = Symbol('HashedColumn');

export default () => {
    return Reflect.metadata(hashedColumnSymbol, true);
};

export const isHashedColumn = (
    target: BaseModel,
    propertyKey: string
): boolean => {
    return Reflect.getMetadata(
        hashedColumnSymbol,
        target,
        propertyKey
    ) as boolean;
};

export const getHashedColumns = <T extends BaseModel>(target: T): Columns => {
    const keys = Object.keys(target);
    const columns: Array<string> = [];

    for (const key of keys) {
        if (Reflect.getMetadata(hashedColumnSymbol, target, key)) {
            columns.push(key);
        }
    }

    return new Columns(columns);
};
