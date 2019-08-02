var mongoose = require('../config/db');

var Schema = mongoose.Schema;
var leadSchema = new Schema({
    type: String,
    name: String,
    email: String,
    website: String,
    phone: String,
    whitepaperName: String,
    country: String,
    companySize: String,
    message: String,

    createdAt: { type: Date, default: Date.now },

    deleted: { type: Boolean, default: false},

    deletedAt: {
        type: Date
    },

    deletedById: { type: String, ref: 'User' },

});
module.exports = mongoose.model('Lead', leadSchema);