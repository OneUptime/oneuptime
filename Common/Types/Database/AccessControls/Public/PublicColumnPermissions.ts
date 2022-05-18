
import "reflect-metadata";
import BaseModel from "../../../../Models/BaseModel";
import AccessControl from '../AccessControl';

const accessControlSymbol = Symbol("PublicAccessControl");

export default (accessControl: AccessControl) => {
    return Reflect.metadata(accessControlSymbol, accessControl);
}

export const getPublicAccessControl = (target: BaseModel, propertyKey: string): AccessControl  => {
    return Reflect.getMetadata(accessControlSymbol, target, propertyKey) as AccessControl;
}

export const getPublicAccessControlForAllColumns = (target: BaseModel): any  => {
    return Reflect.getMetadata(accessControlSymbol, target);
}