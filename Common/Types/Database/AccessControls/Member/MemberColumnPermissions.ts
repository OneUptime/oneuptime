import BaseModel from '../../../../Models/BaseModel';
import AccessControl from '../AccessControl';

export default (accessControl: AccessControl) => {
    return (target: Object, propertyKey: string) => {
        const baseModel: BaseModel = target as BaseModel;
        if (accessControl.create) {
            baseModel.addMemberCreateableColumn(propertyKey);
        }

        if (accessControl.delete) {
            baseModel.addMemberDeleteableColumn(propertyKey);
        }

        if (accessControl.readAsItem) {
            baseModel.addMemberReadableAsItemColumn(propertyKey);
        }

        if (accessControl.readAsList) {
            baseModel.addMemberReadableAsListColumn(propertyKey);
        }

        if (accessControl.update) {
            baseModel.addMemberUpdateableColumn(propertyKey);
        }
        
    };
};
