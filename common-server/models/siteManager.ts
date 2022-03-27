import mongoose from '../utils/orm';

const Schema = mongoose.Schema;
const siteManagerSchema = new Schema(
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
export default mongoose.model('SiteManager', siteManagerSchema);
