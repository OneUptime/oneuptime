const express = require('express');
const path = require('path');
const app = express();
const child_process = require('child_process');

child_process.execSync('react-env', {
    stdio: [0, 1, 2],
});

app.get(['/env.js', '/dashboard/env.js'], function(req, res) {
    let fyipeHost = null;
    if(!process.env.FYIPE_HOST){
        if (req.host.includes('localhost')) {
            fyipeHost = req.protocol + '://' + global.host + ':' + 3002;
        }else{
            fyipeHost = req.protocol + '://' + global.host + '/api';
        }
    }
    
    const env = {
        REACT_APP_FYIPE_HOST: process.env.FYIPE_HOST || fyipeHost
    };

    res.contentType('application/javascript');
    res.send('window._env = ' + JSON.stringify(env));
});

app.use(express.static(path.join(__dirname, 'build')));
app.use('/status-page', express.static(path.join(__dirname, 'build')));

app.get('/*', function(req, res) {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

app.listen(3006);
