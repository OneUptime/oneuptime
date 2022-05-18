
import "reflect-metadata";
import AccessControl from '../AccessControl';

const accessControlSymbol = Symbol("UserAccessControl");

export default (accessControl: AccessControl) => {
    return Reflect.metadata(accessControlSymbol, accessControl);
}

export const getUserAccessControl = (target: any, propertyKey: string): AccessControl  => {
    return Reflect.getMetadata(accessControlSymbol, target, propertyKey) as AccessControl;
}