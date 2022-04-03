import mongoose from '../utils/ORM';

const Schema = mongoose.Schema;
const customFieldSchema = new Schema(
    {
        fieldName: String,
        fieldType: { type: String, enum: ['text', 'number'] },
        projectId: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
        uniqueField: { type: Boolean, default: false },
        deleted: { type: Boolean, default: false },
        deletedAt: Date,
    },
    { timestamps: true }
);

export default mongoose.model('CustomField', customFieldSchema);
