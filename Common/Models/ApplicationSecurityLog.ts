import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
export default interface Model extends BaseModel{
    {
        securityId: {
            type: Schema.Types.ObjectId,
            ref: 'ApplicationSecurity',
            index: true,
        },
        componentId: {
            type: Schema.Types.ObjectId,
            ref: 'Component',
            index: true,
        },
        data: Object,
        
        deleteAt: Date,
    },
    { timestamps: true }
);









