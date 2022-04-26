import BaseModel from './BaseModel';
export default interface Model extends BaseModel{
    componentId: {
        type: Schema.Types.ObjectId,
        ref: 'Component',
        alias: 'component',
        index: true,
    }, //Which component this application log belongs to.
    name: string,
    slug: string,
    key: string,
    resourceCategory: {
        type: Schema.Types.ObjectId,
        ref: 'ResourceCategory',
        index: true,
    },
    showQuickStart: boolean,
    createdByUser: User, //user.
    



    deletedByUser: User,
}

schema.virtual('component', {
    localField: '_id',
    foreignField: 'componentId',
    ref: 'Component',
    justOne: true,
}








