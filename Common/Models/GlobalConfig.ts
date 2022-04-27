import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
export default interface Model extends BaseModel{
    name: string,
    value: Object,
    iv: Schema.Types.Buffer,
    createdAt: { type: Date, default: Date.now },
}



export const encryptedFields: EncryptedFields = ['value'];




