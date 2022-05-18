
import "reflect-metadata";
import AccessControl from '../AccessControl';

const accessControlSymbol = Symbol("ViewerAccessControl");

export default (accessControl: AccessControl) => {
    return Reflect.metadata(accessControlSymbol, accessControl);
}

export const getViewerAccessControl = (target: any, propertyKey: string): AccessControl  => {
    return Reflect.getMetadata(accessControlSymbol, target, propertyKey) as AccessControl;
}