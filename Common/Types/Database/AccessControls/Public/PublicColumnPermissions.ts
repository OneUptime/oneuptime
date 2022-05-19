import 'reflect-metadata';
import BaseModel from '../../../../Models/BaseModel';
import Dictionary from '../../../Dictionary';
import AccessControl from '../AccessControl';

const accessControlSymbol = Symbol('PublicAccessControl');

export default (accessControl: AccessControl) => {
    return Reflect.metadata(accessControlSymbol, accessControl);
};

export const getPublicAccessControl = (
    target: BaseModel,
    propertyKey: string
): AccessControl => {
    return Reflect.getMetadata(
        accessControlSymbol,
        target,
        propertyKey
    ) as AccessControl;
};

export const getPublicAccessControlForAllColumns = <T extends BaseModel>(
    target: T
): Dictionary<AccessControl> => {
    const dictonary: Dictionary<AccessControl> = {};
    const keys = Object.keys(target);

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
