const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const notificationSchema = new Schema({
    projectId: { type: String, ref: 'Project' },
    createdAt: { type: Date, default: Date.now },
    createdBy: {type: String, ref: 'User'},
    message : String,
    read: [{type: String, ref: 'User'}],
    icon : String,
    deleted: { type: Boolean, default: false},
    meta: {
        type: Object
    },
    deletedAt: {
        type: Date
    },

    deletedById: { type: String, ref: 'User' },
});
module.exports = mongoose.model('Notification', notificationSchema);