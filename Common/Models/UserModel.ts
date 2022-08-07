import ObjectID from "../Types/ObjectID";
import BaseModel from "./BaseModel";

export default class UserModel extends BaseModel{
    constructor(id?: ObjectID) {
        super(id);
    }
}