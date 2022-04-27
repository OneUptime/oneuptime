import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
export default interface Model extends BaseModel{
    user: User,
    project: Project,
    request: { type: Object },
    response: { type: Object },
    ,
}








