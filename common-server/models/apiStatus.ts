import mongoose from '../utils/ORM';

const Schema = mongoose.Schema;
const apiStatusSchema = new Schema(
    {
        deleted: { type: Boolean, default: false },
        deletedAt: Date,
        status: String,
        lastOperation: { type: String, enum: ['create', 'update', 'delete'] },
    },
    { timestamps: true }
);
export default mongoose.model('ApiStatus', apiStatusSchema);
