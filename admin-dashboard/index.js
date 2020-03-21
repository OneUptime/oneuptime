const express = require('express');
const path = require('path');
const app = express();
const envfile = require('envfile');
const fs = require('fs');
const child_process = require('child_process');

const env = {
    REACT_APP_IS_SAAS_SERVICE: process.env.IS_SAAS_SERVICE,
};

fs.writeFileSync('.env', envfile.stringifySync(env));

child_process.execSync('react-env', {
    stdio: [0, 1, 2],
});

app.use('/', (req, res, next) => {
    //eslint-disable-next-line
    console.log(req.method, ' ', req.originalUrl);
    next();
});

app.use(express.static(path.join(__dirname, 'build')));

app.use('/admin', express.static(path.join(__dirname, 'build')));

app.get('/env.js', function(req, res) {
    res.sendFile(path.join(__dirname, 'public', 'env.js'));
});

app.get('/*', function(req, res) {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

app.listen(3100);
