import BaseModel from "Common/Models/BaseModel";

export default interface CreateBy<T extends BaseModel> {
    data: T;
}
