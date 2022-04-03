import {
    ExpressRequest,
    ExpressResponse,
    ExpressStatic,
} from 'common-server/utils/Express';
import logger from 'common-server/utils/logger';
import app from 'common-server/utils/StartServer';

import path from 'path';

import compression from 'compression';

app.use(compression());

app.get(
    ['/env.js', '/accounts/env.js'],
    (req: ExpressRequest, res: ExpressResponse) => {
        const env = {
            REACT_APP_IS_SAAS_SERVICE: process.env['IS_SAAS_SERVICE'],
            REACT_APP_DISABLE_SIGNUP: process.env['DISABLE_SIGNUP'],
            REACT_APP_HOST: req.host,
            REACT_APP_STRIPE_PUBLIC_KEY: process.env['STRIPE_PUBLIC_KEY'],
            REACT_APP_AMPLITUDE_PUBLIC_KEY: process.env['AMPLITUDE_PUBLIC_KEY'],
            REACT_APP_VERSION:
                process.env['npm_package_version'] ||
                process.env['REACT_APP_VERSION'],
        };

        res.contentType('application/javascript');
        res.send('window._env = ' + JSON.stringify(env));
    }
);

app.use(ExpressStatic(path.join(__dirname, 'build')));

app.use(
    '/accounts/static/js',
    ExpressStatic(path.join(__dirname, 'build', 'static', 'js'))
);

app.use('/accounts', ExpressStatic(path.join(__dirname, 'build')));

app.get('/*', (_req: ExpressRequest, res: ExpressResponse) => {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

const PORT = process.env['PORT'] || 3003;

logger.info(`This project is running on port ${PORT}`);
app.listen(PORT);
