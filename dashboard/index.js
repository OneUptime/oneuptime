const express = require('express');
const path = require('path');
const app = express();
const child_process = require('child_process');
const cors = require('cors');

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

child_process.execSync('react-env', {
    stdio: [0, 1, 2],
});

app.get(['/env.js', '/dashboard/env.js'], function(req, res) {
    const isClustLocal = req.get('host').includes('cluster.local');
    if (!isClustLocal) {
        global.dashboardHost = 'https://' + req.host + '/dashboard';
        global.homeHost = 'https://' + req.host;
        global.accountsHost = 'https://' + req.host + '/accounts';
        global.backendHost = 'https://' + req.host + '/api';
    }
    if (req.host.includes('localhost')) {
        if (req.get('host').includes('localhost:')) {
            global.dashboardHost =
                'http://' + req.host + ':' + (process.env.PORT || 3002);
            global.accountsHost = 'http://' + req.host + ':' + 3003;
            global.homeHost = 'http://' + req.host + ':' + 1444;
            global.backendHost = 'http://' + req.host + ':' + 3002;
        } else if (!isClustLocal) {
            global.dashboardHost = 'http://' + req.host + '/dashboard';
            global.accountsHost = 'http://' + req.host + '/accounts';
            global.homeHost = 'http://' + req.host;
            global.backendHost = 'http://' + req.host + '/api';
        }
    }

    const env = {
        REACT_APP_IS_SAAS_SERVICE: process.env.IS_SAAS_SERVICE,
        ...(!isClustLocal && {
            REACT_APP_HOST: global.dashboardHost,
            REACT_APP_ACCOUNTS_HOST: global.accountsHost,
            REACT_APP_BACKEND_HOST: global.backendHost,
        }),
        REACT_APP_DOMAIN: req.host,
        REACT_APP_STRIPE_PUBLIC_KEY: process.env.STRIPE_PUBLIC_KEY,
        REACT_APP_AMPLITUDE_PUBLIC_KEY: process.env.AMPLITUDE_PUBLIC_KEY,
        REACT_APP_VERSION: process.env.REACT_APP_VERSION,
    };

    res.contentType('application/javascript');
    res.send('window._env = ' + JSON.stringify(env));
});

//APP VERSION
app.use(['/dashboard/api/version', '/dashboard/version'], function(req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.json({ dashboardVersion: process.env.npm_package_version });
});

app.use(express.static(path.join(__dirname, 'build')));
app.use('/dashboard', express.static(path.join(__dirname, 'build')));
app.use(
    '/dashboard/static/js',
    express.static(path.join(__dirname, 'build/static/js'))
);

app.get('/*', function(req, res) {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

const PORT = 3000;
// eslint-disable-next-line no-console
console.log(`This project is running on port ${PORT}`);
app.listen(PORT);
