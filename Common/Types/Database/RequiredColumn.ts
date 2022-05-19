import 'reflect-metadata';
import BaseModel from '../../Models/BaseModel';
import Columns from './Columns';

const requiredColumnSymbol = Symbol('RequiredColumn');

export default () => {
    return Reflect.metadata(requiredColumnSymbol, true);
};

export const isRequiredColumn = (
    target: BaseModel,
    propertyKey: string
): boolean => {
    return Reflect.getMetadata(
        requiredColumnSymbol,
        target,
        propertyKey
    ) as boolean;
};

export const getRequiredColumns = <T extends BaseModel>(target: T): Columns => {
    const keys = Object.keys(target);
    const columns: Array<string> = [];

    for (const key of keys) {
        if (Reflect.getMetadata(requiredColumnSymbol, target, key)) {
            columns.push(key);
        }
    }

    return new Columns(columns);
};
