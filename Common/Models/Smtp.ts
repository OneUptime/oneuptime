import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
export default interface Model extends BaseModel{
    project: Project, //Which project does this belong to.
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




