import BaseModel from '../../Models/BaseModel';

export default () => {
    return (target: Object, propertyKey: string) => {
        const baseModel:BaseModel = target as BaseModel;
        baseModel.addUniqueColumn(propertyKey);
    };
};
