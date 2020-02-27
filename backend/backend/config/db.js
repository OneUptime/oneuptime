/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const mongoose = require('mongoose');
const mongoUrl = process.env['MONGO_URL'];
mongoose
    .connect(mongoUrl, {
        useUnifiedTopology: true,
        useCreateIndex: true,
        useNewUrlParser: true,
    })
    .then(() => {
        // eslint-disable-next-line
        return console.log('Mongo connected');
    })
    .catch(err => {
        // mongoose connection error will be handled here
        // eslint-disable-next-line
        console.error('App starting error:', err.stack);
        process.exit(1);
    });
module.exports = mongoose;
