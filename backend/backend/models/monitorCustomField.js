const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const monitorCustomFieldSchema = new Schema(
    {
        fieldName: String,
        fieldType: { type: String, enum: ['text', 'number'] },
        projectId: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
        deleted: { type: Boolean, default: false },
        deletedAt: Date,
    },
    { timestamps: true }
);

module.exports = mongoose.model('MonitorCustomField', monitorCustomFieldSchema);
