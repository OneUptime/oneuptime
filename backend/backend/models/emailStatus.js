const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const schema = new Schema({
    from: { type: String, ref: 'Project', index: true },
    to: { type: String, ref: 'User', index: true },
    subject: String,
    body: String,
    createdAt: { type: Date, default: Date.now },
    template: String,
    status: String,
    content: String,
    error: String,
    deleted: { type: Boolean, default: false },
    deletedAt: {
        type: Date,
    },

    deletedById: { type: String, ref: 'User', index: true },
    replyTo: String,
    smtpServer: String, // which can be internal, smtp.gmail.com, etc
});

module.exports = mongoose.model('EmailSent', schema);
