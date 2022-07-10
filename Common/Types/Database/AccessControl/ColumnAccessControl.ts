import 'reflect-metadata';
import BaseModel from '../../../Models/BaseModel';
import Dictionary from '../../Dictionary';
import { ReflectionMetadataType } from '../../Reflection';
import Permission from '../../Permission';

const accessControlSymbol: Symbol = Symbol('ColumnAccessControl');

export interface ColumnAccessControl {
    update: Array<Permission>;
    read: Array<Permission>;
}

export default (accessControl: ColumnAccessControl): ReflectionMetadataType => {
    return Reflect.metadata(accessControlSymbol, accessControl);
};

export const getColumnAccessControl: Function = (
    target: BaseModel,
    propertyKey: string
): ColumnAccessControl => {
    return Reflect.getMetadata(
        accessControlSymbol,
        target,
        propertyKey
    ) as ColumnAccessControl;
};

export const getColumnAccessControlForAllColumns: Function = <
    T extends BaseModel
>(
    target: T
): Dictionary<ColumnAccessControl> => {
    const dictonary: Dictionary<ColumnAccessControl> = {};
    const keys: Array<string> = Object.keys(target);

    for (const key of keys) {
        if (Reflect.getMetadata(accessControlSymbol, target, key)) {
            dictonary[key] = Reflect.getMetadata(
                accessControlSymbol,
                target,
                key
            ) as ColumnAccessControl;
        }
    }

    return dictonary;
};
