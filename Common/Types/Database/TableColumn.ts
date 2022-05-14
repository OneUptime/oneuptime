import BaseModel from '../../Models/BaseModel';

export default (props?: {title?: string, description?: string}) => {
    return (target: Object, propertyKey: string) => {
        const baseModel: BaseModel = target as BaseModel;
        baseModel.addTableColumn(propertyKey);

        if (props && props.title) {
            baseModel.addDisplayColumnTitleAs(propertyKey, props.title);
        }

        if (props && props.description) {
            baseModel.addDisplayColumnTitleAs(propertyKey, props.description);
        }
    };
};
