import BaseModel from './BaseModel';
export default interface Model extends BaseModel{
    {
        securityId: {
            type: Schema.Types.ObjectId,
            ref: 'ContainerSecurity',
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









