import mongoose from '../utils/orm';

const Schema = mongoose.Schema;

const containerSecurityLogSchema = new Schema(
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
