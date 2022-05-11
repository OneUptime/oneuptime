import BaseModel from '../../../../Models/BaseModel';
import AccessControl from '../AccessControl';

export default (accessControl: AccessControl) => {
    return (target: Object, propertyKey: string) => {
        const baseModel: BaseModel = target as BaseModel;
        if (accessControl.create) {
            baseModel.addAdminCreateableColumn(propertyKey);
        }

        if (accessControl.delete) {
            baseModel.addAdminDeleteableColumn(propertyKey);
        }

        if (accessControl.read) {
            baseModel.addAdminReadableColumn(propertyKey);
        }

        if (accessControl.update) {
            baseModel.addAdminUpdateableColumn(propertyKey);
        }
        
    };
};
