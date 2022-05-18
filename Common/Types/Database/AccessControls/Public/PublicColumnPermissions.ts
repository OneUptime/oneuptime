
import "reflect-metadata";
import AccessControl from '../AccessControl';

const accessControlSymbol = Symbol("PublicAccessControl");

export default (accessControl: AccessControl) => {
    return Reflect.metadata(accessControlSymbol, accessControl);
}

export const getPublicAccessControl = (target: any, propertyKey: string): AccessControl  => {
    return Reflect.getMetadata(accessControlSymbol, target, propertyKey) as AccessControl;
}