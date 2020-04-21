const express = require('express');
const path = require('path');
const app = express();
const child_process = require('child_process');

child_process.execSync('react-env', {
    stdio: [0, 1, 2],
});

app.get(['/env.js', '/dashboard/env.js'], function(req, res) {
    global.host = req.protocol + '://' + req.host;
    global.accountsHost = req.protocol + '://' + req.host + '/accounts';
    global.backendHost = req.protocol + '://' + req.host + '/api';
    if (req.host.includes('localhost')) {
        global.host =
            req.protocol +
            '://' +
            req.host +
            ':' +
            (process.env.PORT || 3002);
        global.accountsHost = req.protocol + '://' + req.host + ':' + 3003;
        global.homeHost = req.protocol + '://' + req.host + ':' + 1444;
        global.backendHost = req.protocol + '://' + req.host + ':' + 3002;
    }

    const env = {
        REACT_APP_IS_SAAS_SERVICE: process.env.IS_SAAS_SERVICE,
        REACT_APP_HOST: global.host,
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

app.get('/*', function(req, res) {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

const PORT = 3000;
// eslint-disable-next-line no-console
console.log(`This project is running on port ${PORT}`);
app.listen(PORT);
