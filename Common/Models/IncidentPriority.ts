import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
export default interface Model extends BaseModel{
    project: Project,
    name: {
        type: Schema.Types.String,
        require: true,
    },
    color: {
        type: Object,
        require: true,
    },
    

    deletedByUser: User,
}








