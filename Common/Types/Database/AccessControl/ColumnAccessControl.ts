import 'reflect-metadata';
import BaseModel from '../../../Models/BaseModel';
import Dictionary from '../../Dictionary';
import { ReflectionMetadataType } from '../../Reflection';
import AccessControl from './AccessControl';

const accessControlSymbol: Symbol = Symbol('ColumnAccessControl');

export default (accessControl: AccessControl): ReflectionMetadataType => {
    return Reflect.metadata(accessControlSymbol, accessControl);
};

export const getColumnAccessControl: Function = (
    target: BaseModel,
    propertyKey: string
): AccessControl => {
    return Reflect.getMetadata(
        accessControlSymbol,
        target,
        propertyKey
    ) as AccessControl;
};

export const getColumnAccessControlForAllColumns: Function = <
    T extends BaseModel
>(
    target: T
): Dictionary<AccessControl> => {
    const dictonary: Dictionary<AccessControl> = {};
    const keys: Array<string> = Object.keys(target);

    for (const key of keys) {
        if (Reflect.getMetadata(accessControlSymbol, target, key)) {
            dictonary[key] = Reflect.getMetadata(
                accessControlSymbol,
                target,
                key
            ) as AccessControl;
        }
    }

    return dictonary;
};
