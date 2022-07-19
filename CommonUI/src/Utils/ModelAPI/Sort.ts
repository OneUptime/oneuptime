import BaseModel from 'Common/Models/BaseModel';
import SortOrder from "Common/Types/Database/SortOrder";

type Query<TBaseModel extends BaseModel> = {
    [P in keyof TBaseModel]?: SortOrder;
};

export default Query;
