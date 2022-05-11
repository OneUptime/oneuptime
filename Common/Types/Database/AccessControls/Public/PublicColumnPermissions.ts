import BaseModel from '../../../../Models/BaseModel';
import AccessControl from '../AccessControl';

export default (accessControl: AccessControl) => {
    return (target: Object, propertyKey: string) => {
        const baseModel: BaseModel = target as BaseModel;
        if (accessControl.create) {
            baseModel.addPublicCreateableColumn(propertyKey);
        }

        if (accessControl.delete) {
            baseModel.addPublicDeleteableColumn(propertyKey);
        }

        if (accessControl.readAsItem) {
            baseModel.addPublicReadableAsItemColumn(propertyKey);
        }

        if (accessControl.readAsList) {
            baseModel.addPublicReadableAsListColumn(propertyKey);
        }

        if (accessControl.update) {
            baseModel.addPublicUpdateableColumn(propertyKey);
        }
        
    };
};
