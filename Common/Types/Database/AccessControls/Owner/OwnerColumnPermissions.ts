import BaseModel from '../../../../Models/BaseModel';
import AccessControl from '../AccessControl';

export default (accessControl: AccessControl) => {
    return (target: Object, propertyKey: string) => {
        const baseModel: BaseModel = target as BaseModel;
        if (accessControl.create) {
            baseModel.addOwnerCreateableColumn(propertyKey);
        }

        if (accessControl.delete) {
            baseModel.addOwnerDeleteableColumn(propertyKey);
        }

        if (accessControl.readAsItem) {
            baseModel.addOwnerReadableAsItemColumn(propertyKey);
        }

        if (accessControl.readAsList) {
            baseModel.addOwnerReadableAsListColumn(propertyKey);
        }

        if (accessControl.update) {
            baseModel.addOwnerUpdateableColumn(propertyKey);
        }
    };
};
