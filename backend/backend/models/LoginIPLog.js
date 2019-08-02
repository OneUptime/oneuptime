var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var loginIPlogSchema = new Schema({
    userId: {
        type: String, 
        ref: 'User',
    },
    createdAt: {
        type: Date,
        default: Date.now()
    },
    ipLocation: {
        type: Object
    }
});

module.exports = mongoose.model('LoginIPLog', loginIPlogSchema);