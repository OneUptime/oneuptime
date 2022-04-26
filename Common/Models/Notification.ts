import BaseModel from './BaseModel';
export default interface Model extends BaseModel{
    project: { type: string, ref: 'Project', index: true },
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









