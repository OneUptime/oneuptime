const mongoose = require('../config/db');
const Schema = mongoose.Schema;

const loginIPlogSchema = new Schema({
    userId: {
        type: String,
        ref: 'User',
    },
    createdAt: {
        type: Date,
        default: Date.now(),
    },
    ipLocation: {
        type: Object,
    },
});

module.exports = mongoose.model('LoginIPLog', loginIPlogSchema);
