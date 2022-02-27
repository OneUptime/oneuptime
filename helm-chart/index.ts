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

// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'express' or its corresponding ... Remove this comment to see the full error message
import express from 'express';
const app = express();
import path from 'path';
import version from './api/version';
// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'cors' or its corresponding typ... Remove this comment to see the full error message
import cors from 'cors';

app.use(cors());

app.use(function(req: $TSFixMe, res: $TSFixMe, next: $TSFixMe) {
    if (typeof req.body === 'string') {
        req.body = JSON.parse(req.body);
    }
    res.header('Access-Control-Allow-Credentials', true);
    res.header('Access-Control-Allow-Origin', req.headers.origin);
    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
    res.header(
        'Access-Control-Allow-Headers',
        'X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept,Authorization'
    );
    if (req.get('host').includes('cluster.local')) {
        return next();
    }

    return next();
});

// set the server port
app.set('port', process.env.PORT || 3423);

// set the view engine to ejs
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

//serve files in public directory
app.use(
    ['/chart', '/'],
    express.static(path.join(__dirname, 'public'), { maxAge: 2592000 })
);

//Application version
app.get(['/chart/version', '/version'], version);

app.listen(app.get('port'), function() {
    // eslint-disable-next-line no-console
    console.log('API Reference started on PORT:' + app.get('port'));
});

export default app;
