import 'reflect-metadata';
import BaseModel from '../../Models/BaseModel';
import { ReflectionMetadataType } from '../Reflection';
import Columns from './Columns';

const requiredColumnSymbol: Symbol = Symbol('RequiredColumn');

export default (): ReflectionMetadataType => {
    return Reflect.metadata(requiredColumnSymbol, true);
};

export const isRequiredColumn: Function = (
    target: BaseModel,
    propertyKey: string
): boolean => {
    return Reflect.getMetadata(
        requiredColumnSymbol,
        target,
        propertyKey
    ) as boolean;
};

export const getRequiredColumns: Function = <T extends BaseModel>(
    target: T
): Columns => {
    const keys: Array<string> = Object.keys(target);
    const columns: Array<string> = [];

    for (const key of keys) {
        if (Reflect.getMetadata(requiredColumnSymbol, target, key)) {
            columns.push(key);
        }
    }

    return new Columns(columns);
};
