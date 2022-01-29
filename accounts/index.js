process.on('exit', () => {
    // eslint-disable-next-line no-console
    console.log('Shutting Shutdown');
});

process.on('unhandledRejection', err => {
    // eslint-disable-next-line no-console
    console.error('Unhandled rejection in process occurred');
    // eslint-disable-next-line no-console
    console.error(err);
});

process.on('uncaughtException', err => {
    // eslint-disable-next-line no-console
    console.error('Uncaught exception in process occurred');
    // eslint-disable-next-line no-console
    console.error(err);
});

const express = require('express');
const path = require('path');
const app = express();
const compression = require('compression');

app.use(compression());

app.use(async function(req, res, next) {
    const host = req.hostname;

    try {
        if (host && host === 'oneuptime.com') {
            res.writeHead(301, {
                Location: `https://oneuptime.com${req.url}`,
            });
            return res.end();
        }
        if (host && host === 'staging.oneuptime.com') {
            res.writeHead(301, {
                Location: `https://staging.oneuptime.com${req.url}`,
            });
            return res.end();
        }

        return next();
    } catch (error) {
        // eslint-disable-next-line no-console
        console.log('ACCOUNT: Error with fetch', error);
        return next();
    }
});

app.get(['/env.js', '/accounts/env.js'], function(req, res) {
    const env = {
        REACT_APP_IS_SAAS_SERVICE: process.env.IS_SAAS_SERVICE,
        REACT_APP_DISABLE_SIGNUP: process.env.DISABLE_SIGNUP,
        REACT_APP_HOST: req.host,
        REACT_APP_STRIPE_PUBLIC_KEY: process.env.STRIPE_PUBLIC_KEY,
        REACT_APP_AMPLITUDE_PUBLIC_KEY: process.env.AMPLITUDE_PUBLIC_KEY,
        REACT_APP_SENTRY_DSN:
            process.env.SENTRY_DSN || process.env.REACT_APP_SENTRY_DSN,
        REACT_APP_VERSION:
            process.env.npm_package_version || process.env.REACT_APP_VERSION,
    };

    res.contentType('application/javascript');
    res.send('window._env = ' + JSON.stringify(env));
});

app.use(express.static(path.join(__dirname, 'build')));

app.use(
    '/accounts/static/js',
    express.static(path.join(__dirname, 'build', 'static', 'js'))
);

// app.use(
//     /^\/accounts\/static\/js\/([0-9]|[1-9][0-9]|[1-9][0-9][0-9])\.(.+)\.chunk\.js$/,
//     function(req, res, next) {
//         let baseUrls = req.baseUrl;
//         baseUrls = baseUrls.split('/');

//         const fileName = baseUrls[baseUrls.length - 1];
//         if (fileName) {
//             res.sendFile(
//                 path.join(__dirname, 'build', 'static', 'js', fileName)
//             );
//         } else {
//             return next();
//         }
//     }
// );

// app.use(/^\/accounts\/static\/js\/main\.(.+)\.chunk\.js$/, function(
//     req,
//     res,
//     next
// ) {
//     let baseUrls = req.baseUrl;
//     baseUrls = baseUrls.split('/');

//     const fileName = baseUrls[baseUrls.length - 1];
//     if (fileName) {
//         res.sendFile(path.join(__dirname, 'build', 'static', 'js', fileName));
//     } else {
//         return next();
//     }
// });

app.use('/accounts', express.static(path.join(__dirname, 'build')));

app.get('/*', function(req, res) {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

const PORT = process.env.PORT || 3003;
// eslint-disable-next-line no-console
console.log(`This project is running on port ${PORT}`);
app.listen(PORT);
