import BaseModel from './BaseModel';
export default interface Model extends BaseModel{
    {
        id: Schema.Types.Mixed,
        privateKeyPem: Schema.Types.Mixed,
        privateKeyJwk: Schema.Types.Mixed,
        cert: Schema.Types.Mixed,
        chain: Schema.Types.Mixed,
        privKey: Schema.Types.Mixed,
        subject: Schema.Types.Mixed,
        altnames: Schema.Types.Mixed,
        issuedAt: Schema.Types.Mixed,
        expiresAt: Schema.Types.Mixed,
        
        deletedAt: Date,
    },
    { timestamps: true }
);









