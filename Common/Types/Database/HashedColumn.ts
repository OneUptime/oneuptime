import 'reflect-metadata';
import BaseModel from '../../Models/BaseModel';
import { ReflectionMetadataType } from '../Reflection';
import Columns from './Columns';

const hashedColumnSymbol: Symbol = Symbol('HashedColumn');

export default (): ReflectionMetadataType => {
    return Reflect.metadata(hashedColumnSymbol, true);
};

export const isHashedColumn: Function = (
    target: BaseModel,
    propertyKey: string
): boolean => {
    return Reflect.getMetadata(
        hashedColumnSymbol,
        target,
        propertyKey
    ) as boolean;
};

export const getHashedColumns: Function = <T extends BaseModel>(
    target: T
): Columns => {
    const keys: Array<string> = Object.keys(target);
    const columns: Array<string> = [];

    for (const key of keys) {
        if (Reflect.getMetadata(hashedColumnSymbol, target, key)) {
            columns.push(key);
        }
    }

    return new Columns(columns);
};
