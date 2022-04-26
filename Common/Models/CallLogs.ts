import BaseModel from './BaseModel';
export default interface Model extends BaseModel{
    from: string,
    to: string,
    project: { type: string, ref: 'Project', index: true },
    createdAt: { type: Date, default: Date.now }


    deletedByUser: User,
    content: string,
    status: string,
    error: string,
}









