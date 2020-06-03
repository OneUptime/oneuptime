const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const applicationLogSchema = new Schema({
    componentId: {
        type: Schema.Types.ObjectId,
        ref: 'Component',
        alias: 'component',
    }, //which component this application log belongs to.
    name: String,
    createdById: { type: String, ref: 'User' }, //userId.
    createdAt: {
        type: Date,
        default: Date.now,
    },
    deleted: { type: Boolean, default: false },

    deletedAt: {
        type: Date,
    },

    deletedById: { type: String, ref: 'User' },
});

applicationLogSchema.virtual('component', {
    localField: '_id',
    foreignField: 'componentId',
    ref: 'Component',
    justOne: true,
});

module.exports = mongoose.model('ApplicationLog', applicationLogSchema);
