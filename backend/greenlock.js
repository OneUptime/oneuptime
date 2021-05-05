const Gl = require('greenlock');
const greenlock = Gl.create({
    manager: 'fyipe-gl-manager',
    packageRoot: __dirname,
    configDir: './greenlock.d/',
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

greenlock.manager.defaults({
    agreeToTerms: true,
    subscriberEmail: 'certs@fyipe.com',
});

module.exports = greenlock;
