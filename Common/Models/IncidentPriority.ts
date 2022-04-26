import BaseModel from './BaseModel';
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








