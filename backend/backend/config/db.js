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

mongoose
    .connect(mongoUrl, {
        server: {
            socketOptions:  {keepAlive: 1},
            readPreference: "secondaryPreferred",
            strategy: "ping"
        },
        replset: {
            rs_name: 'rs0',
            socketOptions: { keepAlive: 1 },
            strategy: 'ping',
            readPreference: 'secondaryPreferred',
            poolSize: 10
        }
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
