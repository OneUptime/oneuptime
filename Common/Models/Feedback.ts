import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
export default interface Model extends BaseModel{
    project: Project,
    createdByUser: User,
    airtableId: string,
    message: string,
    page: string
    createdAt: { type: Date, default: Date.now },

    deletedByUser: User,
}









