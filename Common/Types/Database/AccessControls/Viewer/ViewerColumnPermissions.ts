import BaseModel from '../../../../Models/BaseModel';
import AccessControl from '../AccessControl';

export default (accessControl: AccessControl) => {
    return (target: Object, propertyKey: string) => {
        const baseModel: BaseModel = target as BaseModel;
        if (accessControl.create) {
            baseModel.addViewerCreateableColumn(propertyKey);
        }

        if (accessControl.delete) {
            baseModel.addViewerDeleteableColumn(propertyKey);
        }

        if (accessControl.readAsItem) {
            baseModel.addViewerReadableAsItemColumn(propertyKey);
        }

        if (accessControl.readAsList) {
            baseModel.addViewerReadableAsListColumn(propertyKey);
        }

        if (accessControl.update) {
            baseModel.addViewerUpdateableColumn(propertyKey);
        }
    };
};
