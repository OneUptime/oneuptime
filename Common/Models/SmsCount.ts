import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
export default interface Model extends BaseModel{
    user: { type: string, ref: 'User', alias: 'users', index: true },
    sentTo: string,
    createdAt: { type: Date, default: Date.now },
    project: Project,
    parentproject: Project,
    deleted: { type: Boolean, default: false, index: true },


    deletedByUser: User,
    content: string,
    status: string,
    error: string,
}









