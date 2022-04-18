import mongoose, {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
   Schema
} from '../Infrastructure/ORM';


const schema: Schema = new Schema(
    {
        subject: String,
        altnames: Array,
        renewAt: { type: Number, default: 1 },
        expiresAt: { type: Number },
        issuedAt: { type: Number },
        deleted: { type: Boolean, default: false },
        deletedAt: { type: Number },
    },
    { timestamps: true }
);

export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];
export const encryptedFields: EncryptedFields = [];

export const slugifyField: string = '';

export default mongoose.model('SiteManager', schema);
