import BaseModel from 'Common/Models/BaseModel';

type Populate<TBaseModel extends BaseModel> = {
    [P in keyof TBaseModel]?: boolean;
};

export default Populate;
