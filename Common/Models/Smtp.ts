import BaseModel from './BaseModel';
export default interface Model extends BaseModel{
    project: { type: string, ref: 'Project', index: true }, //Which project does this belong to.
    user: string,
    pass: string,
    host: string,
    port: string,
    from: string,
    name: string,
    iv: Schema.Types.Buffer,
    secure: boolean,
    enabled: boolean,
    ,

    



    deletedByUser: User,
}





export const encryptedFields: EncryptedFields = ['pass'];




