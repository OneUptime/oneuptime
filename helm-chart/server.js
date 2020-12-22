const express = require('express');
const app = express();
const path = require('path');
const version = require('./api/version');
const cors = require('cors');

process.on('exit', () => {
    /* eslint-disable no-console */
    console.log('Server Shutting Shutdown');
});

process.on('unhandledRejection', err => {
    /* eslint-disable no-console */
    console.error('Unhandled rejection in server process occurred');
    /* eslint-disable no-console */
    console.error(err);
});

process.on('uncaughtException', err => {
    /* eslint-disable no-console */
    console.error('Uncaught exception in server process occurred');
    /* eslint-disable no-console */
    console.error(err);
});

app.use(cors());

app.use(function(req, res, next) {
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
    // Add this to global object, and this can be used anywhere where you need backend host.
    global.apiHost = 'https://' + req.hostname + '/api';
    global.accountsHost = 'https://' + req.hostname + '/accounts';
    global.homeHost = 'https://' + req.hostname;
    global.dashboardHost = 'https://' + req.hostname + '/dashboard';
    global.statusHost = global.homeHost;

    if (
        req.hostname.includes('localhost') ||
        req.hostname.includes('127.0.0.1')
    ) {
        if (
            req.get('host').includes('localhost:') ||
            req.get('host').includes('127.0.0.1:')
        ) {
            global.apiHost =
                'http://' +
                req.hostname +
                ':' +
                (process.env.PORT || 3002) +
                '/api';
            global.accountsHost =
                'http://' + req.hostname + ':' + 3003 + '/accounts';
            global.homeHost = 'http://' + req.hostname + ':' + 1444;
            global.dashboardHost =
                'http://' + req.hostname + ':' + 3000 + '/dashboard';
            global.statusHost = 'http://' + req.hostname + ':' + 3006;
        } else {
            global.apiHost = 'http://' + req.hostname + '/api';
            global.accountsHost = 'http://' + req.hostname + '/accounts';
            global.homeHost = 'http://' + req.hostname;
            global.dashboardHost = 'http://' + req.hostname + '/dashboard';
            global.statusHost = global.homeHost;
        }
    }

    next();
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
app.get(['/version', '/api/version'], version);

app.listen(app.get('port'), function() {
    // eslint-disable-next-line no-console
    console.log('API Reference started on PORT:' + app.get('port'));
});

module.exports = app;
module.exports.close = function() {
    server.close();
};
