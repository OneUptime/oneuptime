
import "reflect-metadata";
import BaseModel from "../../../../Models/BaseModel";
import AccessControl from '../AccessControl';

const accessControlSymbol = Symbol("ViewerAccessControl");

export default (accessControl: AccessControl) => {
    return Reflect.metadata(accessControlSymbol, accessControl);
}

export const getViewerAccessControl = (target: BaseModel, propertyKey: string): AccessControl  => {
    return Reflect.getMetadata(accessControlSymbol, target, propertyKey) as AccessControl;
}