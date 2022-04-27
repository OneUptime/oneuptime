import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
export default interface Model extends BaseModel{
    from: string,
    to: string,
    project: Project,
    createdAt: { type: Date, default: Date.now }


    deletedByUser: User,
    content: string,
    status: string,
    error: string,
}









