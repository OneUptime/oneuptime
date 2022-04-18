import mongoose, {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
   Schema
} from '../Infrastructure/ORM';



const schema: Schema = new Schema({
    type: String,
    metrics: Object,
    callIdentifier: String,
    method: String,
    performanceTrackerId: {
        type: Schema.Types.ObjectId,
        ref: 'PerformanceTracker',
        index: true,
    },
    deleted: { type: Boolean, default: false },
    deletedAt: {
        type: Date,
    },
    createdAt: Date,
    updatedAt: Date,
});

export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];
export const encryptedFields: EncryptedFields = [];

export const slugifyField: string = '';

export default mongoose.model('PerformanceTrackerMetric', schema);
