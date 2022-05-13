import BaseModel from '../../Models/BaseModel';

export default (displayAs: string) => {
    return (target: Object, propertyKey: string) => {
        const baseModel: BaseModel = target as BaseModel;
        baseModel.addTableColumn(propertyKey, displayAs);
    };
};
