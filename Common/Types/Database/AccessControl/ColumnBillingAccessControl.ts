import 'reflect-metadata';
import BaseModel from '../../../Models/BaseModel';
import Dictionary from '../../Dictionary';
import { ReflectionMetadataType } from '../../Reflection';
import { ColumnBillingAccessControl } from './AccessControl';

const accessControlSymbol: Symbol = Symbol('ColumnBillingAccessControl');

export default (
    accessControl: ColumnBillingAccessControl
): ReflectionMetadataType => {
    return Reflect.metadata(accessControlSymbol, accessControl);
};

export const getColumnBillingAccessControl: Function = (
    target: BaseModel,
    propertyKey: string
): ColumnBillingAccessControl => {
    return Reflect.getMetadata(
        accessControlSymbol,
        target,
        propertyKey
    ) as ColumnBillingAccessControl;
};

export const getColumnBillingAccessControlForAllColumns: Function = <
    T extends BaseModel
>(
    target: T
): Dictionary<ColumnBillingAccessControl> => {
    const dictonary: Dictionary<ColumnBillingAccessControl> = {};
    const keys: Array<string> = Object.keys(target);

    for (const key of keys) {
        if (Reflect.getMetadata(accessControlSymbol, target, key)) {
            dictonary[key] = Reflect.getMetadata(
                accessControlSymbol,
                target,
                key
            ) as ColumnBillingAccessControl;
        }
    }

    return dictonary;
};
