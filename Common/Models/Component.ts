import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';

export default interface ComponentModel extends BaseModel {
    project: Project,
    name: string,
    slug: string,
    createdByUser: User,
    deletedByUser: User,
}
