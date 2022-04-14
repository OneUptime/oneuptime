import mongoose, {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
} from '../Infrastructure/ORM';

const Schema = mongoose.Schema;
const schema = new Schema({
    'saml-enabled': {
        type: Boolean,
        required: true,
    },
    domain: {
        type: String,
        required: true,
    },
    entityId: {
        type: String,
        required: true,
    },
    remoteLoginUrl: {
        type: String,
        required: true,
    },
    certificateFingerprint: {
        type: String,
    },
    remoteLogoutUrl: {
        type: String,
        required: true,
    },
    ipRanges: {
        type: String,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    deleted: {
        type: Boolean,
        default: false,
    },
    deletedAt: {
        type: Date,
    },
    deletedById: {
        type: String,
        ref: 'User',
        index: true,
    },
    projectId: {
        type: Schema.Types.ObjectId,
        ref: 'Project',
        index: true,
    },
});
export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];
export const encryptedFields: EncryptedFields = [];

export const  slugifyField: string = '';

export default mongoose.model('Sso', schema);
