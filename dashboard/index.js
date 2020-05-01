const express = require('express');
const path = require('path');
const app = express();
const child_process = require('child_process');

child_process.execSync('react-env', {
    stdio: [0, 1, 2],
});

app.get(['/env.js', '/dashboard/env.js'], function(req, res) {
    global.dashboardHost = 'https://' + req.host + '/dashboard';
    global.homeHost = 'https://' + req.host;
    global.accountsHost = 'https://' + req.host + '/accounts';
    global.backendHost = 'https://' + req.host + '/api';
    if (req.host.includes('localhost')) {
        if (req.get('host').includes('localhost:')) {
            global.dashboardHost =
                'http://' + req.host + ':' + (process.env.PORT || 3002);
            global.accountsHost = 'http://' + req.host + ':' + 3003;
            global.homeHost = 'http://' + req.host + ':' + 1444;
            global.backendHost = 'http://' + req.host + ':' + 3002;
        } else {
            global.dashboardHost = 'http://' + req.host + '/dashboard';
            global.accountsHost = 'http://' + req.host + '/accounts';
            global.homeHost = 'http://' + req.host;
            global.backendHost = 'http://' + req.host + '/api';
        }
    }

    const env = {
        REACT_APP_IS_SAAS_SERVICE: process.env.IS_SAAS_SERVICE,
        REACT_APP_HOST: global.dashboardHost,
        REACT_APP_ACCOUNTS_HOST: global.accountsHost,
        REACT_APP_BACKEND_HOST: global.backendHost,
        REACT_APP_DOMAIN: req.host,
        REACT_APP_STRIPE_PUBLIC_KEY: process.env.STRIPE_PUBLIC_KEY,
        REACT_APP_AMPLITUDE_PUBLIC_KEY: process.env.AMPLITUDE_PUBLIC_KEY,
    };

    res.contentType('application/javascript');
    res.send('window._env = ' + JSON.stringify(env));
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
