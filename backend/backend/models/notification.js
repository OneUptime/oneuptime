var mongoose = require('../config/db');

var Schema = mongoose.Schema;
var notificationSchema = new Schema({
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