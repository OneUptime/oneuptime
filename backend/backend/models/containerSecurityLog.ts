import mongoose from '../config/db'

const Schema = mongoose.Schema;

// @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof Schema' is not callable. Did... Remove this comment to see the full error message
const containerSecurityLogSchema = Schema(
    {
        securityId: {
            type: Schema.Types.ObjectId,
            ref: 'ContainerSecurity',
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
    'ContainerSecurityLog',
    containerSecurityLogSchema
);
