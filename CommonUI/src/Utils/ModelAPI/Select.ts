import BaseModel from 'Common/Models/BaseModel';

type Select<TBaseModel extends BaseModel> = {
    [P in keyof TBaseModel]?: boolean;
};

export default Select;
