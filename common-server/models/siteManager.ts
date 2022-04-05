import mongoose, { RequiredFields } from '../utils/ORM';

const Schema = mongoose.Schema;
const schema = new Schema(
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

export default mongoose.model('SiteManager', schema);
