import BaseModel from '../../../../Models/BaseModel';
import AccessControl from '../AccessControl';

export default (accessControl: AccessControl) => {
    return (target: Object, propertyKey: string) => {
        const baseModel: BaseModel = target as BaseModel;
        if (accessControl.create) {
            baseModel.addUserCreateableColumn(propertyKey);
        }

        if (accessControl.delete) {
            baseModel.addUserDeleteableColumn(propertyKey);
        }

        if (accessControl.read) {
            baseModel.addUserReadableColumn(propertyKey);
        }

        if (accessControl.update) {
            baseModel.addUserUpdateableColumn(propertyKey);
        }
        
    };
};
