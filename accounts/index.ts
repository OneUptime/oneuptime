import 'common-server/utils/env';
import 'common-server/utils/process';

import express from 'express';
import path from 'path';
const app = express();

import compression from 'compression';

app.use(compression());

app.get(['/env.js', '/accounts/env.js'], function(
    req: $TSFixMe,
    res: $TSFixMe
) {
    const env = {
        REACT_APP_IS_SAAS_SERVICE: process.env.IS_SAAS_SERVICE,
        REACT_APP_DISABLE_SIGNUP: process.env.DISABLE_SIGNUP,
        REACT_APP_HOST: req.host,
        REACT_APP_STRIPE_PUBLIC_KEY: process.env.STRIPE_PUBLIC_KEY,
        REACT_APP_AMPLITUDE_PUBLIC_KEY: process.env.AMPLITUDE_PUBLIC_KEY,
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
//     function(req:Request, res: Response, next: Function) {
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

app.get('/*', function(req: Request, res: Response) {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

const PORT = process.env.PORT || 3003;
// eslint-disable-next-line no-console
console.log(`This project is running on port ${PORT}`);
app.listen(PORT);
