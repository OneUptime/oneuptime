import mongoose from '../utils/orm';

const Schema = mongoose.Schema;
const leadSchema = new Schema({
    type: String,
    name: String,
    email: String,
    website: String,
    phone: String,
    whitepaperName: String,
    country: String,
    companySize: String,
    message: String,

    createdAt: { type: Date, default: Date.now },

    deleted: { type: Boolean, default: false },

    deletedAt: {
        type: Date,
    },
    source: Object,
    deletedById: { type: String, ref: 'User', index: true },
});
export default mongoose.model('Lead', leadSchema);
