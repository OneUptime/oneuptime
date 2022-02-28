import mongoose from '../config/db';

const Schema = mongoose.Schema;

const applicationSecurityLogSchema = Schema(
    {
        securityId: {
            type: Schema.Types.ObjectId,
            ref: 'ApplicationSecurity',
            index: true,
        },
        componentId: {
            type: Schema.Types.ObjectId,
            ref: 'Component',
            index: true,
        },
        data: Object,
        deleted: { type: Boolean, default: false },
        deleteAt: Date,
    },
    { timestamps: true }
);

export default mongoose.model(
    'ApplicationSecurityLog',
    applicationSecurityLogSchema
);
