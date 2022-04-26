import BaseModel from './BaseModel';
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
    updated: { type: Boolean, default: false }



    deletedByUser: User,
    postOnStatusPage: { type: Boolean, default: false },
}

schema.virtual('incident', {
    localField: '_id',
    foreignField: 'incidentId',
    ref: 'Incident',
    justOne: true,
}








