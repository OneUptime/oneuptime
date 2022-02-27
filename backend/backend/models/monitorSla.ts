import mongoose from '../config/db';
const Schema = mongoose.Schema;

const monitorSlaSchema = new Schema(
    {
        name: String,
        projectId: { ref: 'Project', type: Schema.Types.ObjectId, index: true },
        isDefault: { type: Boolean, default: false },
        frequency: { type: String, default: '30' }, // measured in days
        monitorUptime: String,
        deleted: { type: Boolean, default: false },
        deletedAt: Date,
    },
    { timestamps: true } //automatically adds createdAt and updatedAt to the collection
);

export default mongoose.model('MonitorSla', monitorSlaSchema);
