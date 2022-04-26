import BaseModel from './BaseModel';
export default interface Model extends BaseModel{
    {
        dockerRegistryurl: URL,
        dockerUsername: string,
        dockerPassword: string,
        iv: Schema.Types.Buffer,
        project: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
        deleted: boolean,
        deletedAt: Date,
    },
    { timestamps: true }
);



export const encryptedFields: EncryptedFields = ['dockerPassword'];




