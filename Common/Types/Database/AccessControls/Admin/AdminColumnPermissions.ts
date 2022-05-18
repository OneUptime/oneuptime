
import "reflect-metadata";
import BaseModel from "../../../../Models/BaseModel";
import AccessControl from '../AccessControl';

const accessControlSymbol = Symbol("AdminAccessControl");

export default (accessControl: AccessControl) => {
    return Reflect.metadata(accessControlSymbol, accessControl);
}

export const getAdminAccessControl = (target: BaseModel, propertyKey: string): AccessControl  => {
    return Reflect.getMetadata(accessControlSymbol, target, propertyKey) as AccessControl;
}