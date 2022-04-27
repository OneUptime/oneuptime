import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
import { RoleArray } from 'Common/Types/Role';

export default interface Model extends BaseModel{
    domain: {
        type: Schema.Types.ObjectId,
        required: true,
        ref: 'Sso',
    },
    project: {
        type: Schema.Types.ObjectId,
        ref: 'Project',
        required: true,
    },
    role: {
        type: string,
        required: true,
        enum: RoleArray.filter((item: string) => {
            return item !== 'Owner';
        }), // All roles except Owner
    },
    ,
    deleted: boolean,

    deletedByUser: {
        type: string,
        ref: 'User',
    },
}








