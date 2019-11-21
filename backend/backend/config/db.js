/**
 *
 * Copyright HackerBay, Inc.
 *
 */


var mongoose = require('mongoose');
var keys = require('./keys.js');

mongoose.connect(keys.dbURL, { useNewUrlParser: true })
    .then(() => {
        // eslint-disable-next-line
        return console.log('Mongo connected');
    })
    .catch(err => { // mongoose connection error will be handled here
        // eslint-disable-next-line
        console.error('App starting error:', err.stack);
        process.exit(1);
    });
module.exports = mongoose;