import BaseModel from "Common/Models/BaseModel";

export default interface CreateBy<TBaseModel extends BaseModel> {
    data: TBaseModel;
}
