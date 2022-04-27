import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
export default interface Model extends BaseModel{
    project: Project,
    createdAt: { type: Date, default: Date.now },
    createdBy: User,
    message: string,
    read: [User],
    closed: [User],
    icon: string
    meta: {
        type: Object,
    },

    deletedByUser: User,
}









