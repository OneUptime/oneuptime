import BaseModel from './BaseModel';
export default interface Model extends BaseModel{
    project: {
        type: string,
        ref: 'Project',
        alias: 'project',
        index: true,
    },
    name: string,
    createdByUser: {
        type: string,
        ref: 'User',
        index: true,
    },
    ,
    deleted: boolean,

    deletedByUser: {
        type: string,
        ref: 'User',
        index: true,
    },
}








