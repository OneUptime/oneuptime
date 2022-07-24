import 'reflect-metadata';
import BaseModel from '../../Models/BaseModel';
import Dictionary from '../Dictionary';
import { ReflectionMetadataType } from '../Reflection';

const uniqueColumnBy: Symbol = Symbol('UniqueColumnBy');


export default (columnName: string): ReflectionMetadataType => {
    return Reflect.metadata(uniqueColumnBy, columnName);
};

export const getUniqueColumnBy: Function = <T extends BaseModel>(
    target: T,
    propertyKey: string
): string => {
    return Reflect.getMetadata(
        uniqueColumnBy,
        target,
        propertyKey
    ) as string;
};

export const getUniqueColumnsBy: Function = <T extends BaseModel>(
    target: T
): Dictionary<string> => {
    
    const dictonary: Dictionary<string> = {};
    const keys: Array<string> = Object.keys(target);

    for (const key of keys) {
        if (Reflect.getMetadata(uniqueColumnBy, target, key)) {
            dictonary[key] = Reflect.getMetadata(
                uniqueColumnBy,
                target,
                key
            ) as string;
        }
    }

    return dictonary;
};
