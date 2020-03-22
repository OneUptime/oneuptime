const express = require('express');
const path = require('path');
const app = express();
const child_process = require('child_process');

const env = {
    REACT_APP_IS_SAAS_SERVICE: process.env.IS_SAAS_SERVICE,
    REACT_APP_HOST: process.env.HOST,
    REACT_APP_ACCOUNTS_HOST: process.env.ACCOUNTS_HOST,
    REACT_APP_BACKEND_HOST: process.env.BACKEND_HOST,
    REACT_APP_DOMAIN: process.env.DOMAIN,
    REACT_APP_STRIPE_PUBLIC_KEY: process.env.STRIPE_PUBLIC_KEY,
    REACT_APP_AMPLITUDE_PUBLIC_KEY: process.env.AMPLITUDE_PUBLIC_KEY,
};

child_process.execSync('react-env', {
    stdio: [0, 1, 2],
});

app.get(['/env.js', '/dashboard/env.js'], function(req, res) {
    res.contentType('application/javascript');
    res.send('window._env = ' + JSON.stringify(env));
});

app.use(['/', '/dashboard'], express.static(path.join(__dirname, 'build')));

app.get('/*', function(req, res) {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

const PORT = 3000;
// eslint-disable-next-line no-console
console.log(`This project is running on port ${PORT}`);
app.listen(PORT);
