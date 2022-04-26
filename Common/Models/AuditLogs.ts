import BaseModel from './BaseModel';
export default interface Model extends BaseModel{
    user: User,
    project: { type: string, ref: 'Project', index: true },
    request: { type: Object },
    response: { type: Object },
    ,
}








