import BaseModel from 'Model/Models/BaseModel';

type Populate<TBaseModel extends BaseModel> = {
    [P in keyof TBaseModel]?: boolean;
};

export default Populate;
