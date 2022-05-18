
import "reflect-metadata";
import AccessControl from '../AccessControl';

const accessControlSymbol = Symbol("OwnerAccessControl");

export default (accessControl: AccessControl) => {
    return Reflect.metadata(accessControlSymbol, accessControl);
}

export const getOwnerAccessControl = (target: any, propertyKey: string): AccessControl  => {
    return Reflect.getMetadata(accessControlSymbol, target, propertyKey) as AccessControl;
}