var mongoose = require('../config/db');

var Schema = mongoose.Schema;
var twilioSchema = new Schema({
    projectId: { type: String, ref: 'Project' }, //which project does this belong to.
    accountSid: String,
    authToken: String,
    phoneNumber: String,
    enabled:{ type: Boolean, default: true},
    createdAt: {
        type: Date,
        default: Date.now
    },

    deleted: { type: Boolean, default: false},

    deletedAt: {
        type: Date
    },

    deletedById: { type: String, ref: 'User' },
});
module.exports = mongoose.model('Twilio', twilioSchema);