import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
export default interface Model extends BaseModel{
    incidentId: { type: string, ref: 'Incident', index: true }, //Which project this incident belongs to.
    user: User, // Which User will perfom this action.
    number: string,
    name: string,

    resolved: boolean,
    acknowledged: boolean,
    createdAt: {
        type: Date,
        default: Date.now,
        expires: 86400,
    },

    



    deletedByUser: User,
}








