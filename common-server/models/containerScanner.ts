import mongoose from '../utils/ORM';

const Schema = mongoose.Schema;
const containerScannerSchema = new Schema({
    createdAt: { type: Date, default: Date.now },
    containerScannerKey: { type: String },
    containerScannerName: { type: String },
    version: { type: String },
    lastAlive: { type: Date, default: Date.now },
    deleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
});

export default mongoose.model('containerScanner', containerScannerSchema);
