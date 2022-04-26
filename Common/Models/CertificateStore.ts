import BaseModel from './BaseModel';
export default interface Model extends BaseModel{
    {
        id: Schema.Types.Mixed,
        privateKeyPem: Schema.Types.Mixed,
        privateKeyJwk: Schema.Types.Mixed,
        publicKeyPem: Schema.Types.Mixed,
        publicKeyJwk: Schema.Types.Mixed,
        key: Schema.Types.Mixed,
        
        deletedAt: Date,
    },
    { timestamps: true }
);









