import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
export default interface Model extends BaseModel{
    componentId: {
        type: Schema.Types.ObjectId,
        ref: 'Component',
        alias: 'component',
        index: true,
    }, //Which component this error tracker belongs to.
    name: string,
    slug: string,
    key: string,
    showQuickStart: boolean,
    resourceCategory: {
        type: Schema.Types.ObjectId,
        ref: 'ResourceCategory',
        index: true,
    },
    createdByUser: User, //user.
    



    deletedByUser: User,
}

schema.virtual('component', {
    localField: '_id',
    foreignField: 'componentId',
    ref: 'Component',
    justOne: true,
}








