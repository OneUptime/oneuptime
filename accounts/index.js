const express = require('express');
const path = require('path');
const app = express();
const child_process = require('child_process');
const compression = require('compression');

child_process.execSync('react-env', {
    stdio: [0, 1, 2],
});

app.use(compression());

app.use('/', (req, res, next) => {
    //eslint-disable-next-line
    console.log(req.method, ' ', req.originalUrl);
    next();
});

app.get(['/env.js', '/accounts/env.js'], function (req, res) {
    const env = {
        REACT_APP_IS_SAAS_SERVICE: process.env.IS_SAAS_SERVICE,
        REACT_APP_DISABLE_SIGNUP: process.env.DISABLE_SIGNUP,
        REACT_APP_HOST: req.host,
        REACT_APP_STRIPE_PUBLIC_KEY: process.env.STRIPE_PUBLIC_KEY,
        REACT_APP_AMPLITUDE_PUBLIC_KEY: process.env.AMPLITUDE_PUBLIC_KEY,
    };

    res.contentType('application/javascript');
    res.send('window._env = ' + JSON.stringify(env));
});

app.use(express.static(path.join(__dirname, 'build')));
app.use('/accounts', express.static(path.join(__dirname, 'build')));
app.use(
    '/accounts/static/js',
    express.static(path.join(__dirname, 'build/static/js'))
);

app.get('/*', function (req, res) {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

const PORT = process.env.PORT || 3003;
/* eslint-disable no-console */
console.log(`This project is running on port ${PORT}`);
app.listen(PORT);
