var mongoose = require('../config/db');

var Schema = mongoose.Schema;
var notificationSchema = new Schema({
    projectId: { type: String, ref: 'Project' },
    createdAt: { type: Date, default: Date.now },
    createdBy: {type: String, ref: 'User'},
    message : String,
    read: [{type: String, ref: 'User'}],
    icon : String,
    deleted: { type: Boolean, default: false, select: false },
    meta: {
        type: Object
    },
    deletedAt: {
        type: Date,
        select: false
    },

    deletedById: { type: String, ref: 'User', select: false },
    __v: { type: Number, select: false }
});
module.exports = mongoose.model('Notification', notificationSchema);