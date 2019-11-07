var express = require('express');
var app = express();
var http = require('http').createServer(app);
var cors = require('cors');
const Main = require('./workers/main');
const cron = require('node-cron');
const config = require('./utils/config');

app.use(cors());
app.set('port', process.env.PORT || 3008);

http.listen(app.get('port'), function () {
    // eslint-disable-next-line
    console.log(`Probe with Probe Name ${config.probeName} and Probe Key ${config.probeKey} Started on port ${app.get('port')}`);
});

app.get('/', function (req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify({
        status: 200,
        message: 'Service Status - OK',
        serviceType: 'fyipe-probe'
    }));
});

// This cron runs every minute
cron.schedule('* * * * *',() =>{Main.runJob();});

module.exports = app;
