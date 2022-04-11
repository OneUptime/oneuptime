import mongoose, {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
} from '../Infrastructure/ORM';

const Schema = mongoose.Schema;
const schema = new Schema({
    createdAt: { type: Date, default: Date.now },
    applicationScannerKey: { type: String },
    applicationScannerName: { type: String },
    slug: { type: String },
    version: { type: String },
    lastAlive: { type: Date, default: Date.now },
    deleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
    applicationScannerImage: { type: String },
    projectId: {
        type: Schema.Types.ObjectId,
        ref: 'Project',
        alias: 'project',
        index: true,
    },
    componentId: {
        type: Schema.Types.ObjectId,
        ref: 'Component',
        alias: 'component',
        index: true,
    },
});
export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];
export const encryptedFields: encryptedFields = [];

export const slugifyField: string = '';

export default mongoose.model('applicationScanner', schema);
