import mongoose, {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
} from '../Infrastructure/ORM';

const Schema = mongoose.Schema;
const schema = new Schema({
    projectId: { type: String, ref: 'Project', index: true }, //which project does this belong to.

    enabled: { type: Boolean, default: false },

    iv: Schema.Types.Buffer,

    createdAt: {
        type: Date,
        default: Date.now,
    },

    deleted: { type: Boolean, default: false },

    deletedAt: {
        type: Date,
    },

    provider: {
        type: String,
        enum: ['twilio'],
        required: true,
    },

    providerCredentials: {
        twilio: {
            accountSid: String,
            authToken: String,
            phoneNumber: String,
        },
    },

    deletedById: { type: String, ref: 'User', index: true },
});

export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];
export const encryptedFields: EncryptedFields = ['providerCredentials.twilio.accountSid', 'providerCredentials.twilio.authToken'];

export const slugifyField: string = '';

export default mongoose.model('SmsProvider', schema);
