/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const mongoose = require('mongoose');
const mongoUrl =
    process.env['MONGO_URL'] || 'mongodb://localhost:27017/fyipedb';

mongoose.set('useNewUrlParser', true);
mongoose.set('useUnifiedTopology', true);
mongoose.set('useFindAndModify', false);
mongoose.set('useCreateIndex', true);

let options = {};

if (process.env.IS_MONGO_REPLICA_SET) {
    options = {
        readPreference: 'secondaryPreferred',
        keepAlive: 1,
    };
}

mongoose
    .connect(mongoUrl, options)
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
