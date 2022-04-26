import BaseModel from './BaseModel';

export default interface Model extends BaseModel{
    project: Project,
    name: string,
    slug: string,
    createdByUser: User,
    deletedByUser: User,
}
