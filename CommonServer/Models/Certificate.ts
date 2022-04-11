import mongoose, {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
} from '../Infrastructure/ORM';

const Schema = mongoose.Schema;
const schema = new Schema(
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
        deleted: { type: Boolean, default: false },
        deletedAt: Date,
    },
    { timestamps: true }
);

export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];
export const encryptedFields: encryptedFields = [];

export const slugifyField: string = '';

export default mongoose.model('Certificate', schema);
