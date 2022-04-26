import BaseModel from './BaseModel';
export default interface Model extends BaseModel{
    project: { type: string, ref: 'Project', index: true },
    createdByUser: User,
    airtableId: string,
    message: string,
    page: string
    createdAt: { type: Date, default: Date.now },

    deletedByUser: User,
}









