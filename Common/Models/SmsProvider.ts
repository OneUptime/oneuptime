import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
export default interface Model extends BaseModel{
    project: Project, //Which project does this belong to.

    enabled: boolean,

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




