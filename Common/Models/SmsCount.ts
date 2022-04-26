import BaseModel from './BaseModel';
export default interface Model extends BaseModel{
    user: { type: string, ref: 'User', alias: 'users', index: true },
    sentTo: string,
    createdAt: { type: Date, default: Date.now },
    project: { type: string, ref: 'Project', index: true },
    parentproject: { type: string, ref: 'Project', index: true },
    deleted: { type: Boolean, default: false, index: true },


    deletedByUser: User,
    content: string,
    status: string,
    error: string,
}









