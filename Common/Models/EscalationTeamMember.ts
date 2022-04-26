import {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
    Schema,
} from '../Infrastructure/ORM';

export default interface Model extends BaseModel{
    teamMembers: [
        {
            startTime: Date,
            endTime: Date,
            timezone: string,
            user: { type: string, ref: 'User', index: true, default: null },
            groupId: {
                type: string,
                ref: 'Groups',
                index: true,
                default: null,
            },
        },
    ],
}








export default schema;
