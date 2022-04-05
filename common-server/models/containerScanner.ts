import mongoose, { RequiredFields } from '../utils/ORM';

const Schema = mongoose.Schema;
const schema = new Schema({
    createdAt: { type: Date, default: Date.now },
    containerScannerKey: { type: String },
    containerScannerName: { type: String },
    version: { type: String },
    lastAlive: { type: Date, default: Date.now },
    deleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
});
export const requiredFields: RequiredFields = schema.requiredPaths();

export default mongoose.model('containerScanner', schema);
