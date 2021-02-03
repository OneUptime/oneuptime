const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const twilioSchema = new Schema({
    projectId: { type: String, ref: 'Project', index: true }, //which project does this belong to.
    accountSid: String,
    authToken: String,
    phoneNumber: String,
    iv: Schema.Types.Buffer,
    enabled: { type: Boolean, default: false },
    createdAt: {
        type: Date,
        default: Date.now,
    },

    deleted: { type: Boolean, default: false },

    deletedAt: {
        type: Date,
    },

    deletedById: { type: String, ref: 'User', index: true },
});
module.exports = mongoose.model('Twilio', twilioSchema);
