import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
export default interface Model extends BaseModel{
    incidentId: {
        type: Schema.Types.ObjectId,
        ref: 'Incident',
        alias: 'incident',
        index: true,
    },
    content: string,
    type: {
        type: string,
        enum: ['investigation', 'internal'],
        required: true,
    },
    incident_state: string,
    createdByUser: User, //user.
    ,
    updated: boolean



    deletedByUser: User,
    postOnStatusPage: boolean,
}

schema.virtual('incident', {
    localField: '_id',
    foreignField: 'incidentId',
    ref: 'Incident',
    justOne: true,
}








