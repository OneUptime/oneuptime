import mongoose from '../config/db'

const Schema = mongoose.Schema;
const IncidentNoteTemplateSchema = new Schema(
    {
        projectId: {
            type: Schema.Types.ObjectId,
            ref: 'Project',
            alias: 'project',
            index: true,
        },
        incidentState: {
            type: Schema.Types.String,
        },
        incidentNote: {
            type: Schema.Types.String,
        },
        name: String,
        deleted: { type: Boolean, default: false },
        deletedAt: {
            type: Date,
        },
    },
    { timestamps: true }
);

export default mongoose.model(
    'IncidentNoteTemplate',
    IncidentNoteTemplateSchema
);
