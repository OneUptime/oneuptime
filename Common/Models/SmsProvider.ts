import BaseModel from './BaseModel';
export default interface Model extends BaseModel{
    project: { type: string, ref: 'Project', index: true }, //Which project does this belong to.

    enabled: { type: Boolean, default: false },

    iv: Schema.Types.Buffer,

    ,

    



    provider: {
        type: string,
        enum: ['twilio'],
        required: true,
    },

    providerCredentials: {
        twilio: {
            accountSid: string,
            authToken: string,
            phoneNumber: string,
        },
    },

    deletedByUser: User,
}




export const encryptedFields: EncryptedFields = [
    'providerCredentials.twilio.accountSid',
    'providerCredentials.twilio.authToken',
];




