import ObjectID from "../Types/ObjectID";

export default interface BaseModel {
    _id: ObjectID,
    createdAt: Date,
    deleted: boolean,
    deletedAt: Date,
}