import BaseModel from './BaseModel';
export default interface Model extends BaseModel{
    name: string,
    value: Object,
    iv: Schema.Types.Buffer,
    createdAt: { type: Date, default: Date.now },
}



export const encryptedFields: EncryptedFields = ['value'];




