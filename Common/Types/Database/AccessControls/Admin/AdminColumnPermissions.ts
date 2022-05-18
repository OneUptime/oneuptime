
import "reflect-metadata";
import AccessControl from '../AccessControl';

const accessControlSymbol = Symbol("AdminAccessControl");

export default (accessControl: AccessControl) => {
    return Reflect.metadata(accessControlSymbol, accessControl);
}

export const getAdminAccessControl = (target: any, propertyKey: string): AccessControl  => {
    return Reflect.getMetadata(accessControlSymbol, target, propertyKey) as AccessControl;
}