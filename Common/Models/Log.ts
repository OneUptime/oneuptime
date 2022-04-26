import BaseModel from './BaseModel';
export default interface Model extends BaseModel{
    applicationLogId: {
        type: Schema.Types.ObjectId,
        ref: 'ApplicationLog',
        alias: 'applicationLog',
        index: true,
    }, //Which application log this content log belongs to.
    content: Object,
    stringifiedContent: string,
    type: {
        type: string,
        enum: ['info', 'warning', 'error'],
        required: true,
    },
    tags: [
        {
            type: string,
        },
    ],
    createdByUser: User, //user.
    



    deletedByUser: User,
}

schema.virtual('applicationLog', {
    localField: '_id',
    foreignField: 'applicationLogId',
    ref: 'ApplicationLog',
    justOne: true,
}








