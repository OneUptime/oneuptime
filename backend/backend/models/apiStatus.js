const mongoose = require('../config/db');

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
module.exports = mongoose.model('ApiStatus', apiStatusSchema);
