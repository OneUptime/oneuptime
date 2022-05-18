
import "reflect-metadata";
import BaseModel from "../../../../Models/BaseModel";
import AccessControl from '../AccessControl';

const accessControlSymbol = Symbol("UserAccessControl");

export default (accessControl: AccessControl) => {
    return Reflect.metadata(accessControlSymbol, accessControl);
}

export const getUserAccessControl = (target: BaseModel, propertyKey: string): AccessControl  => {
    return Reflect.getMetadata(accessControlSymbol, target, propertyKey) as AccessControl;
}