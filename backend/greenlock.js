const Gl = require('greenlock');
const mongoose = require('./backend/config/db');

const greenlock = Gl.create({
    manager: 'fyipe-gl-manager',
    packageRoot: __dirname,
    maintainerEmail: 'certs@fyipe.com',
    staging: false,
    notify: function(event, details) {
        if ('error' === event) {
            // `details` is an error object in this case
            // eslint-disable-next-line no-console
            console.error(details);
        }
    },
    challenges: {
        'http-01': {
            module: 'fyipe-acme-http-01',
        },
    },
    store: {
        module: 'fyipe-le-store',
    },
});

// greenlock unfortunately stated experiencing issue with this
// the reason behind this is not yet known
// the workaround for now is to remove it, since we already have a default created, which doesn't change
// if any of the field is to be updated, it should be handled manually for now in the db
mongoose.connection.on('connected', async () => {
    // await greenlock.manager.defaults({
    //     agreeToTerms: true,
    //     subscriberEmail: 'certs@fyipe.com',
    // });
});

module.exports = greenlock;
